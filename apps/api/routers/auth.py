"""
Auth router — Steam OpenID + JWT cookie sessions.

Flow:

    1. Frontend opens ``GET /auth/steam/login`` → 302 to
       ``https://steamcommunity.com/openid/login?...`` with our
       ``return_to`` set to ``{frontend_origin}/auth/steam/callback``.

    2. After the user approves the request, Steam redirects the browser
       back to ``{frontend_origin}/auth/steam/callback?...`` carrying
       the OpenID assertion params.

    3. The Next.js callback page on the frontend forwards those params
       verbatim to ``GET /auth/steam/callback`` here. We verify the
       assertion against Steam, extract the SteamID, upsert a ``User``
       row, fetch the profile from the Steam Web API (if a key is
       configured), then set the ``access_token`` cookie.

    4. The frontend reads ``GET /auth/me`` to hydrate the auth store.

The JWT is **never** returned in the response body — it lives only in
the httpOnly cookie. That makes XSS attacks unable to exfiltrate the
token but still lets the cookie flow with cross-origin requests when
the frontend uses ``credentials: "include"`` (or the same-origin
deployment we recommend for prod).
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from jose import jwt
from sqlalchemy.orm import Session

from core.settings import get_settings
from db.database import get_db
from db.models.user import User
from routers.deps import get_current_user, get_current_user_optional

logger = logging.getLogger("riftscope.auth")
router = APIRouter(prefix="/auth", tags=["auth"])

# Cookie + token configuration. ``access_token`` is the canonical cookie
# name read by ``routers.deps.get_current_user``.
COOKIE_NAME = "access_token"
STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"
STEAM_ID_RE = re.compile(r"https?://steamcommunity\.com/openid/id/(\d+)")


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------
def _issue_token(user: User) -> str:
    settings = get_settings()
    expires = datetime.utcnow() + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": str(user.id), "exp": expires}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def _set_session_cookie(response: Response, token: str) -> None:
    """Issue the httpOnly session cookie with environment-aware flags.

    In development the API + frontend share ``localhost`` so a plain
    ``samesite=lax`` cookie over HTTP is fine and avoids the
    "secure cookies require HTTPS" footgun.

    In production the frontend (Vercel) and API (Railway / Render)
    live on different registrable domains — that's a CROSS-SITE
    context, so the browser will only attach the cookie if it is both
    ``samesite=none`` AND ``secure=True``.  Sticking with ``lax`` (the
    previous default) silently dropped the cookie on every cross-site
    XHR, making login appear to succeed but ``/auth/me`` 401 forever.
    """
    settings = get_settings()
    is_dev = settings.environment == "development"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        # SameSite=None *requires* Secure per the cookie spec; modern
        # browsers reject the combination otherwise.  Tied together.
        secure=not is_dev,
        samesite="lax" if is_dev else "none",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )


# ---------------------------------------------------------------------------
# User serialization — single source of truth for /me, /steam/callback,
# and anywhere else the frontend reads the auth user.
# ---------------------------------------------------------------------------
def _serialize_user(u: User) -> dict:
    return {
        "id": str(u.id),
        "email": u.email,
        "username": u.username,
        "name": u.username or (u.email.split("@")[0] if u.email else "") or "User",
        "steam_id": u.steam_id,
        "avatar_url": u.avatar_url,
        # Extra Steam profile fields pulled from the Steam Web API at
        # login time. Optional — privacy-locked profiles return them
        # empty, and dev environments without STEAM_API_KEY will too.
        "steam_profile_url": u.steam_profile_url,
        "steam_realname": u.steam_realname,
        "steam_country": u.steam_country,
        # Whether the user has configured a personal Steam Web API
        # key (used for demo extraction). We expose ONLY the boolean
        # — never the key itself — so a leaked /auth/me response
        # can't be used to impersonate the user against the Steam
        # Web API.
        "has_steam_api_key": bool(u.steam_api_key),
        "is_admin": bool(u.is_admin),
        "is_active": bool(u.is_active),
        "tier": u.subscription_tier or "free",
        "subscription_status": u.subscription_status or "inactive",
        "role": "admin" if u.is_admin else "user",
        "status": "active" if u.is_active else "banned",
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login": u.last_login.isoformat() if u.last_login else None,
    }


# ---------------------------------------------------------------------------
# /auth/me — hydrate the frontend auth store
# ---------------------------------------------------------------------------
@router.get("/me")
async def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return the current user's profile.

    Self-healing: if the user is Steam-linked but their cached profile
    is still the placeholder ``steam:{steam_id}`` from a login that
    happened BEFORE ``STEAM_API_KEY`` was configured, attempt a fresh
    fetch from the Steam Web API right here. This means the user
    doesn't have to log out + back in after adding their API key —
    the next page load automatically refreshes their name + avatar.

    Cost: ~1 extra HTTP request to Steam per /me call IF the user is
    still on the placeholder. Once the username gets refreshed it
    won't match the ``steam:`` prefix anymore so this branch
    short-circuits.
    """
    if (
        user.steam_id
        and user.username
        and user.username.startswith("steam:")
    ):
        profile = await _fetch_steam_profile(user.steam_id)
        if profile.get("personaname"):
            user.username = profile["personaname"]
            user.avatar_url = profile.get("avatarfull") or user.avatar_url
            user.steam_profile_url = (
                profile.get("profileurl")
                or f"https://steamcommunity.com/profiles/{user.steam_id}"
            )
            if profile.get("realname"):
                user.steam_realname = profile["realname"]
            if profile.get("loccountrycode"):
                user.steam_country = profile["loccountrycode"]
            db.commit()
            db.refresh(user)
    return _serialize_user(user)


@router.get("/session")
def get_session(user: Optional[User] = Depends(get_current_user_optional)):
    """Optional-user variant — never 401s. Useful for the public
    landing page that wants to show ``Login`` vs ``Dashboard`` without
    a redirect dance."""
    if user is None:
        return {"authenticated": False, "user": None}
    return {"authenticated": True, "user": _serialize_user(user)}


# ---------------------------------------------------------------------------
# /auth/logout — clear the cookie
# ---------------------------------------------------------------------------
@router.post("/logout")
def logout(response: Response):
    # Delete with the SAME samesite + secure flags used at set time —
    # Chromium-based browsers will refuse to clear a SameSite=None
    # cookie when the Set-Cookie reply that's supposed to expire it
    # uses Lax, leaving a stale session token on the device.
    settings = get_settings()
    is_dev = settings.environment == "development"
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        samesite="lax" if is_dev else "none",
        secure=not is_dev,
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# /auth/me/steam-api-key — set / clear the player's personal Steam Web API
# key (the one they generate at steamcommunity.com/dev/apikey). Used by
# the demo-extractor flow to query the player's match history without
# needing a shared / global key.
#
# The response NEVER returns the raw key — only a boolean. The frontend
# treats the input as write-only (paste-and-save), which matches how
# every other "API token" form behaves in the wild.
# ---------------------------------------------------------------------------
@router.put("/me/steam-api-key")
async def set_steam_api_key(
    payload: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raw = (payload.get("api_key") or "").strip()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_key is required",
        )
    # Light validation: Steam Web API keys are 32-char uppercase hex.
    # Accept lowercase too in case the user paste-mangled the case.
    if len(raw) != 32 or not all(c in "0123456789ABCDEFabcdef" for c in raw):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Steam API key must be 32 hex characters",
        )
    user.steam_api_key = raw.upper()
    db.commit()
    db.refresh(user)
    return {"ok": True, "has_steam_api_key": True}


@router.delete("/me/steam-api-key")
async def clear_steam_api_key(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user.steam_api_key = None
    db.commit()
    db.refresh(user)
    return {"ok": True, "has_steam_api_key": False}


# ---------------------------------------------------------------------------
# Steam OpenID — login redirect
# ---------------------------------------------------------------------------
@router.get("/steam/login")
def steam_login():
    """Build the Steam OpenID request and 302 the browser to it.

    Steam returns to ``{frontend_origin}/auth/steam/callback`` — the
    Next.js page there forwards the query string to our callback
    handler below.
    """
    settings = get_settings()
    return_to = f"{settings.frontend_origin.rstrip('/')}/auth/steam/callback"
    realm = settings.steam_realm.rstrip("/")

    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_to,
        "openid.realm": realm,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    return RedirectResponse(f"{STEAM_OPENID_URL}?{urlencode(params)}")


# ---------------------------------------------------------------------------
# Steam OpenID — verify the assertion and upsert the user
# ---------------------------------------------------------------------------
async def _verify_openid_assertion(params: dict[str, str]) -> str | None:
    """Send the assertion back to Steam with ``mode=check_authentication``.

    Returns the verified 64-bit SteamID as a string, or ``None`` if
    Steam rejects the assertion. Verifying the assertion is REQUIRED —
    a malicious user could otherwise just fabricate the redirect params
    locally.
    """
    if params.get("openid.mode") != "id_res":
        return None

    # Echo all openid.* params back but flip mode → check_authentication.
    verify_params = {k: v for k, v in params.items() if k.startswith("openid.")}
    verify_params["openid.mode"] = "check_authentication"

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(STEAM_OPENID_URL, data=verify_params)
    if r.status_code != 200:
        logger.warning("Steam OpenID verify failed: %s", r.status_code)
        return None
    if "is_valid:true" not in r.text:
        logger.warning("Steam OpenID rejected assertion: %s", r.text)
        return None

    # Extract the SteamID from openid.claimed_id (canonical form).
    claimed_id = params.get("openid.claimed_id", "")
    m = STEAM_ID_RE.search(claimed_id)
    return m.group(1) if m else None


async def _fetch_steam_profile(steam_id: str) -> dict[str, str]:
    """Pull profile name + avatar from Steam — no API key required.

    Strategy:
      1. PRIMARY: scrape Steam's public XML profile endpoint at
         ``steamcommunity.com/profiles/{steamid}/?xml=1``. This is
         a long-standing public endpoint that returns the same
         display name + avatar + country every Steam user can see,
         WITHOUT any auth or API key. Works out of the box — no
         setup required for the dev (which is the whole point per
         the user's "no quiero tocar archivos" request).
      2. ENRICHMENT (optional): if ``STEAM_API_KEY`` is configured,
         ALSO hit the official Web API. Its data is identical for
         99 % of public profiles but slightly more reliable for
         edge cases, so we use it to override the XML values when
         present.

    Returns ``{}`` only if BOTH paths fail (private profile, network
    down, etc.) so the caller can still create the user with the
    placeholder name as a last resort.
    """
    out = await _fetch_steam_profile_xml(steam_id)
    settings = get_settings()
    if settings.steam_api_key:
        enriched = await _fetch_steam_profile_api(steam_id)
        if enriched:
            # API values override XML when both exist — the API is
            # slightly more authoritative (lower latency for renames).
            out = {**out, **enriched}
    return out


async def _fetch_steam_profile_xml(steam_id: str) -> dict[str, str]:
    """Scrape Steam's public XML profile endpoint. No key required.

    Returns the same shape ``_fetch_steam_profile`` historically did
    so the callback site doesn't need to know which path produced
    the data. Empty dict on failure.
    """
    url = f"https://steamcommunity.com/profiles/{steam_id}/?xml=1"
    async with httpx.AsyncClient(
        timeout=10.0,
        follow_redirects=True,
        headers={"User-Agent": "Riftscope/0.3 (+https://riftscope.local)"},
    ) as client:
        try:
            r = await client.get(url)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Steam XML scrape failed for %s: %s", steam_id, exc)
            return {}
    try:
        # ``xml.etree`` is stdlib — no new deps. Steam returns
        # well-formed XML for public profiles; private profiles return
        # a stub with no <steamID> tag, which we treat as empty.
        import xml.etree.ElementTree as ET
        root = ET.fromstring(r.text)
    except ET.ParseError as exc:
        logger.warning("Steam XML parse failed for %s: %s", steam_id, exc)
        return {}

    def _text(tag: str) -> str:
        el = root.find(tag)
        return (el.text or "").strip() if el is not None and el.text else ""

    personaname = _text("steamID")
    if not personaname:
        # Private profile or rate-limited. Treat as no data.
        logger.warning(
            "Steam XML for %s returned no <steamID> — likely private profile",
            steam_id,
        )
        return {}

    profile_url = _text("customURL")
    profile_url = (
        f"https://steamcommunity.com/id/{profile_url}/"
        if profile_url
        else f"https://steamcommunity.com/profiles/{steam_id}/"
    )

    # ``location`` is a free-text string like "Buenos Aires, Argentina".
    # The Web API gives an ISO country code; if we only have the XML
    # we keep the full string. Frontend tolerates either.
    out = {
        "personaname": personaname,
        "avatarfull": _text("avatarFull"),
        "profileurl": profile_url,
        "realname": _text("realname"),
        "loccountrycode": _text("location"),
    }
    logger.info(
        "Fetched Steam profile via XML for %s: name=%r location=%r",
        steam_id, out["personaname"], out["loccountrycode"],
    )
    return out


async def _fetch_steam_profile_api(steam_id: str) -> dict[str, str]:
    """Pull profile via the official Steam Web API (requires
    STEAM_API_KEY). Returns ``{}`` when the key isn't set or the
    request fails — the XML fallback covers that case."""
    settings = get_settings()
    if not settings.steam_api_key:
        return {}
    url = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(
                url, params={"key": settings.steam_api_key, "steamids": steam_id}
            )
            r.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Steam Web API fetch failed for %s: %s", steam_id, exc)
            return {}
    players = r.json().get("response", {}).get("players", [])
    if not players:
        return {}
    p = players[0]
    logger.info(
        "Enriched Steam profile via Web API for %s: name=%r country=%r",
        steam_id, p.get("personaname"), p.get("loccountrycode"),
    )
    return {
        "personaname": p.get("personaname", ""),
        "avatarfull": p.get("avatarfull", ""),
        "profileurl": p.get("profileurl", ""),
        "realname": p.get("realname", ""),
        "loccountrycode": p.get("loccountrycode", ""),
    }


@router.get("/steam/callback")
async def steam_callback(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Verify Steam's assertion, upsert the user, issue a session cookie.

    The frontend's callback page forwards the OpenID query string to
    this endpoint verbatim. We DO NOT trust those params until they
    pass ``check_authentication`` against Steam (see above).
    """
    params = {k: v for k, v in request.query_params.items()}
    steam_id = await _verify_openid_assertion(params)
    if not steam_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Steam OpenID verification failed",
        )

    # Upsert by steam_id. New users default to free / active / non-admin.
    user = db.query(User).filter(User.steam_id == steam_id).first()
    profile = await _fetch_steam_profile(steam_id)
    # Default profile URL when the Web API doesn't give us one (no API
    # key configured) — every Steam account has a numeric URL by ID,
    # so this always works as a fallback.
    fallback_profile_url = f"https://steamcommunity.com/profiles/{steam_id}"
    if user is None:
        user = User(
            steam_id=steam_id,
            username=profile.get("personaname") or f"steam:{steam_id}",
            avatar_url=profile.get("avatarfull") or None,
            steam_profile_url=profile.get("profileurl") or fallback_profile_url,
            steam_realname=profile.get("realname") or None,
            steam_country=profile.get("loccountrycode") or None,
        )
        db.add(user)
    else:
        # Refresh display name + avatar + extras on every login so the
        # cached data stays fresh (Steam renames, country changes, etc.).
        if profile.get("personaname"):
            user.username = profile["personaname"]
        if profile.get("avatarfull"):
            user.avatar_url = profile["avatarfull"]
        # Always set the profile URL (falls back to numeric URL).
        user.steam_profile_url = profile.get("profileurl") or fallback_profile_url
        if profile.get("realname"):
            user.steam_realname = profile["realname"]
        if profile.get("loccountrycode"):
            user.steam_country = profile["loccountrycode"]
    user.last_login = datetime.utcnow()
    db.commit()
    db.refresh(user)

    token = _issue_token(user)
    _set_session_cookie(response, token)
    return _serialize_user(user)
