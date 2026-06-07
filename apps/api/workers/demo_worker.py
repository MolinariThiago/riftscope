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
import re
import sys as _sys
from pathlib import Path
from typing import Any

from core.utc import utcnow_naive
from db.database import SessionLocal
from db.models.demo import Demo, DemoKill, DemoPlayer, DemoRound
from db.models.insight import DemoInsight
from db.models.round_tactic import RoundTactic
from services.anti_strat import detect_round_tactics
from services.insights import compute_insights, ENGINE_VERSION as INSIGHTS_VERSION
from services.parser_factory import get_parser
from services.storage import get_storage

logger = logging.getLogger("riftscope.worker")

# Matches s3://bucket/key — the canonical URI we get from S3DemoStorage.save_demo.
_S3_URI = re.compile(r"^s3://([^/]+)/(.+)$")

# Global parse semaphore — bounds how many demos can be parsed AT THE
# SAME TIME across the whole process. Railway Hobby has 512 MB total
# for the API + scheduler + parser, and the parser alone peaks around
# 400 MB. Running two in parallel is a guaranteed OOM kill (exit -9).
#
# This bites HARD on Bo3 imports: _persist_demo_bytes spawns one
# process_demo per .dem inside the archive, so a Bo3 was spawning 3-4
# parsers in parallel and ALL of them got SIGKILL'd by the OOM-killer.
#
# Lazy because the loop doesn't exist at module import.
_parse_semaphore: asyncio.Semaphore | None = None


def _get_parse_semaphore() -> asyncio.Semaphore:
    global _parse_semaphore
    if _parse_semaphore is None:
        _parse_semaphore = asyncio.Semaphore(1)
    return _parse_semaphore


def _resolve_local_demo_path(
    file_path: str,
    progress_cb=None,
) -> tuple[str, str | None]:
    """
    Make sure ``file_path`` is a real local file path before we hand it
    to the parser.

    Returns ``(local_path, cleanup_path)`` where ``cleanup_path`` is the
    file to delete after parsing (``None`` if we got a local file we
    don't own). The optional ``progress_cb(bytes_done, total)`` fires
    during any S3 download (no-op once the file is local).

    Resolution order:
      1. ``s3://bucket/key`` URI → always download via the active storage
         (works when STORAGE_BACKEND=s3).
      2. Local path that exists on disk → use it directly, no cleanup.
      3. Local path that DOESN'T exist + S3 creds are configured →
         opportunistically fall back to S3 using the basename as key.
         This keeps demos uploaded under STORAGE_BACKEND=s3 readable
         after switching to STORAGE_BACKEND=local for development.
    """
    m = _S3_URI.match(file_path)
    if m:
        _, key = m.group(1), m.group(2)
        storage = get_storage()
        downloader = getattr(storage, "download_to_local", None)
        if downloader is None:
            raise RuntimeError(
                f"Got an s3:// URI but the active storage backend "
                f"({type(storage).__name__}) doesn't implement download_to_local()."
            )
        try:
            local_path = downloader(key, progress_cb=progress_cb)
        except TypeError:
            local_path = downloader(key)
        logger.info("Resolved %s → %s", file_path, local_path)
        return str(local_path), str(local_path)

    # Local-path branch.
    local = Path(file_path)
    if local.exists():
        return file_path, None

    # File doesn't exist locally — likely a leftover from a previous
    # STORAGE_BACKEND=s3 session. Try R2 as a fallback if credentials are
    # configured, using the basename as the object key.
    fallback_path = _fallback_s3_download(local.name, progress_cb=progress_cb)
    if fallback_path is not None:
        logger.info(
            "Local file missing (%s); recovered from R2 → %s",
            file_path, fallback_path,
        )
        return str(fallback_path), str(fallback_path)

    raise FileNotFoundError(
        f"Demo file not found locally ({file_path}) and S3 fallback is "
        f"unavailable. Re-upload the demo or set STORAGE_BACKEND=s3 + S3 "
        f"credentials in .env so the worker can pull it from R2."
    )


def _fallback_s3_download(key: str, progress_cb=None) -> Path | None:
    """
    Try to download ``key`` from S3 using credentials in env, bypassing
    the active storage singleton. Returns the local path on success, or
    ``None`` if S3 isn't configured / the object doesn't exist.

    Caches the file under ``apps/api/storage/uploads/<key>`` so future
    re-parses skip the download entirely.
    """
    try:
        from core.settings import get_settings
        from services.storage_s3 import S3DemoStorage
        from services.storage import UPLOAD_DIR
    except Exception as e:
        logger.warning("S3 fallback unavailable (imports failed): %s", e)
        return None

    settings = get_settings()
    if not (settings.s3_endpoint and settings.s3_bucket
            and settings.s3_access_key and settings.s3_secret_key):
        logger.info("S3 fallback skipped — no S3 credentials in env.")
        return None

    try:
        s3 = S3DemoStorage(
            endpoint=settings.s3_endpoint,
            bucket=settings.s3_bucket,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            region=settings.s3_region or "auto",
        )
    except Exception as e:
        logger.warning("S3 fallback init failed: %s", e)
        return None

    # Download to the canonical local cache so subsequent re-parses are
    # instant. If the download fails (404 etc.), bail out cleanly.
    target = UPLOAD_DIR / key
    try:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("Trying R2 fallback for key=%s → %s", key, target)
        # Per-call accumulator (boto3 reports each chunk as a delta).
        acc = {"n": 0}
        def _cb(delta: int) -> None:
            acc["n"] += delta
            if progress_cb:
                try:
                    progress_cb(acc["n"], None)
                except Exception:
                    pass
        s3.s3_client.download_file(
            s3.bucket,
            key,
            str(target),
            Callback=_cb if progress_cb else None,
        )
        if not target.exists() or target.stat().st_size == 0:
            return None
        return target
    except Exception as e:
        logger.warning("R2 fallback failed for %s: %s", key, e)
        try:
            if target.exists():
                target.unlink()
        except OSError:
            pass
        return None


def _update_demo(demo_id: int, **fields: Any) -> None:
    """
    Open a fresh session, mutate the demo row, commit. Survives long tasks.

    Tolerates transient ``database is locked`` errors — those are usually
    the API process polling /status mid-commit. Two retries with backoff,
    then we log + swallow (progress updates are nice-to-have, not
    critical). The final ``status="completed"`` write also goes through
    here but errors there are still logged so the user sees the demo
    never moves out of ``processing``.
    """
    import time as _t
    for attempt in range(3):
        db = SessionLocal()
        try:
            demo = db.query(Demo).filter(Demo.id == demo_id).first()
            if not demo:
                return
            for key, value in fields.items():
                setattr(demo, key, value)
            db.commit()
            return
        except Exception as exc:
            try:
                db.rollback()
            except Exception:
                pass
            # Last retry — log and give up. Don't let progress-bar
            # updates kill the whole task.
            if attempt == 2:
                logger.warning(
                    "_update_demo(%s, %s) failed after retries: %s",
                    demo_id, list(fields.keys()), exc,
                )
                return
            _t.sleep(0.5 * (attempt + 1))
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
                clan_name=p.get("clan"),
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
                total_damage=p.get("totalDamage", 0),
                kast_rounds=p.get("kastRounds", 0),
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


def _persist_insights(demo_id: int, analysis: dict[str, Any]) -> None:
    """
    Compute and persist the heuristic insights payload for this demo.

    Idempotent: replaces any prior row for the demo so reprocessing always
    yields the latest engine_version. Failures are logged but never block
    the rest of the pipeline — the demo is still marked completed.
    """
    db = SessionLocal()
    try:
        try:
            payload = compute_insights(analysis)
        except Exception:
            logger.exception("insights computation failed for demo %s", demo_id)
            return

        existing = db.query(DemoInsight).filter(DemoInsight.demo_id == demo_id).first()
        if existing:
            existing.engine_version = payload.get("engine_version", INSIGHTS_VERSION)
            existing.summary = payload.get("summary", {})
            existing.rounds = payload.get("rounds", [])
            existing.players = payload.get("players", [])
            existing.heatmap = payload.get("heatmap", {})
            existing.computed_at = utcnow_naive()
        else:
            db.add(DemoInsight(
                demo_id=demo_id,
                engine_version=payload.get("engine_version", INSIGHTS_VERSION),
                summary=payload.get("summary", {}),
                rounds=payload.get("rounds", []),
                players=payload.get("players", []),
                heatmap=payload.get("heatmap", {}),
            ))
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("persist_insights db failure for demo %s", demo_id)
    finally:
        db.close()


def _persist_round_tactics(demo_id: int, analysis: dict[str, Any], map_name: str) -> None:
    """
    Classify each round's T-side play (anti-strat) and persist one
    :class:`RoundTactic` row per round.

    Idempotent: wipes prior rows for the demo first so reprocessing always
    reflects the latest classifier. Failures are logged but never block the
    pipeline — the demo is still marked completed.
    """
    db = SessionLocal()
    try:
        try:
            plays = detect_round_tactics(analysis, map_name)
        except Exception:
            logger.exception("anti-strat detection failed for demo %s", demo_id)
            return

        db.query(RoundTactic).filter(RoundTactic.demo_id == demo_id).delete()
        for p in plays:
            db.add(RoundTactic(
                demo_id=demo_id,
                round_number=p["round_number"],
                half=p.get("half", 1),
                team_name=p.get("team_name"),
                map_name=map_name,
                side=p.get("side", "tt"),
                site=p.get("site"),
                type=p.get("type", "default"),
                plant_time=p.get("plant_time"),
                won=p.get("won", False),
                util_signature=p.get("util_signature"),
            ))
        db.commit()
        logger.info("demo %s: persisted %d round tactics", demo_id, len(plays))
    except Exception:
        db.rollback()
        logger.exception("persist_round_tactics db failure for demo %s", demo_id)
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

    Wrapped by ``_get_parse_semaphore()`` so only ONE demo is being
    parsed at a time process-wide. Without this, Bo3 imports
    (which spawn one process_demo per .dem inside the archive)
    triggered N parallel parses that all OOM-killed each other.
    """
    # Wait for our turn before doing ANY work. We hold the slot
    # through the entire pipeline (download → parse → persist) so
    # at most one parser child process is alive at a time.
    async with _get_parse_semaphore():
        await _process_demo_locked(demo_id, file_path)


async def _process_demo_locked(demo_id: int, file_path: str) -> None:
    """Inner pipeline that runs while we hold the parse semaphore."""
    import time as _time
    t0 = _time.perf_counter()

    try:
        _update_demo(demo_id, status="processing", processing_progress=0, error_message=None)
        logger.info("demo %s: starting (0%%)", demo_id)

        # ---- Stage 1: download (0% → 40%) -----------------------------
        # The download is usually the longest single step (R2 → worker
        # over a residential link can take 30-120 s for a 200-400 MB
        # demo), so we map its byte progress directly onto the bar.
        # We THROTTLE persistence to every 5% so a 300 MB download
        # doesn't fire 100+ DB writes (each was a fresh session +
        # commit; on slower DBs they added up).
        last_pct = {"v": -1}

        def _download_progress(done: int, total: int | None) -> None:
            if not total or total <= 0:
                pct = min(38, int(done / (1024 * 1024) * 0.2))
            else:
                pct = int(40 * (done / total))
            # Only persist every 5 percent ticks to avoid hammering DB.
            quantized = pct - (pct % 5)
            if quantized != last_pct["v"]:
                last_pct["v"] = quantized
                _update_demo(demo_id, processing_progress=quantized)

        t_dl = _time.perf_counter()
        local_path, cleanup_path = _resolve_local_demo_path(
            file_path, progress_cb=_download_progress,
        )
        dl_elapsed = _time.perf_counter() - t_dl
        _update_demo(demo_id, processing_progress=40)
        logger.info(
            "demo %s: download done in %.1fs (40%%)", demo_id, dl_elapsed,
        )

        # ---- Stage 2: parse + persist in an ISOLATED SUBPROCESS -------
        # Why subprocess: demoparser2 holds 400 MB+ of pandas data at
        # peak. On Railway Hobby (512 MB total budget shared with the
        # API + scheduler) this routinely OOM-killed the whole
        # container, taking the API down with it.  Spawning a child
        # process means:
        #   - The parser's RAM is independent of the API's RAM.
        #   - An OOM kill takes ONLY the child. The parent watches
        #     the exit code and marks the demo failed cleanly.
        #   - When the child exits, the OS reclaims its entire heap.
        #     No accumulating high-water mark across demos.
        # The subprocess does the full persist (analysis_data +
        # normalized rows + insights) directly to the DB — we never
        # marshal the heavy ``analysis`` dict back through IPC.
        _update_demo(demo_id, processing_progress=45)
        logger.info("demo %s: spawning parse subprocess (45%%)", demo_id)
        t_parse = _time.perf_counter()
        return_code: int | None = None

        try:
            proc = await asyncio.create_subprocess_exec(
                _sys.executable, "-m", "workers.demo_parse_subprocess",
                str(demo_id), str(local_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                # Run from the apps/api package root so the ``workers``
                # module import resolves the same way it does for the
                # main app.
                cwd=str(Path(__file__).resolve().parent.parent),
            )

            # Pump the child's stdout into our logger so its progress
            # shows up in the same stream as the rest of the app.
            async def _pump_logs() -> None:
                if proc.stdout is None:
                    return
                while True:
                    line = await proc.stdout.readline()
                    if not line:
                        break
                    logger.info(
                        "[sub %s] %s",
                        demo_id,
                        line.decode(errors="replace").rstrip(),
                    )

            pump_task = asyncio.create_task(_pump_logs())
            try:
                return_code = await proc.wait()
            finally:
                # Make sure the log pump drains everything before we
                # interpret the exit code.
                try:
                    await asyncio.wait_for(pump_task, timeout=2.0)
                except asyncio.TimeoutError:
                    pump_task.cancel()
        finally:
            # Clean up the temporary local file regardless of how
            # the subprocess fared.
            if cleanup_path is not None:
                try:
                    Path(cleanup_path).unlink(missing_ok=True)
                except Exception:
                    logger.warning("Failed to clean temp demo file %s", cleanup_path)

        parse_elapsed = _time.perf_counter() - t_parse
        total_elapsed = _time.perf_counter() - t0

        # Interpret the subprocess exit code.
        if return_code == 0:
            logger.info(
                "demo %s: subprocess succeeded — total %.1fs "
                "[download=%.1fs parse+persist=%.1fs]",
                demo_id, total_elapsed, dl_elapsed, parse_elapsed,
            )
            # Subprocess already updated the Demo row to completed.
            return

        # Non-zero exit. SIGKILL by the OOM-killer shows as
        # ``-9`` on POSIX or ``137`` (128 + 9) when interpreted as an
        # unsigned exit code by the shell layer.  ``139`` is SIGSEGV,
        # rare but worth flagging too. In any of those, the child
        # almost certainly never ran its except-handler so we mark
        # the demo failed ourselves with a clear message.
        OOM_CODES = {-9, 9, 137, 139}
        if return_code in OOM_CODES:
            msg = (
                f"Parser killed mid-run (exit {return_code} — likely OOM). "
                f"Try a smaller demo or upgrade the worker plan."
            )
            logger.error("demo %s: %s", demo_id, msg)
            _update_demo(demo_id, status="failed", error_message=msg)
        else:
            # Subprocess returned a non-zero code through its own
            # except path — it should have marked the demo failed
            # before exiting.  Double-check the row state; if it's
            # still ``processing``, mark failed here as a safety net.
            from db.database import SessionLocal as _SL
            from db.models.demo import Demo as _Demo
            db = _SL()
            try:
                d = db.query(_Demo).filter(_Demo.id == demo_id).first()
                if d and d.status == "processing":
                    d.status = "failed"
                    d.error_message = (
                        f"Subprocess exited {return_code} without updating status."
                    )
                    db.commit()
            finally:
                db.close()
            logger.error(
                "demo %s: subprocess exited %s after %.1fs",
                demo_id, return_code, parse_elapsed,
            )

    except Exception as exc:  # pragma: no cover — defensive
        elapsed = _time.perf_counter() - t0
        logger.exception("demo %s failed after %.1fs", demo_id, elapsed)
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

    Uses :func:`core.bg.spawn` so the task keeps a strong reference and isn't
    garbage-collected mid-parse.
    """
    from core.bg import spawn

    return spawn(process_demo(demo_id, file_path), name=f"parse-demo-{demo_id}")


# =============================================================================
# Celery app (Phase 3B)
# =============================================================================
#
# When ``QUEUE_BACKEND=celery`` the upload endpoint enqueues a
# ``process_demo_task`` message instead of awaiting it in-process. The
# Celery worker (this very file) picks it up and runs the same async
# pipeline via ``asyncio.run`` — keeping a single code path means we
# don't fork the parser logic between dev and prod.
#
# ``celery`` is the conventional attribute name the CLI looks up, so
# both invocations work:
#
#   celery -A workers.demo_worker worker --pool=solo --loglevel=info
#   celery -A workers.celery_app  worker --pool=solo --loglevel=info
#
# On Windows the default ``prefork`` pool doesn't work — the runtime
# can't fork on win32 — so ``--pool=solo`` (or ``threads``) is
# mandatory. In prod (Linux container) ``prefork`` is fine; just drop
# the flag.

try:
    from celery import Celery
except ImportError:  # pragma: no cover — celery is in requirements-prod
    Celery = None  # type: ignore[assignment]


if Celery is not None:
    from core.settings import get_settings as _get_settings

    _settings = _get_settings()

    celery = Celery(
        "riftscope",
        broker=_settings.redis_url,
        backend=_settings.redis_url,
    )

    # Conservative defaults for Windows + SQLite dev. ``acks_late=True``
    # ensures a crashed worker requeues its in-flight job; the 1-hour
    # ``task_time_limit`` is well above the slowest parse we've seen
    # (~10 min for a long Mirage demo on cold cache).
    celery.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="UTC",
        enable_utc=True,
        worker_prefetch_multiplier=1,
        task_acks_late=True,
        task_time_limit=60 * 60,
        task_soft_time_limit=55 * 60,
        # ``broker_connection_retry_on_startup`` silences a warning
        # introduced in Celery 5.3 — we want the legacy behaviour.
        broker_connection_retry_on_startup=True,
    )

    @celery.task(name="process_demo", bind=True)
    def process_demo_task(self, demo_id: int, file_path: str):  # noqa: ANN001
        """Celery task wrapper around the async ``process_demo`` pipeline.

        We bridge from sync (Celery) to async (our pipeline) with
        ``asyncio.run`` — a fresh event loop per task is correct
        because Celery tasks are processed sequentially per worker.
        """
        try:
            asyncio.run(process_demo(demo_id, file_path))
        except Exception as exc:
            # The pipeline already writes ``status="failed"`` to the
            # DB on exceptions; re-raise so Celery records the task as
            # failed in its result backend too.
            logger.exception("Celery task for demo %s failed", demo_id)
            raise self.retry(exc=exc, max_retries=0)  # noqa: B904
else:  # pragma: no cover — celery missing
    celery = None  # type: ignore[assignment]

    def process_demo_task(*_args, **_kwargs):  # type: ignore[no-redef]
        raise RuntimeError(
            "Celery is not installed. Install requirements-prod.txt or "
            "set QUEUE_BACKEND=inprocess."
        )
