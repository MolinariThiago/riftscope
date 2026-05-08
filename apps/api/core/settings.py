"""
Centralized settings for RIFTSCOPE API.

Reads from environment variables (and optional .env file) so that switching
between SQLite (dev) and PostgreSQL (prod) is just a DATABASE_URL change.
"""

from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # API
    app_name: str = "RIFTSCOPE API"
    app_version: str = "0.2.0"
    environment: str = "development"

    # Database
    database_url: str = "sqlite:///./riftscope.db"

    # CORS — accept comma-separated list via env (CORS_ORIGINS=...)
    cors_origins: List[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )

    # Storage
    upload_max_bytes: int = 500 * 1024 * 1024  # 500MB

    # Phase 3 placeholders (read but not required in dev)
    redis_url: str = "redis://localhost:6379/0"
    s3_endpoint: str = ""
    s3_bucket: str = "riftscope-demos"


@lru_cache
def get_settings() -> Settings:
    return Settings()
