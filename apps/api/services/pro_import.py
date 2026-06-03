"""
Pro-match demo import service.

Extracted from the ``POST /pro/matches/{id}/import`` endpoint so the
background scheduler can call the same code path without going through
HTTP. Returns a structured result so the caller (HTTP handler or
scheduler) can react.

Pipeline:

  1. Validate the ``ProMatch`` row + bail early if there's no
     ``demo_url`` to fetch.
  2. If the match is already imported (``demo_id`` set + the linked
     ``Demo`` still exists), short-circuit with ``status="existing"``.
  3. Otherwise download the archive from HLTV with a polite
     User-Agent + follow redirects, detect the format by magic
     bytes, and:
       * ``.dem``  → save + queue for parsing,
       * ``.zip``  → extract every ``.dem`` inside, queue each,
       * ``.rar``  → save the archive + create a failed Demo with a
                     friendly message (we don't ship ``unrar`` system-
                     wide).
  4. Update ``ProMatch.demo_id`` to point at the primary Demo so
     subsequent imports short-circuit.

The function is async and self-contained — pass it a SQLAlchemy
session + the ProMatch row and it does the rest.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

from curl_cffi import requests
from sqlalchemy.orm import Session

from core.bg import spawn
from core.settings import get_settings
from db.database import SessionLocal
from db.models.demo import Demo
from db.models.pro_match import ProMatch
from services.storage import UPLOAD_DIR
from workers.demo_worker import process_demo

logger = logging.getLogger("riftscope.pro.import")


# Cache the resolved cutoff for the lifetime of the process. We do
# NOT recompute it per call — that would mean "today" rolls forward
# as the calendar day advances, which would silently drop matches
# from yesterday's view at midnight. Capturing once at startup
# matches the user intent: "from today onwards", which means the
# day the operator turned this on.
_cutoff_cache: datetime | None = None


def get_pro_cutoff() -> datetime:
    """The earliest ``played_at`` we'll accept into the pro feed.

    Resolution order:
      1. ``PRO_INDEX_FROM`` env var, parsed as ``YYYY-MM-DD``.
      2. Default: today (UTC) at 00:00, captured once at first call.

    Returned datetime is timezone-aware UTC. Callers that compare
    against the DB column (which stores naive UTC) should call
    ``.replace(tzinfo=None)`` on the result.
    """
    global _cutoff_cache
    if _cutoff_cache is not None:
        return _cutoff_cache
    settings = get_settings()
    raw = (settings.pro_index_from or "").strip()
    if raw:
        try:
            parsed = datetime.strptime(raw, "%Y-%m-%d")
            _cutoff_cache = parsed.replace(tzinfo=timezone.utc)
            logger.info(
                "pro cutoff set from PRO_INDEX_FROM env: %s",
                _cutoff_cache.isoformat(),
            )
            return _cutoff_cache
        except ValueError:
            logger.warning(
                "PRO_INDEX_FROM=%r is not a valid YYYY-MM-DD date; "
                "falling back to today",
                raw,
            )
    today = datetime.now(timezone.utc).date()
    _cutoff_cache = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    logger.info(
        "pro cutoff defaulted to today (UTC): %s",
        _cutoff_cache.isoformat(),
    )
    return _cutoff_cache


def pro_cutoff_naive() -> datetime:
    """Same as :func:`get_pro_cutoff` but stripped of timezone for SQLite
    comparisons against the (naive UTC) ``played_at`` column."""
    return get_pro_cutoff().replace(tzinfo=None)

HLTV_DOWNLOAD_TIMEOUT = 600.0
HLTV_USER_AGENT = "RIFTSCOPE/0.3 (+https://riftscope.local)"


def _hltv_proxy() -> str | None:
    """Outbound proxy URL for HLTV traffic, or None for a direct connection.

    Resolution order:
      1. ``settings.hltv_proxy_url`` — wired from the ``HLTV_PROXY_URL``
         env var. This is where the Webshare Static Residential creds go
         (``http://USER:PASS@HOST:PORT``). Single source of truth in prod.
      2. Legacy env vars ``HLTV_PROXY`` / ``HTTPS_PROXY`` / ``HTTP_PROXY``
         — kept so an operator can shadow the setting for a one-off test
         without touching the deploy.
      3. Otherwise None (direct).

    Logs the redacted host so we can confirm in prod that we're going OUT
    via the proxy without leaking credentials in the log stream.
    """
    proxy = (
        get_settings().hltv_proxy_url
        or os.getenv("HLTV_PROXY")
        or os.getenv("HTTPS_PROXY")
        or os.getenv("HTTP_PROXY")
        or ""
    ).strip()
    return proxy or None


def _redact_proxy(url: str) -> str:
    """``http://user:pass@host:port`` → ``http://***@host:port`` for logs."""
    try:
        scheme, rest = url.split("://", 1)
        if "@" in rest:
            _, host = rest.split("@", 1)
            return f"{scheme}://***@{host}"
    except ValueError:
        pass
    return url


# ---------------------------------------------------------------------------
# Concurrency control
#
# Two layers, both critical to the rewrite we just did:
#
# 1. ``_in_flight`` is a set of match IDs whose import is currently running.
#    The /pro/matches/{id}/import endpoint AND the auto-scheduler both go
#    through ``claim_match`` before doing any work — so clicking "Import"
#    while the scheduler is already chasing the same match (or double-
#    clicking the button) no-ops the duplicate instead of starting a
#    second download. This is the fix for the "4 'Descarga completada' for
#    the same match" log we saw before.
#
# 2. ``_import_semaphore`` bounds how many imports may run at the same
#    time across the whole API process. Webshare Static Residential is
#    one IP — running N downloads in parallel just gets that IP rate-
#    limited by HLTV/Cloudflare and starves the demoparser2 thread of CPU.
#    ``PRO_IMPORT_CONCURRENCY`` defaults to 2; bump it only after we move
#    parsing to Celery on a separate worker.
# ---------------------------------------------------------------------------
_in_flight: set[int] = set()
_in_flight_lock = asyncio.Lock()
_import_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    """Lazy so the loop exists by the time we ask for it."""
    global _import_semaphore
    if _import_semaphore is None:
        _import_semaphore = asyncio.Semaphore(
            max(1, get_settings().pro_import_concurrency)
        )
    return _import_semaphore


async def claim_match(match_id: int) -> bool:
    """Try to reserve ``match_id`` for an import. Returns False if another
    import for the same match is already running."""
    async with _in_flight_lock:
        if match_id in _in_flight:
            return False
        _in_flight.add(match_id)
        return True


async def release_match(match_id: int) -> None:
    async with _in_flight_lock:
        _in_flight.discard(match_id)

ImportStatus = Literal[
    "queued",                # downloaded + queued for parsing
    "existing",              # already imported earlier
    "unsupported_archive",   # got a .rar — saved but not extractable
    "no_demo_url",           # ProMatch had no demo URL
    "download_failed",       # network / Cloudflare blocked us
    "unrecognized_format",   # HLTV served something we can't identify
]


@dataclass
class ImportResult:
    status: ImportStatus
    demo_id: int | None
    message: str


async def import_match_demo(
    db: Session,
    match: ProMatch,
) -> ImportResult:
    """Download the demo for ``match`` and queue it for parsing.

    Bounded by ``_import_semaphore`` so we never run more than
    ``PRO_IMPORT_CONCURRENCY`` imports at once (Webshare gives one IP and
    parsing is CPU-heavy — running 4 in parallel was what made the API
    appear frozen).
    """

    if match.demo_id:
        existing = db.query(Demo).filter(Demo.id == match.demo_id).first()
        if existing:
            return ImportResult(
                "existing", existing.id, "Match already imported"
            )

    proxy = _hltv_proxy()
    if proxy:
        logger.info("HLTV: routing through proxy %s", _redact_proxy(proxy))
    async with _get_semaphore():
        return await _import_match_demo_inner(db, match, proxy)


async def _import_match_demo_inner(
    db: Session,
    match: ProMatch,
    proxy: str | None,
) -> ImportResult:
    try:
        proxies = {"http": proxy, "https": proxy} if proxy else None

        async with requests.AsyncSession(
            timeout=HLTV_DOWNLOAD_TIMEOUT,
            impersonate="chrome",
            proxies=proxies
        ) as client:
            
            # --- LÓGICA AUTOMÁTICA: BUSCADOR INTELIGENTE EN HLTV ---
            url_base = match.demo_url

            if not url_base:
                logger.info("Buscando automáticamente %s vs %s en HLTV...", match.team_a, match.team_b)
                
                # Función interna para limpiar nombres de equipos
                def get_main_word(name: str) -> str:
                    ignore = {"team", "esports", "gaming", "clan", "fc", "club"}
                    words = [w.lower() for w in re.split(r'\W+', name) if w]
                    for w in words:
                        if w not in ignore:
                            return w
                    return words[0] if words else ""

                word_a = get_main_word(match.team_a)
                word_b = get_main_word(match.team_b)

                # 1. Buscamos en la página de resultados de HLTV
                results_resp = await client.get(
                    "https://www.hltv.org/results",
                    headers={"Referer": "https://www.hltv.org/"}
                )
                results_resp.raise_for_status()

                # 2. Extraemos todos los links de los partidos
                match_links = re.findall(r'href=["\'](/matches/\d+/[^"\']+)["\']', results_resp.text)
                
                # 3. Comparamos para encontrar el correcto
                found_match_url = None
                for link in match_links:
                    link_lower = link.lower()
                    if word_a in link_lower and word_b in link_lower:
                        found_match_url = "https://www.hltv.org" + link
                        break
                
                if not found_match_url:
                    return ImportResult(
                        "no_demo_url", None, 
                        f"No pude encontrar el partido ({word_a} vs {word_b}) en los resultados de HLTV."
                    )
                
                logger.info("¡Página del partido encontrada!: %s", found_match_url)
                url_base = found_match_url

            # --- FASE 2: ENCONTRAR LA DEMO ---
            if "/matches/" in url_base:
                logger.info("Escaneando el código de la página para robar el link de descarga...")
                page_resp = await client.get(
                    url_base,
                    headers={"Referer": "https://www.hltv.org/results"}
                )
                page_resp.raise_for_status()

                match_link = re.search(r'href=["\'](/download/demo/\d+)["\']', page_resp.text)
                
                if not match_link:
                    return ImportResult(
                        "no_demo_url", None, 
                        "El partido está en HLTV, pero todavía no subieron el archivo de la demo."
                    )
                
                demo_download_url = "https://www.hltv.org" + match_link.group(1)
                logger.info("¡Link de descarga oficial encontrado!: %s", demo_download_url)

                # Guardamos el link en tu BD
                match.demo_url = demo_download_url
                db.commit()
            else:
                demo_download_url = url_base

            # --- FASE 3: DESCARGA PESADA ---
            logger.info("Iniciando descarga de la demo desde: %s", demo_download_url)
            r = await client.get(
                demo_download_url, 
                headers={"Referer": url_base}
            )
            r.raise_for_status()
            body = r.content
            
            logger.info("Descarga completada con éxito. Procesando archivo...")

    except Exception as exc:
        logger.warning(
            "HLTV demo download failed for match %s (%s vs %s): %s",
            match.id, match.team_a, match.team_b, exc,
        )
        return ImportResult(
            "download_failed", None,
            f"Couldn't reach HLTV: {exc.__class__.__name__}",
        )

    # --- A PARTIR DE ACÁ NADA CAMBIÓ, ES TU CÓDIGO ORIGINAL ---
    base_name = _sanitize_filename(
        f"{match.team_a}-vs-{match.team_b}-{match.id}"
    )
    primary_demo: Demo | None = None

    if body[:4] == b"PK\x03\x04":
        # ZIP archive — extract all .dem inside.
        try:
            zf = zipfile.ZipFile(io.BytesIO(body))
        except zipfile.BadZipFile as exc:
            logger.warning("Corrupted ZIP for match %s: %s", match.id, exc)
            return ImportResult(
                "unrecognized_format", None,
                "Corrupted ZIP archive from HLTV",
            )
        dem_names = [n for n in zf.namelist() if n.lower().endswith(".dem")]
        if not dem_names:
            return ImportResult(
                "unrecognized_format", None,
                "ZIP archive did not contain any .dem files",
            )
        for i, dem_name in enumerate(dem_names):
            with zf.open(dem_name) as src:
                demo = _persist_demo_bytes(
                    db,
                    src.read(),
                    filename=f"{base_name}-{Path(dem_name).stem}.dem",
                    pro_match=match,
                )
            if i == 0:
                primary_demo = demo

    elif body[:7] == b"Rar!\x1a\x07\x00" or body[:8] == b"Rar!\x1a\x07\x01\x00":
        # RAR archive. We try to extract with the ``rarfile`` package,
        # which needs an external ``unrar`` binary. The runtime
        # resolver (``services.rar_runtime``) tries hard to find one
        # at startup, including auto-downloading from rarlab on
        # Windows — so the auto-import flow Just Works for the
        # oper witatorhout manual setup.
        # Extraction shells out to unrar (blocking + potentially slow for a
        # 300 MB+ .dem). Run it off the event loop so it never freezes the
        # API. A missing/invalid binary returns None fast (see _try_extract_rar
        # → rar_runtime validation), so this can't hang on the broken stub.
        extracted = await asyncio.to_thread(_try_extract_rar, body, base_name)
        if extracted is None:
            # No unrar binary available. Save the archive so the user
            # can grab it from disk, but mark the Demo failed so the
            # scheduler doesn't re-attempt every tick.
            archive_path = UPLOAD_DIR / f"{uuid4()}-{base_name}.rar"
            archive_path.write_bytes(body)
            primary_demo = Demo(
                filename=f"{base_name}.rar",
                storage_filename=archive_path.name,
                status="failed",
                processing_progress=0,
                error_message=(
                    "HLTV ships this match as a .rar archive and the "
                    "server has no unrar binary to extract it. Install "
                    "WinRAR (or drop unrar.exe in PATH) and restart "
                    "the backend, or download manually from HLTV."
                ),
            )
            db.add(primary_demo)
            db.commit()
            db.refresh(primary_demo)
            match.demo_id = primary_demo.id
            db.commit()
            return ImportResult(
                "unsupported_archive", primary_demo.id,
                "Demo viene en .rar — falta unrar en el servidor",
            )
        # Extraction succeeded — persist each .dem we recovered.
        for i, (name, dem_bytes) in enumerate(extracted):
            demo = _persist_demo_bytes(
                db,
                dem_bytes,
                filename=f"{base_name}-{Path(name).stem}.dem",
                pro_match=match,
            )
            if i == 0:
                primary_demo = demo

    elif body[:8].startswith(b"HL2DEMO") or body[:8].startswith(b"PBDEMO"):
        # Naked .dem — easy path.
        primary_demo = _persist_demo_bytes(
            db,
            body,
            filename=f"{base_name}.dem",
            pro_match=match,
        )

    else:
        logger.warning(
            "Unknown archive format for match %s (first 16 bytes: %r)",
            match.id, body[:16],
        )
        return ImportResult(
            "unrecognized_format", None,
            "HLTV returned an unrecognised file format",
        )

    if primary_demo is None:
        return ImportResult(
            "download_failed", None, "Failed to persist primary demo"
        )

    match.demo_id = primary_demo.id
    db.commit()
    return ImportResult(
        "queued", primary_demo.id,
        "Demo descargado y encolado para procesamiento",
    )


async def import_match_in_background(match_id: int) -> None:
    """Run :func:`import_match_demo` off the request, with its OWN db session.

    The HTTP handler that triggered the import returns immediately (202), so
    its request-scoped session is already closed by the time the download
    finishes. We open a fresh session here and write ``import_status`` /
    ``import_error`` on the match so the /pro UI can poll for progress
    instead of holding an open request for the whole (up to 600 s) download.

    Wrapped by :func:`claim_match` so a duplicate trigger (user clicked the
    button twice, or the auto-scheduler picked the same row before the
    manual one finished) becomes a no-op instead of a second HLTV download.
    """
    if not await claim_match(match_id):
        logger.info(
            "background import: match %s already importing — skipping duplicate",
            match_id,
        )
        return
    db = SessionLocal()
    try:
        match = db.query(ProMatch).filter(ProMatch.id == match_id).first()
        if match is None:
            logger.warning("background import: match %s vanished", match_id)
            return
        match.import_status = "importing"
        match.import_error = None
        db.commit()

        res = await import_match_demo(db, match)

        # Re-fetch in case the long-running call expired the instance.
        match = db.query(ProMatch).filter(ProMatch.id == match_id).first()
        if match is None:
            return
        if res.status in ("queued", "existing"):
            # Success — a Demo row now exists (demo_id set); its own status
            # takes over from here, so clear the import flag.
            match.import_status = None
            match.import_error = None
        else:
            match.import_status = "failed"
            match.import_error = res.message
        db.commit()
        logger.info(
            "background import for match %s finished: %s", match_id, res.status
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("background import for match %s crashed", match_id)
        try:
            m = db.query(ProMatch).filter(ProMatch.id == match_id).first()
            if m is not None:
                m.import_status = "failed"
                m.import_error = f"{exc.__class__.__name__}: {exc}"
                db.commit()
        except Exception:
            logger.exception("failed to record import error for match %s", match_id)
    finally:
        db.close()
        await release_match(match_id)


def _persist_demo_bytes(
    db: Session,
    data: bytes,
    *,
    filename: str,
    pro_match: ProMatch,
) -> Demo:
    """Write ``data`` to the storage dir, create a Demo row, queue for parsing.

    Doesn't go through ``services.queue`` because that interface needs
    a FastAPI ``BackgroundTasks`` instance — we use ``asyncio.create_task``
    directly so the same code works from the HTTP handler AND the
    background scheduler.
    """
    storage_filename = f"{uuid4()}.dem"
    abs_path = UPLOAD_DIR / storage_filename
    abs_path.write_bytes(data)
    demo = Demo(
        filename=filename,
        storage_filename=storage_filename,
        status="queued",
        processing_progress=0,
    )
    db.add(demo)
    db.commit()
    db.refresh(demo)

    # Fire-and-forget the worker. ``process_demo`` is async and
    # self-contained — it opens its own DB session and updates the
    # Demo row as it goes. ``spawn`` retains a strong reference so the
    # task isn't garbage-collected mid-parse (the old bare
    # ``create_task`` silently died at "Procesando archivo...").
    spawn(process_demo(demo.id, str(abs_path)), name=f"parse-demo-{demo.id}")
    logger.info(
        "Queued pro-match demo for parsing: pro_match=%s demo_id=%s file=%s",
        pro_match.id, demo.id, filename,
    )
    return demo


def _try_extract_rar(body: bytes, base_name: str) -> list[tuple[str, bytes]] | None:
    """Attempt to extract every ``.dem`` member from a RAR archive.

    Returns a list of ``(member_name, bytes)`` tuples on success,
    ``None`` if extraction isn't possible (no ``rarfile`` package,
    no unrar binary, corrupted archive).

    Writes the archive to a tmp file because ``rarfile`` doesn't
    support BytesIO for RAR5 — it shells out to ``unrar`` and that
    needs a real file path. The tmp file is removed on the way out.
    """
    try:
        import rarfile  # type: ignore
    except ImportError:
        logger.warning("rarfile package not installed; can't extract .rar")
        return None

    # Check that the runtime resolver actually found an unrar binary
    # at startup; without it ``rarfile`` would just raise.
    if not getattr(rarfile, "UNRAR_TOOL", None):
        logger.warning("no unrar binary configured; can't extract .rar")
        return None

    tmp_path = UPLOAD_DIR / f"{uuid4()}-{base_name}.rar.tmp"
    try:
        tmp_path.write_bytes(body)
        try:
            rf = rarfile.RarFile(str(tmp_path))
        except rarfile.Error as exc:
            logger.warning("invalid rar archive for %s: %s", base_name, exc)
            return None
        out: list[tuple[str, bytes]] = []
        for info in rf.infolist():
            name = info.filename
            if not name.lower().endswith(".dem"):
                continue
            try:
                data = rf.read(info)
            except rarfile.Error as exc:
                logger.warning(
                    "failed reading %s from rar for %s: %s",
                    name, base_name, exc,
                )
                continue
            out.append((name, data))
        if not out:
            logger.warning(
                "rar archive for %s had no .dem members", base_name,
            )
            return None
        logger.info(
            "extracted %d .dem files from rar for %s",
            len(out), base_name,
        )
        return out
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


def _sanitize_filename(s: str) -> str:
    return "".join(
        c if c.isalnum() or c in ("-", "_") else "-" for c in s
    ).strip("-")[:80]