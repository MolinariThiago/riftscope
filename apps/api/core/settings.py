"""
Centralized settings for RIFTSCOPE API.

Reads from environment variables (and optional .env file) so that switching
between SQLite (dev) and PostgreSQL (prod) is just a DATABASE_URL change.

Phase 3A also exposes backend selectors (parser/storage/queue) so the runtime
can pick which implementation to use without touching call sites — the
factories in services/* read these flags at startup.
"""

from functools import lru_cache
from typing import List, Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # API
    app_name: str = "RIFTSCOPE API"
    app_version: str = "0.3.0"
    environment: str = "development"

    # Database
    database_url: str = "sqlite:///./riftscope.db"

    # CORS — accept comma-separated list via env (CORS_ORIGINS=...)
    cors_origins: List[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )

    # Storage
    upload_max_bytes: int = 500 * 1024 * 1024  # 500MB

    # Backend selectors (Phase 3B-ready: flip via env without code changes).
    # demoparser2 is now the default — the factory falls back to the stub if
    # the wheel isn't installed for the runtime Python version.
    parser_backend: Literal["stub", "demoparser2"] = "demoparser2"
    storage_backend: Literal["local", "s3"] = "local"
    queue_backend: Literal["inprocess", "celery"] = "inprocess"

    # Phase 3B placeholders (read but not required in dev)
    redis_url: str = "redis://localhost:6379/0"
    s3_endpoint: str = ""
    s3_bucket: str = "riftscope-demos"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_region: str = "us-east-1"


@lru_cache
def get_settings() -> Settings:
    return Settings()
