"""
RoundTactic — one auto-detected "play" per round (T/attacking side).

Computed at parse time by :func:`services.anti_strat.detect_round_tactics`
and persisted so the anti-strat Playbook can query "every execute/default/
fake team X has run on map Y" fast, without re-reading the heavy
``analysis_data`` JSON.

Heuristic-based (positions + utility timing + bomb plant), so ``type`` is a
best-effort classification, not ground truth — see the service for details.
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
)

from core.utc import utcnow_naive
from db.database import Base


class RoundTactic(Base):
    __tablename__ = "round_tactics"

    id = Column(Integer, primary_key=True, index=True)
    demo_id = Column(Integer, ForeignKey("demos.id", ondelete="CASCADE"), nullable=False, index=True)

    round_number = Column(Integer, nullable=False)
    half = Column(Integer, nullable=False, default=1)

    # Attacking (T) team's clan name for this round, plus the map — both
    # indexed so "all plays of team X on map Y" is a cheap query.
    team_name = Column(String, nullable=True, index=True)
    map_name = Column(String, nullable=True, index=True)

    side = Column(String, nullable=False, default="tt")     # analysed side (T for v1)
    site = Column(String, nullable=True)                    # "A" | "B" | None
    type = Column(String, nullable=False, default="default")  # execute | default | fake
    plant_time = Column(Float, nullable=True)               # seconds into the round
    won = Column(Boolean, default=False, nullable=False)
    util_signature = Column(JSON, nullable=True)            # [{subtype, site, t}, ...]

    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
