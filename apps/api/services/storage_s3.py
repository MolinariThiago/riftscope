"""
S3 / S3-compatible storage backend.

Used for Cloudflare R2, AWS S3, MinIO, and any other S3-API-compatible
object store. Activated by setting ``STORAGE_BACKEND=s3`` and providing
the credentials in the env (see ``.env.example``).

Design choices:
- **Multipart streaming uploads** via boto3's high-level
  :meth:`upload_fileobj`, which auto-chunks large files (CS2 demos can be
  500MB+). No buffering of the full demo in memory.
- **Path-style addressing** required for R2 + MinIO compatibility.
- **Retries with adaptive backoff** for transient 5xx responses.
- **download_to_local()** copies the demo to a temp file so the worker
  (and ``demoparser2``) can read it like a normal local path — they don't
  understand ``s3://`` URLs.

Cloudflare R2 specifics:
- ``region`` must be ``"auto"`` (R2 ignores region but boto3 requires one).
- ``endpoint_url`` is mandatory: ``https://<account-id>.r2.cloudflarestorage.com``.
- Buckets can be served at custom domains via R2's public buckets feature
  or via signed URLs (which is what we use here).
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Optional
from uuid import uuid4

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
from fastapi import HTTPException, UploadFile

logger = logging.getLogger("riftscope.storage.s3")

# Multipart upload threshold + chunk size. boto3 splits the upload into
# parallel parts once the file crosses ``multipart_threshold``.
MULTIPART_THRESHOLD = 16 * 1024 * 1024   # 16 MB
MULTIPART_CHUNK = 16 * 1024 * 1024       # 16 MB per part
MAX_CONCURRENCY = 4                       # parallel parts


class S3DemoStorage:
    """S3-compatible storage. Drop-in for LocalDemoStorage."""

    def __init__(
        self,
        endpoint: str,
        bucket: str,
        access_key: str,
        secret_key: str,
        region: str = "auto",
    ):
        if not endpoint:
            # Cloudflare R2 + MinIO ALWAYS need an explicit endpoint. Only AWS
            # S3 itself works without one, and even then we want predictable
            # behavior — so fail loud at startup instead of silently routing
            # to AWS.
            raise RuntimeError(
                "S3_ENDPOINT is required when STORAGE_BACKEND=s3. "
                "For Cloudflare R2 use https://<account-id>.r2.cloudflarestorage.com"
            )
        if not bucket or not access_key or not secret_key:
            raise RuntimeError("S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY are required")

        self.bucket = bucket
        self.endpoint = endpoint
        self.s3_client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region or "auto",
            config=BotoConfig(
                signature_version="s3v4",
                # Path-style is REQUIRED for R2 (and most non-AWS providers).
                s3={"addressing_style": "path"},
                # Adaptive retries handle 5xx + throttle transparently.
                retries={"max_attempts": 5, "mode": "adaptive"},
                connect_timeout=10,
                read_timeout=60,
            ),
        )
        self._transfer_config = TransferConfig(
            multipart_threshold=MULTIPART_THRESHOLD,
            multipart_chunksize=MULTIPART_CHUNK,
            max_concurrency=MAX_CONCURRENCY,
            use_threads=True,
        )

    # ----------------------------------------------------------------------
    # DemoStorage protocol implementation
    # ----------------------------------------------------------------------

    def save_demo(self, file: UploadFile) -> tuple[str, str, str]:
        """
        Stream-upload a demo to the bucket. Returns
        ``(demo_uuid, storage_filename, abs_path)`` where ``abs_path`` is the
        canonical ``s3://bucket/key`` URI consumed by the worker.

        The worker will resolve the URI via :meth:`download_to_local` before
        running the parser.
        """
        demo_uuid = str(uuid4())
        extension = Path(file.filename or "").suffix.lower() or ".dem"
        storage_filename = f"{demo_uuid}{extension}"

        try:
            # ``upload_fileobj`` chunks large files automatically based on
            # TransferConfig; safe with our 500MB CS2 demos.
            extra = {"ContentType": "application/octet-stream"}
            self.s3_client.upload_fileobj(
                file.file,
                self.bucket,
                storage_filename,
                ExtraArgs=extra,
                Config=self._transfer_config,
            )
        except ClientError as exc:
            logger.exception("S3 upload failed: %s", storage_filename)
            raise HTTPException(status_code=502, detail="Storage upload failed") from exc

        logger.info("S3 upload OK: s3://%s/%s", self.bucket, storage_filename)
        return demo_uuid, storage_filename, f"s3://{self.bucket}/{storage_filename}"

    def get_path(self, storage_filename: str) -> Path:
        """
        Return a *local* path equivalent for the storage key.

        For S3 backends this is a sentinel temp path. Callers that need
        actual file content must use :meth:`download_to_local` first; this
        method is kept on the interface only so worker code that runs in
        local FS mode doesn't break.
        """
        return Path(tempfile.gettempdir()) / "riftscope" / storage_filename

    def download_to_local(self, storage_filename: str) -> Path:
        """Download the object from the bucket to a unique temp file."""
        tmp_dir = Path(tempfile.gettempdir()) / "riftscope"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        # Unique per call to avoid races if two workers parse the same demo.
        local_path = tmp_dir / f"{uuid4().hex}_{storage_filename}"
        try:
            self.s3_client.download_file(
                Bucket=self.bucket,
                Key=storage_filename,
                Filename=str(local_path),
                Config=self._transfer_config,
            )
        except ClientError:
            logger.exception("S3 download failed: %s", storage_filename)
            raise
        logger.info("S3 downloaded %s → %s (%d bytes)",
                    storage_filename, local_path, local_path.stat().st_size)
        return local_path

    def delete_demo(self, storage_filename: str) -> bool:
        try:
            self.s3_client.delete_object(Bucket=self.bucket, Key=storage_filename)
            return True
        except ClientError:
            logger.exception("S3 delete failed: %s", storage_filename)
            return False

    # ----------------------------------------------------------------------
    # Direct browser → R2 upload (presigned PUT)
    #
    # The browser PUTs the .dem straight to the bucket using a short-lived
    # signed URL, so the demo never streams through the API container. This
    # removes the Railway request-timeout / RAM ceiling that was causing
    # "network error at 100%" on large demos from slower connections.
    # ----------------------------------------------------------------------
    def supports_presigned_upload(self) -> bool:
        return True

    def new_object_key(self, filename: str) -> tuple[str, str, str]:
        """Mint a fresh storage key for an upload that hasn't happened yet.

        Mirrors the ``(uuid, storage_filename, abs_path)`` triple that
        :meth:`save_demo` returns, but WITHOUT touching the network — the
        bytes arrive later via the presigned PUT.
        """
        demo_uuid = str(uuid4())
        extension = Path(filename or "").suffix.lower() or ".dem"
        storage_filename = f"{demo_uuid}{extension}"
        return demo_uuid, storage_filename, f"s3://{self.bucket}/{storage_filename}"

    def generate_presigned_put(
        self,
        storage_filename: str,
        expires_in: int = 900,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Signed PUT URL the browser uploads to directly.

        ``content_type`` is baked into the signature, so the browser MUST
        send the exact same ``Content-Type`` header or R2 returns 403
        (SignatureDoesNotMatch). The frontend sends
        ``application/octet-stream`` to match.
        """
        try:
            return self.s3_client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": storage_filename,
                    "ContentType": content_type,
                },
                ExpiresIn=expires_in,
            )
        except ClientError:
            logger.exception("S3 presign PUT failed: %s", storage_filename)
            return ""

    def generate_presigned_url(
        self,
        storage_filename: str,
        expires_in: int = 300,
        download_name: Optional[str] = None,
    ) -> str:
        params = {"Bucket": self.bucket, "Key": storage_filename}
        if download_name:
            params["ResponseContentDisposition"] = f'attachment; filename="{download_name}"'
        try:
            return self.s3_client.generate_presigned_url(
                "get_object",
                Params=params,
                ExpiresIn=expires_in,
            )
        except ClientError:
            logger.exception("S3 presign failed: %s", storage_filename)
            return ""

    # ----------------------------------------------------------------------
    # Helpers used by health checks / admin
    # ----------------------------------------------------------------------

    def head(self, storage_filename: str) -> dict | None:
        """Return object metadata or ``None`` if the key is missing."""
        try:
            return self.s3_client.head_object(Bucket=self.bucket, Key=storage_filename)
        except ClientError as exc:
            err = exc.response.get("Error", {}).get("Code") if hasattr(exc, "response") else None
            if err in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise

    def health_check(self) -> bool:
        """Lightweight health probe — list one object from the bucket."""
        try:
            self.s3_client.list_objects_v2(Bucket=self.bucket, MaxKeys=1)
            return True
        except ClientError as exc:
            logger.warning("S3 health check failed: %s", exc)
            return False
