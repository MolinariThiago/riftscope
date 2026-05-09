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


_singleton: DemoStorage | None = None


def get_storage() -> DemoStorage:
    """
    Return the active storage backend (cached).

    Phase 3B: when ``settings.storage_backend == "s3"``, import and return
    ``S3DemoStorage`` configured from S3 settings. Until that ships we always
    return the local backend.
    """
    global _singleton
    if _singleton is not None:
        return _singleton

    settings = get_settings()
    if settings.storage_backend == "s3":  # pragma: no cover — Phase 3B
        try:
            from services.storage_s3 import S3DemoStorage  # type: ignore

            _singleton = S3DemoStorage(
                endpoint=settings.s3_endpoint,
                bucket=settings.s3_bucket,
                access_key=settings.s3_access_key,
                secret_key=settings.s3_secret_key,
                region=settings.s3_region,
            )
            return _singleton
        except Exception:
            # Fall through to local if S3 backend isn't installed yet.
            pass

    _singleton = LocalDemoStorage()
    return _singleton
