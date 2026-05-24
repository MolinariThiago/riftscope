"""
Celery entry point — thin re-export of the Celery app + task defined
in :mod:`workers.demo_worker`.

We keep the Celery instance co-located with the task code (in
``demo_worker.py``) so there's exactly one place to look when
debugging the pipeline. This module exists so the canonical
``celery -A workers.celery_app worker`` invocation works AND so
``services.queue`` can import the task without pulling the full
``demo_worker`` module on every queue lookup.

Both of these commands are equivalent; pick whichever you prefer:

    celery -A workers.demo_worker worker --pool=solo --loglevel=info
    celery -A workers.celery_app  worker --pool=solo --loglevel=info
"""

from workers.demo_worker import celery, process_demo_task

__all__ = ["celery", "process_demo_task"]
