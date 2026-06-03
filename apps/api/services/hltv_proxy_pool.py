"""
Round-robin proxy pool for HLTV traffic.

Webshare Static Residential gives us N IPs (e.g. 20). HLTV's Cloudflare
edge rate-limits / challenges any single IP that pulls too many demos in
a window, so we rotate through the pool and park any IP that returns a
"blocked" signal until its cooldown expires.

Public surface:

  * ``get_proxy_pool()`` — module-level singleton built lazily from
    ``settings.hltv_proxy_urls`` (+ legacy ``hltv_proxy_url``).
  * ``ProxyPool.acquire()`` — next healthy proxy URL, or ``None`` when
    every endpoint is on cooldown (caller's choice to wait or fail).
  * ``ProxyPool.report_failure(url, reason)`` — park ``url`` for
    ``cooldown_seconds``.
  * ``ProxyPool.report_success(url)`` — clear the cooldown immediately
    after a 2xx so a one-off failure doesn't keep an IP sidelined.
  * ``ProxyPool.snapshot()`` — diagnostic dump used by
    ``/pro/scheduler/status`` so the UI can show how many IPs are
    healthy.

Design choices:

  - **Round-robin, not random.** Predictable rotation makes log spelunking
    easier and avoids hammering a single endpoint when another is fresher.
  - **Cooldown is monotonic-clock based.** Survives wall-clock jumps
    (NTP, container migration) without spurious early/late releases.
  - **Empty pool returns None from acquire().** A pool of zero proxies
    just means "go direct" — the import path then bypasses the proxy
    layer entirely (this is the dev default).
  - **No persistence.** Cooldown state lives in memory. A process restart
    starts every IP fresh — that's intentional, since we have no way to
    distinguish "still blocked by HLTV" from "the operator fixed it" and
    re-trying is the cheaper failure mode.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Optional

from core.settings import get_settings

logger = logging.getLogger("riftscope.pro.proxy")


def _redact(url: str) -> str:
    """``http://user:pass@host:port`` → ``http://***@host:port`` for logs."""
    try:
        scheme, rest = url.split("://", 1)
        if "@" in rest:
            _, host = rest.split("@", 1)
            return f"{scheme}://***@{host}"
    except ValueError:
        pass
    return url


def _parse_urls(raw_list: list[str], legacy_single: str) -> list[str]:
    """Normalise the operator's env input into a clean list of proxy URLs.

    Accepts:
      - ``hltv_proxy_urls`` as a real list (when set via pydantic-settings
        from a JSON env), or
      - a single env value with commas / newlines / whitespace separating
        the entries (Webshare's "Download list" gives one per line).
    The legacy ``hltv_proxy_url`` single string is appended as a fallback
    so old env setups keep working.
    """
    out: list[str] = []
    seen: set[str] = set()

    def _push(s: str) -> None:
        s = s.strip()
        if not s or s in seen:
            return
        seen.add(s)
        out.append(s)

    for entry in raw_list or []:
        # pydantic may give us a single comma-blob if the env was a string.
        for part in re.split(r"[,\s]+", str(entry)):
            _push(part)
    if legacy_single:
        _push(legacy_single)
    return out


@dataclass
class _Endpoint:
    url: str
    # Monotonic timestamp when the cooldown lifts. <= now() means healthy.
    cooldown_until: float = 0.0
    # Counters for diagnostics (not used for routing).
    successes: int = 0
    failures: int = 0
    last_failure_reason: str = ""


@dataclass
class ProxyPool:
    cooldown_seconds: int
    max_retries: int
    endpoints: list[_Endpoint] = field(default_factory=list)
    # Round-robin cursor.
    _cursor: int = 0
    # Guards the cursor + cooldown state.
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def __post_init__(self) -> None:
        # Cap retries by pool size at construction — no point retrying
        # 10 times against a 3-IP pool.
        if self.endpoints:
            self.max_retries = min(self.max_retries, len(self.endpoints))

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------
    @property
    def size(self) -> int:
        return len(self.endpoints)

    async def acquire(self) -> Optional[str]:
        """Next healthy proxy URL, or None if the pool is empty / all parked.

        Returns ``None`` in two distinct cases that the caller treats the
        same way (skip the proxy / fail this attempt):
          - Empty pool: no proxies configured → direct connection.
          - All cooldown: every endpoint blocked recently → caller can
            either wait the shortest cooldown or surface a "no IPs
            available" error to the operator.
        """
        if not self.endpoints:
            return None
        async with self._lock:
            now = time.monotonic()
            n = len(self.endpoints)
            # Walk one full lap from the current cursor to find a healthy
            # endpoint. The cursor advances even when we return None so a
            # restart of the search doesn't bias toward the same IP.
            for _ in range(n):
                ep = self.endpoints[self._cursor]
                self._cursor = (self._cursor + 1) % n
                if ep.cooldown_until <= now:
                    return ep.url
            # All on cooldown.
            return None

    async def wait_seconds_until_next_available(self) -> float:
        """Seconds until the soonest cooldown lifts. ``0`` if one is ready
        right now (or pool is empty). Used by callers that prefer to wait
        rather than fail when every IP is parked."""
        if not self.endpoints:
            return 0.0
        async with self._lock:
            now = time.monotonic()
            soonest = min(
                (ep.cooldown_until for ep in self.endpoints),
                default=now,
            )
            return max(0.0, soonest - now)

    # ------------------------------------------------------------------
    # Feedback
    # ------------------------------------------------------------------
    async def report_failure(self, url: str, reason: str) -> None:
        """Park ``url`` for ``cooldown_seconds``. Idempotent."""
        async with self._lock:
            for ep in self.endpoints:
                if ep.url == url:
                    ep.cooldown_until = time.monotonic() + self.cooldown_seconds
                    ep.failures += 1
                    ep.last_failure_reason = reason
                    logger.info(
                        "proxy %s parked for %ss (reason: %s) — pool now %d/%d healthy",
                        _redact(url), self.cooldown_seconds, reason,
                        self._healthy_count_locked(), len(self.endpoints),
                    )
                    return

    async def report_success(self, url: str) -> None:
        """Clear any pending cooldown on ``url`` after a confirmed 2xx."""
        async with self._lock:
            for ep in self.endpoints:
                if ep.url == url:
                    if ep.cooldown_until > 0:
                        ep.cooldown_until = 0.0
                    ep.successes += 1
                    return

    def _healthy_count_locked(self) -> int:
        now = time.monotonic()
        return sum(1 for ep in self.endpoints if ep.cooldown_until <= now)

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------
    def snapshot(self) -> dict:
        """Public-safe pool state for /pro/scheduler/status."""
        now = time.monotonic()
        healthy = 0
        parked = 0
        for ep in self.endpoints:
            if ep.cooldown_until <= now:
                healthy += 1
            else:
                parked += 1
        return {
            "configured": len(self.endpoints),
            "healthy": healthy,
            "parked": parked,
            "cooldown_seconds": self.cooldown_seconds,
            "max_retries": self.max_retries,
        }


_pool: Optional[ProxyPool] = None


def get_proxy_pool() -> ProxyPool:
    """Singleton pool built from settings on first access.

    Rebuild it after changing env vars with :func:`reset_proxy_pool`.
    """
    global _pool
    if _pool is None:
        s = get_settings()
        urls = _parse_urls(s.hltv_proxy_urls, s.hltv_proxy_url)
        _pool = ProxyPool(
            cooldown_seconds=int(s.hltv_proxy_cooldown_seconds),
            max_retries=int(s.hltv_proxy_max_retries),
            endpoints=[_Endpoint(url=u) for u in urls],
        )
        if urls:
            logger.info(
                "HLTV proxy pool: %d endpoint(s) configured "
                "(cooldown=%ss, max_retries=%d)",
                len(urls), _pool.cooldown_seconds, _pool.max_retries,
            )
        else:
            logger.info("HLTV proxy pool: empty — direct connection mode")
    return _pool


def reset_proxy_pool() -> None:
    """Drop the cached pool. Tests + hot-reload only."""
    global _pool
    _pool = None
