"""
Public stats — anonymous-safe counters for the landing page.

The admin /metrics endpoint already returns rich KPIs, but it's gated
behind require_admin. The landing page wants just four big numbers
that anyone can see: how many demos have been analysed, how many pro
matches are in the library, how many distinct players we've indexed,
and the total rounds across the corpus.

Cached per-request — these counts don't change between scrolls.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.database import get_db
from db.models.demo import Demo, DemoPlayer
from db.models.pro_match import ProMatch

router = APIRouter()


@router.get("/public")
def get_public_stats(db: Session = Depends(get_db)) -> dict:
    """Counts the landing page shows as trust signals."""

    demos_analysed = (
        db.query(func.count(Demo.id))
        .filter(Demo.status == "completed")
        .scalar()
        or 0
    )
    pro_matches = (
        db.query(func.count(ProMatch.id))
        .filter(ProMatch.demo_id.isnot(None))
        .scalar()
        or 0
    )
    players_ranked = (
        db.query(func.count(func.distinct(DemoPlayer.steam_id))).scalar() or 0
    )
    rounds_analysed = (
        db.query(func.coalesce(func.sum(Demo.round_count), 0))
        .filter(Demo.status == "completed")
        .scalar()
        or 0
    )

    return {
        "demosAnalysed": int(demos_analysed),
        "proMatches": int(pro_matches),
        "playersRanked": int(players_ranked),
        "roundsAnalysed": int(rounds_analysed),
    }
