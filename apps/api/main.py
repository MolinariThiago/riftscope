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
from db.models.demo import Demo, DemoKill, DemoPlayer, DemoRound  # noqa: F401
from db.models.insight import DemoInsight  # noqa: F401
from db.models.pro_match import ProMatch  # noqa: F401
from routers import demos, maps, players, pro

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("riftscope.api")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    Base.metadata.create_all(bind=engine)
    logger.info(
        "RIFTSCOPE API ready (env=%s, db=%s, parser=%s, storage=%s, queue=%s)",
        settings.environment,
        settings.database_url,
        settings.parser_backend,
        settings.storage_backend,
        settings.queue_backend,
    )
    yield
    # Shutdown — nothing to clean up yet
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
