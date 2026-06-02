"""
Fire-and-forget background tasks that survive garbage collection.

``asyncio.create_task`` only keeps a **weak** reference to the task it
returns — the event loop does not own it. So a fire-and-forget task whose
return value is discarded can be garbage-collected mid-run, which is exactly
what made pro-demo parsing die silently at "Procesando archivo..." and never
reach "completed".

Holding a strong reference in a module-level set until the task finishes
fixes it. The done-callback removes the reference and logs any exception the
task raised (otherwise a crash in a fire-and-forget task is swallowed).

Usage:
    from core.bg import spawn
    spawn(process_demo(demo_id, path), name=f"parse-demo-{demo_id}")
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Coroutine

logger = logging.getLogger("riftscope.bg")

# Strong references to in-flight tasks. The done-callback discards each one
# when it settles, so this set only ever holds tasks that are still running.
_TASKS: set[asyncio.Task] = set()


def spawn(coro: Coroutine[Any, Any, Any], *, name: str | None = None) -> asyncio.Task:
    """Schedule ``coro`` on the running loop and keep it alive until it ends.

    Must be called from within a running event loop (every HTTP handler and
    the scheduler loop qualifies).
    """
    task = asyncio.create_task(coro, name=name)
    _TASKS.add(task)

    def _on_done(t: asyncio.Task) -> None:
        _TASKS.discard(t)
        if t.cancelled():
            logger.warning("background task %s was cancelled", t.get_name())
            return
        exc = t.exception()
        if exc is not None:
            logger.error(
                "background task %s failed: %r", t.get_name(), exc, exc_info=exc
            )

    task.add_done_callback(_on_done)
    return task
