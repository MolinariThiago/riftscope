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
    # Public-facing base URL — used to build the Steam OpenID return_to
    # URL and any other absolute links emitted by the API.
    base_url: str = "http://localhost:8000"

    # Database
    database_url: str = "sqlite:///./riftscope.db"

    # CORS — accept comma-separated list via env (CORS_ORIGINS=...)
    cors_origins: List[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )

    # Storage
    # 2 GB cap — covers long pro matches and POV-style demos.
    # The original 500 MB limit rejected legitimate HLTV / long-OT
    # uploads client-side before they hit the server.
    upload_max_bytes: int = 2 * 1024 * 1024 * 1024  # 2 GB

    # ------------------------------------------------------------------
    # Auth — JWT cookies + Steam OpenID
    # ------------------------------------------------------------------
    # DEV default — MUST be overridden in production via env. The token
    # cookie is httpOnly so XSS can't read it; the secret only needs to
    # be unguessable, not user-presentable.
    secret_key: str = "dev-secret-change-me-in-prod"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Steam OpenID — used by /auth/steam/login + callback. The realm
    # MUST match the frontend origin so Steam's openid.return_to check
    # passes. Free Steam API key registration → no_op when missing.
    steam_api_key: str = ""
    steam_realm: str = "http://localhost:3000"
    # Where we redirect after a successful OpenID callback.
    frontend_origin: str = "http://localhost:3000"

    # Cutoff date for the /pro section. We only index + import +
    # surface matches whose ``played_at >= pro_index_from``. Default
    # is the API's startup date (= today) so the operator opts into
    # the "from today onwards" snapshot the user asked for. Override
    # with ``PRO_INDEX_FROM=2026-05-23`` if you want to seed with an
    # older slice (testing, debugging, demo recordings).
    #
    # Format: YYYY-MM-DD (UTC). Blank = today at startup.
    pro_index_from: str = ""

    # ------------------------------------------------------------------
    # Monetization — single flag flips Stripe + revenue UI on. When
    # disabled the admin dashboard shows "—" instead of $0 to make it
    # obvious that revenue tracking is off, not zero.
    # ------------------------------------------------------------------
    monetization_enabled: bool = False
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id_pro_monthly: str = ""

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
