"""
Demo storage service.

Phase 3A defines a small ``DemoStorage`` protocol so call sites depend on the
interface, not on a concrete class. The default backend is the local
filesystem (``LocalDemoStorage``); ``S3DemoStorage`` ships in Phase 3B for
MinIO/S3 deployments. Pick the backend through ``settings.storage_backend``
and resolve via :func:`get_storage`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol
from uuid import uuid4

from fastapi import UploadFile

from core.settings import get_settings


UPLOAD_DIR = Path(__file__).resolve().parent.parent / "storage" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Stream demos in 1MB chunks — CS2 demos can be 500MB+, never load whole file in memory.
CHUNK_SIZE = 1024 * 1024


class DemoStorage(Protocol):
    """Interface every storage backend must implement."""

    def save_demo(self, file: UploadFile) -> tuple[str, str, str]:
        """Persist the upload and return (demo_uuid, storage_filename, abs_path)."""
        ...

    def get_path(self, storage_filename: str) -> Path:
        """Return a local-filesystem path the parser can read from."""
        ...

    def delete_demo(self, storage_filename: str) -> bool:
        ...


class LocalDemoStorage:
    """Local filesystem storage. Default backend in dev."""

    def save_demo(self, file: UploadFile) -> tuple[str, str, str]:
        demo_id = str(uuid4())
        extension = Path(file.filename or "").suffix or ".dem"
        storage_filename = f"{demo_id}{extension}"
        output_path = UPLOAD_DIR / storage_filename

        with output_path.open("wb") as buffer:
            while True:
                chunk = file.file.read(CHUNK_SIZE)
                if not chunk:
                    break
                buffer.write(chunk)

        return demo_id, storage_filename, str(output_path)

    def get_path(self, storage_filename: str) -> Path:
        return UPLOAD_DIR / storage_filename

    def delete_demo(self, storage_filename: str) -> bool:
        path = self.get_path(storage_filename)
        if path.exists():
            path.unlink()
            return True
        return False


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


import logging

_logger = logging.getLogger("riftscope.storage")
_singleton: DemoStorage | None = None


def get_storage() -> DemoStorage:
    """
    Return the active storage backend (cached as module singleton).

    When ``settings.storage_backend == "s3"`` we import and instantiate
    :class:`services.storage_s3.S3DemoStorage`. If that fails (missing
    boto3, missing credentials, network at startup) we LOG LOUDLY and fall
    back to local storage — silent fallbacks were causing demos to land
    on the API VM's disk when ops thought they were going to R2.
    """
    global _singleton
    if _singleton is not None:
        return _singleton

    settings = get_settings()
    if settings.storage_backend == "s3":
        try:
            from services.storage_s3 import S3DemoStorage

            _singleton = S3DemoStorage(
                endpoint=settings.s3_endpoint,
                bucket=settings.s3_bucket,
                access_key=settings.s3_access_key,
                secret_key=settings.s3_secret_key,
                region=settings.s3_region or "auto",
            )
            _logger.info(
                "S3 storage active: bucket=%s endpoint=%s",
                settings.s3_bucket, settings.s3_endpoint,
            )
            return _singleton
        except Exception:
            _logger.exception(
                "S3 storage init FAILED — falling back to LocalDemoStorage. "
                "Set STORAGE_BACKEND=local explicitly to silence this."
            )

    _singleton = LocalDemoStorage()
    _logger.info("Local FS storage active: %s", UPLOAD_DIR)
    return _singleton


def reset_storage_singleton() -> None:
    """Force-invalidate the cached storage backend (tests + hot-reload)."""
    global _singleton
    _singleton = None
