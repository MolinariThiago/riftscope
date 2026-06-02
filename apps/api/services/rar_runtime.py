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
import subprocess
from pathlib import Path

logger = logging.getLogger("riftscope.rar")

# Where a unrar binary may be cached. Lives next to the uploads dir so it
# doesn't clutter the source tree.
BIN_DIR = Path(__file__).resolve().parent.parent / "storage" / "bin"

# Windows flag: don't pop a console window when we probe a binary.
_CREATE_NO_WINDOW = 0x08000000 if platform.system() == "Windows" else 0

# Cached after the first resolution so we don't re-walk the
# filesystem on every status request.
_resolved_path: str | None = None
_resolved_source: str = ""  # "env" | "system" | "winrar" | "cached" | "missing"


def _unrar_works(path: str) -> bool:
    """Confirm ``path`` is the real command-line unrar, not a GUI/SFX stub.

    The CLI unrar prints a ``UNRAR <ver> ... Usage:`` banner when run with no
    args and exits. The self-extracting ``unrarw64.exe`` that the old
    auto-download grabbed by mistake prints nothing (and/or pops a GUI),
    which made ``rarfile`` hang forever on a background extraction. We run
    the candidate with stdin closed, a short timeout, and no console window,
    and require the banner before trusting it.
    """
    try:
        proc = subprocess.run(
            [path],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=10,
            creationflags=_CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return b"UNRAR" in (proc.stdout or b"").upper()


def _accept(path: str, source: str) -> str | None:
    """Validate + register ``path`` as the active unrar, or return None."""
    global _resolved_path, _resolved_source
    if not _unrar_works(path):
        logger.warning(
            "rar runtime: candidate at %s (%s) is not a working CLI unrar "
            "(no UNRAR banner) — skipping",
            path, source,
        )
        return None
    _resolved_path = path
    _resolved_source = source
    _apply(path)
    logger.info("rar runtime: using %s unrar at %s", source, path)
    return path


def rar_runtime_status() -> dict:
    """Snapshot for the scheduler-status endpoint."""
    return {
        "available": _resolved_path is not None,
        "path": _resolved_path,
        "source": _resolved_source or "unresolved",
    }


def ensure_rar_runtime() -> str | None:
    """Resolve a *working* command-line unrar binary. Call once at startup.

    Every candidate is validated with :func:`_unrar_works` before we trust
    it — this is what stops the broken self-extracting ``unrarw64.exe`` (or
    any GUI stub) from being registered and then hanging ``rarfile`` forever
    on a background extraction.

    Lookup order:
      1. ``UNRAR_TOOL`` env var (operator override).
      2. ``unrar`` / ``unrar.exe`` / ``bsdtar`` on PATH (Linux: apt unrar).
      3. Common Windows WinRAR install dirs.
      4. Project-local ``storage/bin/unrar(.exe)`` cache.

    There is intentionally NO auto-download: the old one fetched RARLab's
    ``unrarw64.exe``, which is a self-extracting INSTALLER, not the CLI tool,
    and shelling out to it hung. On Windows just install WinRAR (its bundled
    ``UnRAR.exe`` is found at step 3); on Linux ``apt install unrar``.
    """
    global _resolved_path, _resolved_source

    # 1. Env override.
    env_path = (os.getenv("UNRAR_TOOL") or "").strip()
    if env_path and Path(env_path).is_file():
        if (p := _accept(env_path, "env")):
            return p

    # 2. PATH lookup.
    for candidate in ("unrar", "unrar.exe", "bsdtar"):
        path = shutil.which(candidate)
        if path and (p := _accept(path, "system")):
            return p

    # 3. Common Windows WinRAR install dirs.
    if platform.system() == "Windows":
        for guess in (
            Path("C:/Program Files/WinRAR/UnRAR.exe"),
            Path("C:/Program Files (x86)/WinRAR/UnRAR.exe"),
            Path("C:/Program Files/WinRAR/unrar.exe"),
            Path("C:/Program Files (x86)/WinRAR/unrar.exe"),
        ):
            if guess.is_file() and (p := _accept(str(guess), "winrar")):
                return p

    # 4. Project-local cache (e.g. an operator dropped a real unrar here).
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    local = BIN_DIR / ("unrar.exe" if platform.system() == "Windows" else "unrar")
    if local.is_file() and (p := _accept(str(local), "cached")):
        return p

    _resolved_path = None
    _resolved_source = "missing"
    logger.warning(
        "rar runtime: no working unrar binary available. HLTV .rar demos "
        "will be saved but not extracted. On Linux: ``apt install unrar``. "
        "On Windows: install WinRAR (free) — its UnRAR.exe is picked up "
        "automatically — or drop a real CLI ``unrar.exe`` on PATH."
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
