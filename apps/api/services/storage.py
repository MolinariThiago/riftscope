"""
Demo storage service.

Currently uses local filesystem under apps/api/storage/uploads.
The interface (`save_demo`, `get_path`, `delete_demo`) mirrors what an S3/MinIO
backend will expose so the swap in Phase 3 is a one-line change.
"""

from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "storage" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Stream demos in 1MB chunks — CS2 demos can be 500MB+, never load whole file in memory.
CHUNK_SIZE = 1024 * 1024


class LocalDemoStorage:
    """Local filesystem storage. Drop-in replaceable by S3/MinIO in Phase 3."""

    def save_demo(self, file: UploadFile) -> tuple[str, str, str]:
        """
        Stream-save the upload.

        Returns:
            (demo_uuid, storage_filename, absolute_path)
        """
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
