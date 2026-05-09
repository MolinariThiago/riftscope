"""
Demo processing worker.

Currently runs as an in-process asyncio task launched from FastAPI's
BackgroundTasks via :class:`services.queue.InProcessQueue`. The function
signature ``process_demo(demo_id, file_path)`` is identical to what the
future Celery task will expose, so the migration to distributed workers in
Phase 3B is just decorating this function with ``@celery_app.task`` and
flipping ``settings.queue_backend`` to ``celery``.

Progress is reported by writing to the Demo row in the database; the
frontend polls /demos/{id}/status to stream updates.

Phase 3A normalizes parser output into ``DemoPlayer`` / ``DemoRound`` /
``DemoKill`` rows alongside the JSON ``analysis_data`` blob, so aggregate
queries can run against indexed tables.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from db.database import SessionLocal
from db.models.demo import Demo, DemoKill, DemoPlayer, DemoRound
from services.parser_factory import get_parser

logger = logging.getLogger("riftscope.worker")


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


def _update_demo(demo_id: int, **fields: Any) -> None:
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


def _persist_normalized(demo_id: int, analysis: dict[str, Any]) -> None:
    """
    Replace any prior normalized rows for this demo with the freshly parsed ones.

    Kept synchronous + transactional: we wipe + insert in a single commit so
    aggregate endpoints never see a half-populated demo.
    """
    db = SessionLocal()
    try:
        # Wipe prior rows (idempotent re-processing).
        db.query(DemoPlayer).filter(DemoPlayer.demo_id == demo_id).delete()
        db.query(DemoRound).filter(DemoRound.demo_id == demo_id).delete()
        db.query(DemoKill).filter(DemoKill.demo_id == demo_id).delete()

        # Players
        for p in analysis.get("players", []):
            db.add(DemoPlayer(
                demo_id=demo_id,
                steam_id=p["steamId"],
                name=p["name"],
                team=p["team"],
                kills=p.get("kills", 0),
                deaths=p.get("deaths", 0),
                assists=p.get("assists", 0),
                headshots=p.get("headshots", 0),
                adr=p.get("adr", 0.0),
                kast=p.get("kast", 0),
                hs_percent=p.get("hsPercent", 0),
                rating=p.get("rating", 0.0),
                opening_kills=p.get("openingKills", 0),
                opening_deaths=p.get("openingDeaths", 0),
                clutch_wins=p.get("clutchWins", 0),
                clutch_attempts=p.get("clutchAttempts", 0),
                utility_damage=p.get("utilityDamage", 0),
                flash_assists=p.get("flashAssists", 0),
                mvp_rounds=p.get("mvpRounds", 0),
            ))

        # Rounds
        for r in analysis.get("rounds", []):
            db.add(DemoRound(
                demo_id=demo_id,
                number=r["number"],
                half=r["half"],
                winner=r["winner"],
                end_reason=r["endReason"],
                duration_seconds=r["durationSeconds"],
                start_tick=r["startTick"],
                end_tick=r["endTick"],
                ct_equipment_value=r["ctEquipmentValue"],
                tt_equipment_value=r["ttEquipmentValue"],
                bomb_planted=r["bombPlanted"],
                bomb_site=r.get("bombSite"),
            ))

        # Kills
        for k in analysis.get("kills", []):
            kpos = k["killerPos"]
            vpos = k["victimPos"]
            db.add(DemoKill(
                demo_id=demo_id,
                round_number=k["round"],
                tick=k["tick"],
                killer_steam_id=k["killer"],
                victim_steam_id=k["victim"],
                weapon=k["weapon"],
                headshot=k["headshot"],
                through_smoke=k.get("throughSmoke", False),
                blinded=k.get("blinded", False),
                is_opening_kill=k.get("isOpeningKill", False),
                killer_x=float(kpos[0]),
                killer_y=float(kpos[1]),
                victim_x=float(vpos[0]),
                victim_y=float(vpos[1]),
            ))

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def process_demo(demo_id: int, file_path: str) -> None:
    """
    Main async demo processing pipeline.

    Steps:
        1. Mark as 'processing'
        2. Walk through stages with progress updates
        3. Parse the demo file
        4. Persist analysis_data + match metadata + normalized rows
        5. Mark as 'completed' (or 'failed' on error)
    """
    try:
        _update_demo(demo_id, status="processing", processing_progress=0, error_message=None)

        # Walk the progress stages; in production each maps to a real parser phase.
        for label, pct in STAGES[:-1]:
            logger.info("demo %s: %s (%d%%)", demo_id, label, pct)
            _update_demo(demo_id, processing_progress=pct)
            await asyncio.sleep(0.6)  # yields control + simulates work for stub mode

        parser = get_parser()
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
        _persist_normalized(demo_id, analysis)
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
    Fire-and-forget scheduler — kept for backwards compatibility with code that
    imports it directly. Production paths should go through
    :func:`services.queue.get_queue` instead.
    """
    return asyncio.create_task(process_demo(demo_id, file_path))
