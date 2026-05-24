"""
Shared FastAPI dependencies — auth + DB session helpers.

The two functions below are the canonical way to inject the current user
into route handlers:

- :func:`get_current_user`           → 401 if not signed in.
- :func:`get_current_user_optional`  → ``None`` if not signed in.

Tokens are read from the ``access_token`` cookie (httpOnly, set by the
``/auth/login`` and ``/auth/register`` endpoints).
"""

from __future__ import annotations

import logging

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from core.settings import get_settings
from db.database import get_db
from db.models.user import User

logger = logging.getLogger("riftscope.auth")


def _decode(token: str) -> str | None:
    """Decode an access token and return the user id, or ``None`` if invalid."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.algorithm]
        )
    except JWTError:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None


def get_current_user(
    request: Request, db: Session = Depends(get_db)
) -> User:
    """Strict: 401 when no valid session."""
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    user_id = _decode(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if not user.is_active:
        # Disabled / banned account — treat as unauthenticated rather than
        # leaking the existence of the account.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account disabled",
        )
    return user


def get_current_user_optional(
    request: Request, db: Session = Depends(get_db)
) -> User | None:
    """Best-effort: returns ``None`` instead of raising for anonymous sessions."""
    token = request.cookies.get("access_token")
    if not token:
        return None
    user_id = _decode(token)
    if not user_id:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        return None
    return user
