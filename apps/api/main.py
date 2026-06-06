"""
RIFTSCOPE API — FastAPI entry point.

Runs on Windows + Python 3.14 with the slim requirements.txt.
For production (PostgreSQL + Redis + Celery + demoparser2), additionally
install requirements-prod.txt and set DATABASE_URL / REDIS_URL accordingly,
then flip PARSER_BACKEND / STORAGE_BACKEND / QUEUE_BACKEND in the env so
the factories pick up the production implementations.
"""

import logging
import re
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
from db.models.feedback import FeedbackReport  # noqa: F401
from db.models.insight import DemoInsight  # noqa: F401
from db.models.pro_match import ProMatch  # noqa: F401
from db.models.playbook import Playbook, PlaybookFolder  # noqa: F401
from db.models.round_tactic import RoundTactic  # noqa: F401
from db.models.team import Team, TeamMember  # noqa: F401
from routers import (
    admin,
    anti_strat,
    auth,
    demos,
    feedback,
    leaderboards,
    maps,
    players,
    playbook,
    playbook_folders,
    pro,
    stats,
    team,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)


class _SecretRedactor(logging.Filter):
    """Redacts secrets from every log record before it is emitted.

    httpx logs full request URLs (Steam Web API calls include
    ``?key=<api-key>``), and connection strings can carry passwords.
    We rewrite the rendered message in place so secrets never hit
    stdout / log aggregators.
    """

    _PATTERNS = (
        re.compile(r"(key=)[^&\s\"']+", re.IGNORECASE),          # ?key=<steam api key>
        re.compile(r"(://[^:/\s]+:)[^@/\s]+(@)"),                 # user:password@host
        re.compile(r"(token=)[^&\s\"']+", re.IGNORECASE),
        re.compile(r"(password=)[^&\s\"']+", re.IGNORECASE),
    )

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        redacted = msg
        for pat in self._PATTERNS:
            if pat.groups >= 2:
                redacted = pat.sub(r"\1***\2", redacted)
            else:
                redacted = pat.sub(r"\1***", redacted)
        if redacted != msg:
            record.msg = redacted
            record.args = ()
        return True


# Attach to root handlers so it covers propagated records (httpx, uvicorn, etc.)
for _h in logging.getLogger().handlers:
    _h.addFilter(_SecretRedactor())

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
        # Import-lifecycle columns — see ProMatch.import_status. Added so the
        # non-blocking manual import can surface download progress/errors.
        for col_name in ("import_status", "import_error"):
            if col_name not in existing_pm:
                with engine.begin() as conn:
                    conn.execute(
                        text(f"ALTER TABLE pro_matches ADD COLUMN {col_name} VARCHAR")
                    )
                    logger.info("migrated pro_matches table: added %s", col_name)
        # Download-accounting columns — feed the daily PRO_DAILY_DOWNLOAD_LIMIT_GB
        # budget in the scheduler. ``import_bytes`` is BIGINT because demos
        # routinely run into the hundreds of MB and total a year can hit
        # tens of GB. ``import_completed_at`` is the timestamp the scheduler
        # uses to filter "downloaded in the current UTC day".
        if "import_bytes" not in existing_pm:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE pro_matches ADD COLUMN import_bytes BIGINT")
                )
                logger.info("migrated pro_matches table: added import_bytes")
        if "import_completed_at" not in existing_pm:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE pro_matches ADD COLUMN import_completed_at TIMESTAMP")
                )
                logger.info("migrated pro_matches table: added import_completed_at")
        # Team logo URLs — set by the HLTV scraper from the team's
        # HLTV id. Null on legacy rows; the scheduler's next sync pass
        # backfills them as part of the regular update path.
        for col_name in ("team_a_logo_url", "team_b_logo_url"):
            if col_name not in existing_pm:
                with engine.begin() as conn:
                    conn.execute(
                        text(f"ALTER TABLE pro_matches ADD COLUMN {col_name} VARCHAR")
                    )
                    logger.info("migrated pro_matches table: added %s", col_name)

    # Playbook: type + tags columns added after the table first shipped.
    if "playbooks" in insp.get_table_names():
        existing_pb = {col["name"] for col in insp.get_columns("playbooks")}
        new_pb = {
            "type": "VARCHAR",
            "tags": "JSON",
            "team_id": "INTEGER",
            "folder_id": "INTEGER",
            "kind": "VARCHAR DEFAULT 'tactic'",
            "demo_id": "INTEGER",
            "round_number": "INTEGER",
        }
        with engine.begin() as conn:
            for col_name, col_type in new_pb.items():
                if col_name not in existing_pb:
                    conn.execute(
                        text(f"ALTER TABLE playbooks ADD COLUMN {col_name} {col_type}")
                    )
                    logger.info("migrated playbooks table: added %s", col_name)

    # Team identity (Phase 0): clan/team names on demos + demo_players.
    if "demos" in insp.get_table_names():
        existing_d = {col["name"] for col in insp.get_columns("demos")}
        new_demo_cols = {
            "team_a_name": "VARCHAR",
            "team_b_name": "VARCHAR",
            "score_a": "INTEGER",
            "score_b": "INTEGER",
            # Bo3 series linkage — multiple Demo rows can share one
            # ProMatch when HLTV ships the series as one archive.
            "pro_match_id": "INTEGER",
        }
        with engine.begin() as conn:
            for col_name, col_type in new_demo_cols.items():
                if col_name not in existing_d:
                    conn.execute(text(f"ALTER TABLE demos ADD COLUMN {col_name} {col_type}"))
                    logger.info("migrated demos table: added %s", col_name)
    if "demo_players" in insp.get_table_names():
        existing_dp = {col["name"] for col in insp.get_columns("demo_players")}
        if "clan_name" not in existing_dp:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE demo_players ADD COLUMN clan_name VARCHAR"))
                logger.info("migrated demo_players table: added clan_name")
        # Leaderboard raw counters — see DemoPlayer.total_damage /
        # kast_rounds. Default 0 so legacy rows aggregate as
        # zero-contribution until they're re-processed (the parser
        # populates these going forward).
        for col_name in ("total_damage", "kast_rounds"):
            if col_name not in existing_dp:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            f"ALTER TABLE demo_players ADD COLUMN {col_name} INTEGER DEFAULT 0 NOT NULL"
                        )
                    )
                    logger.info("migrated demo_players table: added %s", col_name)


def _backfill_pro_match_demo_links() -> None:
    """Wire up Demo rows that belong to a ProMatch series but lost the link.

    Before the ``Demo.pro_match_id`` column existed, ``_persist_demo_bytes``
    in pro_import.py only stamped ``ProMatch.demo_id`` with the FIRST
    extracted .dem from a Bo3 archive. The other 1-2 maps of the series
    were saved as orphan Demo rows — visible in /demos but not linked
    back to the ProMatch they came from, so /pro showed a single map per
    series instead of the full Bo3.

    The filename ``_persist_demo_bytes`` writes is always
    ``{teamA}-vs-{teamB}-{pro_match.id}-{member_stem}.dem``, so we can
    recover the link by parsing the embedded ``-{id}-`` segment. This
    runs ONCE per boot, only touches Demos that don't have a link yet,
    and is no-op once the new code path has been writing the FK directly.
    """
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    if "demos" not in insp.get_table_names() or "pro_matches" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("demos")}
    if "pro_match_id" not in existing:
        return
    # Pull every Demo without a series link.  We match its filename
    # against the set of known ProMatch ids — anything that contains
    # ``-{id}-`` (or ends in ``-{id}.dem``) gets linked.
    import re
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT id, filename FROM demos "
                "WHERE pro_match_id IS NULL AND filename IS NOT NULL"
            )
        ).fetchall()
        if not rows:
            return
        match_ids = {
            r[0] for r in conn.execute(text("SELECT id FROM pro_matches")).fetchall()
        }
        if not match_ids:
            return
        pattern = re.compile(r"-(\d+)(?:-[^/]*)?\.dem$", re.IGNORECASE)
        linked = 0
        for demo_id, filename in rows:
            m = pattern.search(filename or "")
            if not m:
                continue
            candidate = int(m.group(1))
            if candidate not in match_ids:
                continue
            conn.execute(
                text("UPDATE demos SET pro_match_id = :pm WHERE id = :id"),
                {"pm": candidate, "id": demo_id},
            )
            linked += 1
        if linked:
            logger.info(
                "backfilled %d Demo->ProMatch links from filenames", linked,
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _ensure_steam_columns()
    Base.metadata.create_all(bind=engine)
    _backfill_pro_match_demo_links()
    logger.info(
        "RIFTSCOPE API ready (env=%s, db=%s, parser=%s, storage=%s, queue=%s)",
        settings.environment,
        re.sub(r"(://[^:/\s]+:)[^@/\s]+(@)", r"\1***\2", str(settings.database_url)),
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
app.include_router(
    leaderboards.router, prefix="/leaderboards", tags=["leaderboards"]
)
app.include_router(stats.router, prefix="/stats", tags=["stats"])
app.include_router(maps.router, prefix="/maps", tags=["maps"])
app.include_router(playbook.router, prefix="/playbooks", tags=["playbooks"])
app.include_router(
    playbook_folders.router, prefix="/playbook-folders", tags=["playbook-folders"]
)
app.include_router(team.router, prefix="/teams", tags=["teams"])
app.include_router(anti_strat.router, prefix="/anti-strat", tags=["anti-strat"])
app.include_router(pro.router, prefix="/pro", tags=["pro"])
# ``admin`` and ``auth`` set their own ``prefix=`` on the APIRouter so we
# pass them in bare here — passing prefix twice would yield e.g.
# ``/admin/admin/metrics``.
app.include_router(admin.router)
app.include_router(auth.router)
# Feedback widget — two routers (public + admin queue), each carries its
# own prefix (/feedback and /admin/feedback), so we pass them in bare.
app.include_router(feedback.public_router)
app.include_router(feedback.admin_router)
