"""
Parser factory.

Lets the worker resolve a parser implementation via settings rather than
importing a concrete class. The stub parser is always available; the real
``demoparser2`` backend is loaded lazily so dev environments without the
Rust toolchain don't pay the import cost.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from core.settings import get_settings


class DemoParser(Protocol):
    """Every parser implementation returns the same analysis dict shape."""

    def parse(self, demo_path: str | Path) -> dict[str, Any]:
        ...


_singleton: DemoParser | None = None


def get_parser() -> DemoParser:
    """Return the active parser (cached). Falls back to the stub if needed."""
    global _singleton
    if _singleton is not None:
        return _singleton

    settings = get_settings()

    if settings.parser_backend == "demoparser2":  # pragma: no cover — Phase 3B
        try:
            from services.demo_parser_real import RealDemoParser  # type: ignore

            _singleton = RealDemoParser()
            return _singleton
        except Exception:
            # Fall through to the stub if demoparser2 isn't installed yet.
            pass

    from services.demo_parser import DemoParserService

    _singleton = DemoParserService()
    return _singleton
