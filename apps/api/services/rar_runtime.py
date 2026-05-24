"""
RAR runtime resolver.

HLTV serves most pro demos as ``.rar`` archives. The ``rarfile`` Python
package can extract them but needs a system binary (``unrar`` /
``unrar.exe`` / ``bsdtar``). This module finds the binary if one is
installed, and on Windows auto-downloads the standalone unrar.exe
from rarlab.com if nothing is available — so the operator doesn't
need to install WinRAR system-wide for the auto-import flow to work.

Public surface:

  * :func:`ensure_rar_runtime` — call once at startup. Sets
    ``rarfile.UNRAR_TOOL`` and returns the resolved path, or ``None``
    if no binary could be found / installed.
  * :func:`rar_runtime_status` — diagnostic snapshot used by the
    scheduler-status endpoint so the UI can surface whether .rar
    extraction is functional.
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
import stat
from pathlib import Path

import httpx

logger = logging.getLogger("riftscope.rar")

# Where we drop the downloaded unrar binary. Lives next to the
# uploads dir so it doesn't clutter the source tree.
BIN_DIR = Path(__file__).resolve().parent.parent / "storage" / "bin"

# Standalone unrar.exe published by RARLab (free, no licence required
# for the unrar-only utility). The .exe is ~300 KB.
UNRAR_WINDOWS_URL = "https://www.rarlab.com/rar/unrarw64.exe"

# Cached after the first resolution so we don't re-walk the
# filesystem on every status request.
_resolved_path: str | None = None
_resolved_source: str = ""  # "system" | "downloaded" | "missing"


def rar_runtime_status() -> dict:
    """Snapshot for the scheduler-status endpoint."""
    return {
        "available": _resolved_path is not None,
        "path": _resolved_path,
        "source": _resolved_source or "unresolved",
    }


def ensure_rar_runtime() -> str | None:
    """Resolve a usable unrar binary path. Call once at startup.

    Lookup order:
      1. ``UNRAR_TOOL`` env var (operator override).
      2. ``unrar`` / ``unrar.exe`` on PATH.
      3. Common Windows install dirs (WinRAR).
      4. Project-local ``storage/bin/unrar.exe`` (download cache).
      5. (Windows only) auto-download from rarlab.com to (4).
    """
    global _resolved_path, _resolved_source

    # 1. Env override.
    env_path = (os.getenv("UNRAR_TOOL") or "").strip()
    if env_path and Path(env_path).is_file():
        _resolved_path = env_path
        _resolved_source = "env"
        _apply(env_path)
        return env_path

    # 2. PATH lookup.
    for candidate in ("unrar", "unrar.exe", "bsdtar"):
        path = shutil.which(candidate)
        if path:
            _resolved_path = path
            _resolved_source = "system"
            _apply(path)
            logger.info("rar runtime: using system binary at %s", path)
            return path

    # 3. Common Windows WinRAR install dirs.
    if platform.system() == "Windows":
        for guess in (
            Path("C:/Program Files/WinRAR/UnRAR.exe"),
            Path("C:/Program Files (x86)/WinRAR/UnRAR.exe"),
            Path("C:/Program Files/WinRAR/unrar.exe"),
            Path("C:/Program Files (x86)/WinRAR/unrar.exe"),
        ):
            if guess.is_file():
                _resolved_path = str(guess)
                _resolved_source = "winrar"
                _apply(str(guess))
                logger.info(
                    "rar runtime: using WinRAR-installed binary at %s",
                    guess,
                )
                return str(guess)

    # 4. Already-downloaded local copy.
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    local = BIN_DIR / ("unrar.exe" if platform.system() == "Windows" else "unrar")
    if local.is_file():
        _resolved_path = str(local)
        _resolved_source = "cached"
        _apply(str(local))
        logger.info("rar runtime: using cached binary at %s", local)
        return str(local)

    # 5. Auto-download (Windows only).
    if platform.system() == "Windows":
        try:
            logger.info(
                "rar runtime: no unrar found — downloading standalone "
                "binary from rarlab.com to %s",
                local,
            )
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                r = client.get(UNRAR_WINDOWS_URL)
                r.raise_for_status()
                local.write_bytes(r.content)
            # Sanity: make sure the file looks like a Windows EXE.
            if local.read_bytes()[:2] != b"MZ":
                logger.warning(
                    "rar runtime: downloaded file isn't a PE binary, removing"
                )
                local.unlink(missing_ok=True)
            else:
                _resolved_path = str(local)
                _resolved_source = "downloaded"
                _apply(str(local))
                logger.info("rar runtime: downloaded unrar.exe to %s", local)
                return str(local)
        except Exception as exc:
            logger.warning(
                "rar runtime: auto-download failed: %s. Install WinRAR or "
                "place unrar.exe on PATH to enable .rar demo extraction.",
                exc,
            )

    _resolved_path = None
    _resolved_source = "missing"
    logger.warning(
        "rar runtime: no unrar binary available. HLTV .rar demos will "
        "be saved but not extracted. On Linux: ``apt install unrar``. "
        "On Windows: install WinRAR or drop ``unrar.exe`` in PATH."
    )
    return None


def _apply(path: str) -> None:
    """Tell ``rarfile`` which binary to use. Best-effort — if rarfile
    isn't importable we just no-op (the import would have failed at
    the call site already)."""
    try:
        import rarfile

        rarfile.UNRAR_TOOL = path
        # Make the file executable on Unix systems we downloaded into.
        if platform.system() != "Windows":
            try:
                st = os.stat(path)
                os.chmod(path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
            except OSError:
                pass
    except ImportError:
        pass
