"""
ProMatch — pro / community matches discovered from external sources
(Liquipedia today, more sources later).

Separated from Demo because:
- A pro match exists *before* we have its .dem file (and may never).
- Multiple sources can describe the same match — we dedupe on
  ``(source, source_match_id)``.
- A pro match can later be linked to a parsed Demo via ``demo_id``.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from db.database import Base


class ProMatch(Base):
    __tablename__ = "pro_matches"
    __table_args__ = (
        UniqueConstraint("source", "source_match_id", name="uq_pro_match_source"),
    )

    id = Column(Integer, primary_key=True, index=True)

    source = Column(String, nullable=False, index=True)            # "liquipedia" | "hltv-polite" | ...
    source_match_id = Column(String, nullable=False, index=True)

    team_a = Column(String, nullable=False)
    team_b = Column(String, nullable=False)
    score_a = Column(Integer, nullable=True)
    score_b = Column(Integer, nullable=True)

    map_name = Column(String, nullable=True)
    event_name = Column(String, nullable=True)

    played_at = Column(DateTime, nullable=True, index=True)
    indexed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    demo_url = Column(String, nullable=True)

    # When the user imports + parses this match, link the resulting Demo row.
    demo_id = Column(Integer, ForeignKey("demos.id", ondelete="SET NULL"), nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source": self.source,
            "sourceMatchId": self.source_match_id,
            "teamA": self.team_a,
            "teamB": self.team_b,
            "scoreA": self.score_a,
            "scoreB": self.score_b,
            "map": self.map_name,
            "event": self.event_name,
            "playedAt": self.played_at.isoformat() if self.played_at else None,
            "demoUrl": self.demo_url,
            "demoId": self.demo_id,
        }
