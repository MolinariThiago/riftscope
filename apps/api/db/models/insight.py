"""
DemoInsight — pre-computed analytical insights for a parsed demo.

The pipeline runs once per demo (in the worker, right after parsing) and
stores everything as a JSON blob keyed by demo_id. Endpoints serve from
this cache without any live computation. Same idea as cs2.cam / Leetify:

    parse → derive insights → persist → frontend reads cached JSON

Each insight is a structured dict with at minimum:

    {
      "kind":        "trade" | "fast_plant" | "eco_win" | "default" |
                     "anti_eco_loss" | "opening_loss" | "save",
      "round":       int,
      "team":        "ct" | "tt",                      # whose insight
      "severity":    "info" | "good" | "bad",
      "title":       short headline,
      "summary":     one-line natural-language description,
      "evidence":    structured payload (kills, tick refs, etc.),
    }

Per-player rollups (kills traded, opening duels won/lost, util damage
proxies) are stored separately so the frontend can render leaderboards
without scanning insights.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
)

from db.database import Base


class DemoInsight(Base):
    """Single per-demo row holding the full insights payload."""

    __tablename__ = "demo_insights"

    id = Column(Integer, primary_key=True, index=True)
    demo_id = Column(
        Integer,
        ForeignKey("demos.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Versioning so older insights can be re-computed when the engine evolves.
    engine_version = Column(String, nullable=False, default="1")

    # Compact summary numbers used by dashboards / cards.
    summary = Column(JSON, nullable=False, default=dict)
    # Per-round insight list (everything the frontend needs to render the
    # "round breakdown" tab).
    rounds = Column(JSON, nullable=False, default=list)
    # Per-player rollups (opening duel wins, trades involved, clutches…).
    players = Column(JSON, nullable=False, default=list)
    # Heatmap grid: 32×32 cells with kill / death / util counts in world
    # bounds — saves the frontend from scanning all kills every render.
    heatmap = Column(JSON, nullable=False, default=dict)

    computed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
