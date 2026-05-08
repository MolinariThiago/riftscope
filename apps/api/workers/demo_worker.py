"""
Demo processing worker.

Currently runs as an in-process asyncio task launched from FastAPI's
BackgroundTasks. The function signature `process_demo(demo_id, file_path)` is
identical to what the future Celery task will expose, so the migration to
distributed workers in Phase 3 is just decorating this function with
`@celery_app.task` and switching the trigger from BackgroundTasks to `.delay()`.

Progress is reported by writing to the Demo row in the database; the frontend
polls /demos/{id}/status to stream updates.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from db.database import SessionLocal
from db.models.demo import Demo
from services.demo_parser import DemoParserService
from services.storage import LocalDemoStorage

logger = logging.getLogger("riftscope.worker")

# Phase 3: replace these with Celery configuration
# REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
# celery_app = Celery("riftscope", broker=REDIS_URL, backend=REDIS_URL)


# Stages used to report progress from 0 to 100
STAGES = [
    ("Loading demo", 5),
    ("Parsing header", 15),
    ("Parsing rounds", 35),
    ("Parsing players", 55),
    ("Computing ADR/KAST/HS", 70),
    ("Detecting clutches", 80),
    ("Building economy timeline", 90),
    ("Generating heatmap", 97),
    ("Saving results", 100),
]


def _update_demo(demo_id: int, **fields) -> None:
    """Open a fresh session, mutate the demo row, commit. Survives long tasks."""
    db = SessionLocal()
    try:
        demo = db.query(Demo).filter(Demo.id == demo_id).first()
        if not demo:
            return
        for key, value in fields.items():
            setattr(demo, key, value)
        db.commit()
    finally:
        db.close()


async def process_demo(demo_id: int, file_path: str) -> None:
    """
    Main async demo processing pipeline.

    Steps:
        1. Mark as 'processing'
        2. Walk through stages with progress updates
        3. Parse the demo file
        4. Persist analysis_data + match metadata
        5. Mark as 'completed' (or 'failed' on error)
    """
    storage = LocalDemoStorage()  # noqa: F841 — kept for future S3 swap

    try:
        _update_demo(demo_id, status="processing", processing_progress=0, error_message=None)

        # Walk the progress stages; in production each maps to a real parser phase.
        for label, pct in STAGES[:-1]:
            logger.info("demo %s: %s (%d%%)", demo_id, label, pct)
            _update_demo(demo_id, processing_progress=pct)
            await asyncio.sleep(0.6)  # yields control + simulates work for stub mode

        parser = DemoParserService()
        analysis = parser.parse(file_path)
        meta = analysis["meta"]

        _update_demo(
            demo_id,
            status="completed",
            processing_progress=100,
            processed_at=datetime.utcnow(),
            map_name=meta["map"],
            tick_rate=meta["tickrate"],
            duration_seconds=meta["durationSeconds"],
            round_count=meta["roundCount"],
            score_ct=meta["score"][0],
            score_tt=meta["score"][1],
            analysis_data=analysis,
        )
        logger.info("demo %s: completed", demo_id)

    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("demo %s failed", demo_id)
        _update_demo(
            demo_id,
            status="failed",
            error_message=str(exc),
        )


def schedule_demo_processing(demo_id: int, file_path: str) -> asyncio.Task:
    """
    Fire-and-forget scheduler called from the upload endpoint.

    Phase 3 replacement:
        process_demo.delay(demo_id, file_path)   # Celery task
    """
    return asyncio.create_task(process_demo(demo_id, file_path))
