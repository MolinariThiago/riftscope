"""
Standalone parse + persist entry point — runs as a child process.

Invoked by ``demo_worker.process_demo`` as:

    python -m workers.demo_parse_subprocess <demo_id> <local_path>

The whole point of running this in a child process is memory
isolation: the parser holds 400 MB+ of pandas frames at peak, the
API holds ~80 MB at idle, and Railway Hobby gives us 512 MB total.
Without isolation, every Bo3 parse risks OOM-killing the entire
container — taking the API and the scheduler down with it.

By spawning a fresh Python process for the parse:

  - The child starts with ~50 MB of its own heap, independent of the
    API's resident memory.
  - If the child gets SIGKILL'd by the OOM killer mid-parse, only
    the child dies. The parent watches the exit code, marks the
    demo failed with a clear message, and moves on.
  - When the child exits cleanly the OS reclaims its entire heap.
    No accumulating high-water mark across demos.

The child writes its result directly to the database via the same
DemoWorker helpers the parent uses — no IPC marshalling of the
heavy ``analysis`` dict, no temp files, no JSON round-trips.
"""

from __future__ import annotations

import logging
import sys
import time


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | parse-sub[%(process)d] | %(message)s",
)
logger = logging.getLogger("riftscope.parse_sub")


def main() -> None:
    if len(sys.argv) != 3:
        print(
            "usage: python -m workers.demo_parse_subprocess <demo_id> <local_path>",
            file=sys.stderr,
        )
        sys.exit(2)

    try:
        demo_id = int(sys.argv[1])
    except ValueError:
        print(f"invalid demo_id: {sys.argv[1]}", file=sys.stderr)
        sys.exit(2)
    local_path = sys.argv[2]

    # Imports are deferred so this module is cheap to import from the
    # parent (no SQLAlchemy engine setup happens just because the
    # parent referenced our module name).
    from core.utc import utcnow_naive
    from services.parser_factory import get_parser
    from workers.demo_worker import (
        _persist_insights,
        _persist_normalized,
        _persist_round_tactics,
        _update_demo,
    )
    # CRITICAL: import ALL ORM models BEFORE any DB query runs.
    # SQLAlchemy resolves relationships lazily — when _update_demo
    # touches Demo, the mapper needs every related class (User for
    # Demo.uploader, etc.) to be defined. If the subprocess only
    # imports Demo, mapper init crashes with:
    #   "expression 'User' failed to locate a name ('User')"
    # and every DB write in the subprocess silently fails (the parse
    # runs OK but no status updates land, so demos look stuck).
    from db.models.user import User  # noqa: F401
    from db.models.demo import Demo, DemoKill, DemoPlayer, DemoRound  # noqa: F401
    from db.models.pro_match import ProMatch  # noqa: F401
    from db.models.insight import DemoInsight  # noqa: F401
    from db.models.round_tactic import RoundTactic  # noqa: F401

    t0 = time.perf_counter()
    try:
        logger.info("demo %s: subprocess started, path=%s", demo_id, local_path)
        _update_demo(demo_id, processing_progress=50)

        # ---- Parse the demo ----------------------------------------
        parser = get_parser()
        analysis = parser.parse(local_path)
        meta = analysis["meta"]
        parse_elapsed = time.perf_counter() - t0
        logger.info(
            "demo %s: parse finished in %.1fs (95%%)", demo_id, parse_elapsed,
        )
        _update_demo(demo_id, processing_progress=95)

        # ---- Persist everything to the database --------------------
        t_persist = time.perf_counter()
        _update_demo(
            demo_id,
            status="completed",
            processing_progress=100,
            processed_at=utcnow_naive(),
            map_name=meta["map"],
            tick_rate=meta["tickrate"],
            duration_seconds=meta["durationSeconds"],
            round_count=meta["roundCount"],
            score_ct=(meta.get("scoreBySide") or meta["score"])[0],
            score_tt=(meta.get("scoreBySide") or meta["score"])[1],
            team_a_name=meta.get("teamA"),
            team_b_name=meta.get("teamB"),
            score_a=meta["score"][0],
            score_b=meta["score"][1],
            analysis_data=analysis,
        )
        _persist_normalized(demo_id, analysis)
        _persist_insights(demo_id, analysis)
        _persist_round_tactics(demo_id, analysis, meta["map"])
        persist_elapsed = time.perf_counter() - t_persist
        total_elapsed = time.perf_counter() - t0

        logger.info(
            "demo %s: completed (100%%) — total %.1fs "
            "[parse=%.1fs persist=%.1fs]",
            demo_id, total_elapsed, parse_elapsed, persist_elapsed,
        )
        # Don't bother with the parent's del + gc.collect() pattern —
        # this whole process is about to exit and the OS will reclaim
        # the entire heap in one shot.
        sys.exit(0)

    except Exception as exc:
        logger.exception("demo %s: subprocess failed: %s", demo_id, exc)
        # Best-effort: mark the demo failed so the UI doesn't spin
        # forever. If the DB itself is the failure surface we can't
        # do anything — the parent's exit-code handler will catch it.
        try:
            from workers.demo_worker import _update_demo as _update_demo_fb
            _update_demo_fb(demo_id, status="failed", error_message=str(exc)[:500])
        except Exception:
            logger.exception("demo %s: also failed to mark status", demo_id)
        sys.exit(1)


if __name__ == "__main__":
    main()
