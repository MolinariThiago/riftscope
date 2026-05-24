"""
RIFTSCOPE API — FastAPI entry point.

Runs on Windows + Python 3.14 with the slim requirements.txt.
For production (PostgreSQL + Redis + Celery + demoparser2), additionally
install requirements-prod.txt and set DATABASE_URL / REDIS_URL accordingly,
then flip PARSER_BACKEND / STORAGE_BACKEND / QUEUE_BACKEND in the env so
the factories pick up the production implementations.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.settings import get_settings
from db.database import Base, engine
# Import all models BEFORE create_all so SQLAlchemy registers their tables.
# Order matters when there are FKs — User is referenced by Demo so it
# has to be imported first.
from db.models.user import User  # noqa: F401
from db.models.demo import Demo, DemoKill, DemoPlayer, DemoRound  # noqa: F401
from db.models.insight import DemoInsight  # noqa: F401
from db.models.pro_match import ProMatch  # noqa: F401
from routers import admin, auth, demos, maps, players, pro

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("riftscope.api")

settings = get_settings()


def _ensure_steam_columns() -> None:
    """One-shot migration: add the steam_profile_url / steam_realname /
    steam_country columns to the users table on existing DBs.

    ``Base.metadata.create_all`` creates new TABLES but never adds
    columns to existing tables. We add these columns manually so
    older SQLite dev databases keep working after a model upgrade —
    in production this would be handled by Alembic, but at dev scale
    a guarded ALTER TABLE is enough.
    """
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    if "users" in insp.get_table_names():
        existing = {col["name"] for col in insp.get_columns("users")}
        new_cols = {
            "steam_profile_url": "VARCHAR",
            "steam_realname": "VARCHAR",
            "steam_country": "VARCHAR",
            "steam_api_key": "VARCHAR",
        }
        with engine.begin() as conn:
            for col_name, col_type in new_cols.items():
                if col_name not in existing:
                    conn.execute(
                        text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
                    )
                    logger.info("migrated users table: added %s", col_name)

    # Pro-match tier column — see ``ProMatch.tier`` for the value
    # vocabulary. Added so admin uploads can classify the match
    # competitively without exposing the field in the public feed.
    if "pro_matches" in insp.get_table_names():
        existing_pm = {col["name"] for col in insp.get_columns("pro_matches")}
        if "tier" not in existing_pm:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE pro_matches ADD COLUMN tier VARCHAR")
                )
                logger.info("migrated pro_matches table: added tier")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _ensure_steam_columns()
    Base.metadata.create_all(bind=engine)
    logger.info(
        "RIFTSCOPE API ready (env=%s, db=%s, parser=%s, storage=%s, queue=%s)",
        settings.environment,
        settings.database_url,
        settings.parser_backend,
        settings.storage_backend,
        settings.queue_backend,
    )

    # RAR runtime — HLTV serves most pro demos as .rar archives, so
    # we make sure an ``unrar`` binary is reachable BEFORE the
    # scheduler starts firing imports. On Windows the resolver
    # auto-downloads a standalone unrar.exe from rarlab if nothing
    # else is found.
    from services.rar_runtime import ensure_rar_runtime
    ensure_rar_runtime()

    # Background pro-match auto-import scheduler. Pulls Liquipedia +
    # imports HLTV demos every N minutes so the /pro page is always
    # populated without manual clicks. See ``services.pro_scheduler``
    # for tunables (env-driven, defaults are dev-friendly).
    from services.pro_scheduler import start_scheduler, stop_scheduler
    await start_scheduler()

    yield

    # Shutdown — let the scheduler exit its loop cleanly before the
    # event loop closes, so in-flight HTTP downloads don't leak.
    await stop_scheduler()
    logger.info("RIFTSCOPE API shutting down")


app = FastAPI(
    title=settings.app_name,
    description="CS2 2D Demo Replay & Analytics — Phase 3A API",
    version=settings.app_version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "riftscope-api",
        "version": settings.app_version,
        "environment": settings.environment,
        "backends": {
            "parser": settings.parser_backend,
            "storage": settings.storage_backend,
            "queue": settings.queue_backend,
        },
    }


app.include_router(demos.router, prefix="/demos", tags=["demos"])
app.include_router(players.router, prefix="/players", tags=["players"])
app.include_router(maps.router, prefix="/maps", tags=["maps"])
app.include_router(pro.router, prefix="/pro", tags=["pro"])
# ``admin`` and ``auth`` set their own ``prefix=`` on the APIRouter so we
# pass them in bare here — passing prefix twice would yield e.g.
# ``/admin/admin/metrics``.
app.include_router(admin.router)
app.include_router(auth.router)
