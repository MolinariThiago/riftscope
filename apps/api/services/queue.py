"""
Queue abstraction.

Phase 3A defines a small ``DemoQueue`` protocol so the upload endpoint never
imports a concrete queue. The default backend (``InProcessQueue``) wraps
FastAPI's ``BackgroundTasks`` — perfect for dev. The Celery backend lives
behind the same interface and ships in Phase 3B.

Resolve via :func:`get_queue` and switch with ``settings.queue_backend``.
"""

from __future__ import annotations

from typing import Awaitable, Callable, Protocol

from fastapi import BackgroundTasks

from core.settings import get_settings


# A demo job is "do this work for (demo_id, file_path)".
DemoJob = Callable[[int, str], Awaitable[None]]


class DemoQueue(Protocol):
    def enqueue(
        self,
        background_tasks: BackgroundTasks,
        job: DemoJob,
        demo_id: int,
        file_path: str,
    ) -> None:
        ...


class InProcessQueue:
    """Run the job inside the same FastAPI process via BackgroundTasks."""

    def enqueue(
        self,
        background_tasks: BackgroundTasks,
        job: DemoJob,
        demo_id: int,
        file_path: str,
    ) -> None:
        async def _run() -> None:
            await job(demo_id, file_path)

        background_tasks.add_task(_run)


class CeleryQueue:  # pragma: no cover — Phase 3B
    """Stub Celery dispatcher. Activates when celery is installed and configured."""

    def enqueue(
        self,
        background_tasks: BackgroundTasks,
        job: DemoJob,
        demo_id: int,
        file_path: str,
    ) -> None:
        try:
            from workers.celery_app import process_demo_task  # type: ignore

            process_demo_task.delay(demo_id, file_path)
        except Exception:
            # Fall back to in-process if Celery isn't wired yet.
            InProcessQueue().enqueue(background_tasks, job, demo_id, file_path)


_singleton: DemoQueue | None = None


def get_queue() -> DemoQueue:
    global _singleton
    if _singleton is not None:
        return _singleton

    settings = get_settings()
    _singleton = CeleryQueue() if settings.queue_backend == "celery" else InProcessQueue()
    return _singleton
