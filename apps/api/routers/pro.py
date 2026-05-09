"""
/pro endpoints — pro / community match feed driven by external sources.

Today we surface what :mod:`services.demo_sources` returns (Liquipedia).
A POST to ``/pro/sync`` triggers a one-shot ingestion run; the GET feed
reads from the local ``pro_matches`` table (cached across requests).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from db.database import get_db
from db.models.pro_match import ProMatch
from services.demo_sources import get_sources

logger = logging.getLogger("riftscope.pro")
router = APIRouter()


@router.get("/matches")
async def list_pro_matches(
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(ProMatch)
        .order_by(ProMatch.played_at.desc().nullslast(), ProMatch.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "total": len(rows),
        "matches": [r.to_dict() for r in rows],
    }


@router.post("/sync")
async def sync_pro_matches(db: Session = Depends(get_db)):
    """
    Pull recent matches from every active source and upsert them.

    Idempotent on ``(source, source_match_id)``. Safe to call repeatedly —
    duplicates are skipped, new entries are inserted.
    """
    since = datetime.now(timezone.utc) - timedelta(days=14)
    inserted = 0
    updated = 0
    errors: list[dict] = []

    for source in get_sources():
        try:
            matches = await source.list_recent_matches(since=since, limit=100)
        except Exception as exc:  # pragma: no cover — network issues
            logger.exception("source %s failed", source.name)
            errors.append({"source": source.name, "error": str(exc)})
            continue

        for m in matches:
            # Normalize tz-aware datetimes to naive UTC for SQLite storage.
            played_at_naive = (
                m.played_at.astimezone(timezone.utc).replace(tzinfo=None)
                if m.played_at is not None
                else None
            )

            existing = (
                db.query(ProMatch)
                .filter(
                    ProMatch.source == m.source,
                    ProMatch.source_match_id == m.source_match_id,
                )
                .first()
            )
            if existing:
                # Update score / played_at if the match has progressed.
                changed = False
                if m.score_a is not None and existing.score_a != m.score_a:
                    existing.score_a = m.score_a
                    changed = True
                if m.score_b is not None and existing.score_b != m.score_b:
                    existing.score_b = m.score_b
                    changed = True
                if played_at_naive and not existing.played_at:
                    existing.played_at = played_at_naive
                    changed = True
                if m.demo_url and not existing.demo_url:
                    existing.demo_url = m.demo_url
                    changed = True
                if changed:
                    updated += 1
                continue

            db.add(
                ProMatch(
                    source=m.source,
                    source_match_id=m.source_match_id,
                    team_a=m.team_a,
                    team_b=m.team_b,
                    score_a=m.score_a,
                    score_b=m.score_b,
                    map_name=m.map,
                    event_name=m.event_name,
                    played_at=played_at_naive,
                    demo_url=m.demo_url,
                )
            )
            inserted += 1

    db.commit()
    return {"inserted": inserted, "updated": updated, "errors": errors}


@router.delete("/matches/{match_id}")
async def delete_pro_match(match_id: int, db: Session = Depends(get_db)):
    row = db.query(ProMatch).filter(ProMatch.id == match_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Pro match not found")
    db.delete(row)
    db.commit()
    return None
