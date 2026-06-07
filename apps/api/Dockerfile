# RIFTSCOPE API — production image for Render / Railway / Fly.
#
# Multi-stage isn't worth it here — demoparser2 ships wheels so no
# native build step, and httpx/sqlalchemy are pure Python. A single
# slim image keeps build time under a minute on every push.

FROM python:3.12-slim

# unrar — required for HLTV demo extraction when the scheduler imports
# .rar archives. Without this, the pro auto-import path falls back to
# saving the archive without extracting. apt-get is one line on Debian
# so we drop it in the image rather than letting rar_runtime.py
# auto-download it at boot.
RUN apt-get update \
    && apt-get install -y --no-install-recommends unrar-free libxml2 libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first so the image cache stays warm between code edits.
# requirements.txt = base (FastAPI, demoparser2, etc.)
# requirements-prod.txt = Postgres drivers + Celery (pulled in unconditionally
# in the prod image; no harm in dev since they're never imported when
# DATABASE_URL=sqlite and QUEUE_BACKEND=inprocess).
COPY requirements.txt requirements-prod.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir -r requirements-prod.txt

# Copy the app last — invalidates only the final layer on code change.
COPY . .

# Storage dir created at build time so the worker doesn't race on it.
# In production STORAGE_BACKEND=s3 means demos land in R2 instead, but
# the /storage/bin/unrar fallback path still uses this dir.
RUN mkdir -p storage/uploads storage/bin

# Railway / Fly / Render inject the listening port via $PORT. Default to
# 8000 when running the image standalone.
ENV PORT=8000
EXPOSE 8000

# uvicorn with a single worker — the in-process scheduler + asyncio
# background tasks need a single event loop. When you scale up,
# split the scheduler into a separate process (or migrate to Celery)
# instead of running multiple workers here.
# ``sh -c`` is required so ${PORT} is expanded at runtime (exec form
# doesn't shell-interpolate).
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
