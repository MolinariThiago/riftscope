"""
Quick sanity check for the configured storage backend.

Usage:
    cd apps/api
    .\\.venv\\Scripts\\python.exe scripts/check_storage.py

For S3 / Cloudflare R2 it does three things:
    1. Construct the boto3 client (validates endpoint + credentials format).
    2. Run a HEAD on the bucket (validates network + bucket name).
    3. Upload + download + delete a 1KB test object (validates write/read perms).

For local FS it just verifies the upload directory is writable.

Exit code 0 on success, 1 on any failure — safe for CI gates.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.settings import get_settings
from services.storage import get_storage, reset_storage_singleton


def _green(s: str) -> str:
    return f"\033[32m{s}\033[0m"


def _red(s: str) -> str:
    return f"\033[31m{s}\033[0m"


def main() -> int:
    settings = get_settings()
    print(f"Backend: {settings.storage_backend}")
    print()

    if settings.storage_backend == "s3":
        print(f"S3_ENDPOINT:   {settings.s3_endpoint or '(empty)'}")
        print(f"S3_BUCKET:     {settings.s3_bucket}")
        print(f"S3_REGION:     {settings.s3_region or 'auto'}")
        print(f"ACCESS_KEY:    {'*' * 8 + (settings.s3_access_key[-4:] if settings.s3_access_key else '(empty)')}")
        print(f"SECRET_KEY:    {'set' if settings.s3_secret_key else '(empty)'}")
        print()

    reset_storage_singleton()
    try:
        storage = get_storage()
        print(_green(f"OK — instantiated {type(storage).__name__}"))
    except Exception as exc:
        print(_red(f"FAIL — could not init storage: {exc}"))
        return 1

    # Round-trip a 1KB test blob
    payload = b"riftscope-health-check\n" * 64
    test_key = f"_healthcheck_{uuid4().hex}.bin"

    # Wrap bytes in a fake UploadFile-ish object that exposes ``.file`` (a
    # file-like with .read()) and ``.filename`` — that's what both backends use.
    class _Fake:
        def __init__(self, data: bytes):
            import io
            self.file = io.BytesIO(data)
            self.filename = test_key

    fake = _Fake(payload)
    try:
        demo_id, filename, abs_path = storage.save_demo(fake)
        print(_green(f"OK — upload: {abs_path}"))
    except Exception as exc:
        print(_red(f"FAIL — upload: {exc}"))
        return 1

    # Download
    try:
        downloader = getattr(storage, "download_to_local", None)
        if downloader:
            local = downloader(filename)
            data = Path(local).read_bytes()
            if data != payload:
                print(_red(f"FAIL — payload mismatch after roundtrip (got {len(data)}B, expected {len(payload)}B)"))
                return 1
            print(_green(f"OK — download + content match ({len(data)}B)"))
            # Clean up local temp if it's not the canonical upload dir
            if Path(local).parent.name in {"riftscope"} or "/tmp" in str(local) or tempfile.gettempdir() in str(local):
                Path(local).unlink(missing_ok=True)
    except Exception as exc:
        print(_red(f"FAIL — download: {exc}"))
        return 1

    # Presigned URL
    try:
        url = storage.generate_presigned_url(filename, expires_in=60)
        print(_green(f"OK — presigned URL: {url[:80]}{'...' if len(url) > 80 else ''}"))
    except Exception as exc:
        print(_red(f"FAIL — presign: {exc}"))
        return 1

    # Cleanup
    try:
        storage.delete_demo(filename)
        print(_green("OK — delete"))
    except Exception as exc:
        print(_red(f"FAIL — delete: {exc}"))
        return 1

    print()
    print(_green("Storage health check passed."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
