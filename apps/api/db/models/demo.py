"""
Demo SQLAlchemy models — full schema for RIFTSCOPE platform.

Status flow:
    uploaded -> queued -> processing -> completed
                                    `-> failed

Phase 3A normalizes the heavy fields that used to live exclusively inside
``Demo.analysis_data`` (a JSON blob) into proper relational tables:

- :class:`DemoPlayer` — one row per player per demo, indexed by Steam ID so
  ``/players/search`` aggregates without scanning JSON.
- :class:`DemoRound` — one row per round.
- :class:`DemoKill` — one row per kill, indexed by killer / victim Steam IDs.

The JSON blob is still kept on ``Demo.analysis_data`` because the per-frame
2D timeline lives there and is loaded on demand for the replay viewer. The
normalized tables sit alongside it for fast aggregate queries.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from core.utc import utcnow_naive
from db.database import Base


class Demo(Base):
    __tablename__ = "demos"

    # Identity
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)              # original name (display)
    storage_filename = Column(String, nullable=False)      # uuid-based name on disk

    # Lifecycle
    status = Column(String, default="uploaded", nullable=False, index=True)
    uploaded_at = Column(DateTime, default=utcnow_naive, nullable=False)
    processed_at = Column(DateTime, nullable=True)
    processing_progress = Column(Integer, default=0, nullable=False)  # 0..100
    error_message = Column(Text, nullable=True)

    # Match metadata (filled by parser)
    map_name = Column(String, nullable=True, index=True)
    tick_rate = Column(Integer, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    round_count = Column(Integer, nullable=True)
    score_ct = Column(Integer, nullable=True)
    score_tt = Column(Integer, nullable=True)
    # Team identity (Phase 0) — clan names. A started on CT, B started on T.
    # Indexed so anti-strat queries can scope "all demos of team X" fast.
    team_a_name = Column(String, nullable=True, index=True)
    team_b_name = Column(String, nullable=True, index=True)
    # Final score PER TEAM (team_a_name vs team_b_name), from the game's
    # scoreboard (team_rounds_total). score_ct/score_tt above are the legacy
    # per-SIDE tally, which is wrong after the halftime swap — prefer these.
    score_a = Column(Integer, nullable=True)
    score_b = Column(Integer, nullable=True)

    # Heavy parser output. Player/round/kill arrays are also normalized into
    # DemoPlayer/DemoRound/DemoKill, but the per-round 2D timeline (frames +
    # events) lives here because it's loaded on-demand for the replay viewer.
    analysis_data = Column(JSON, nullable=True)

    # Ownership — nullable so legacy / anonymous uploads keep working.
    # When auth is mandatory in a deployment, the demos router should
    # populate this from ``Depends(get_current_user)``.
    user_id = Column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Series linkage — when a pro_match comes from HLTV as a Bo3/Bo5, the
    # downloaded archive contains 2-3 .dem files (one per map). They all
    # share the same ``pro_match_id`` and the /pro page renders them as a
    # series. Null for solo uploads and demos that aren't tied to a pro
    # match (legacy / anonymous / user uploads).
    pro_match_id = Column(
        Integer,
        ForeignKey("pro_matches.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relationships — cascade so deleting a demo wipes its rows.
    user = relationship("User", back_populates="demos")
    players = relationship(
        "DemoPlayer",
        back_populates="demo",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    rounds = relationship(
        "DemoRound",
        back_populates="demo",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    kills = relationship(
        "DemoKill",
        back_populates="demo",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "filename": self.filename,
            "status": self.status,
            "uploadedAt": self.uploaded_at.isoformat() if self.uploaded_at else None,
            "processedAt": self.processed_at.isoformat() if self.processed_at else None,
            "processingProgress": self.processing_progress,
            "errorMessage": self.error_message,
            "map": self.map_name,
            "tickrate": self.tick_rate,
            "durationSeconds": self.duration_seconds,
            "roundCount": self.round_count,
            "score": (
                [self.score_a, self.score_b]
                if self.score_a is not None
                else ([self.score_ct, self.score_tt] if self.score_ct is not None else None)
            ),
            "teamA": self.team_a_name,
            "teamB": self.team_b_name,
        }


class DemoPlayer(Base):
    """One row per player per demo. Indexed by Steam ID for /players/search."""

    __tablename__ = "demo_players"

    id = Column(Integer, primary_key=True, index=True)
    demo_id = Column(Integer, ForeignKey("demos.id", ondelete="CASCADE"), nullable=False, index=True)

    steam_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    team = Column(String, nullable=False)  # "ct" | "tt" (side)
    clan_name = Column(String, nullable=True, index=True)  # team/clan identity

    kills = Column(Integer, default=0, nullable=False)
    deaths = Column(Integer, default=0, nullable=False)
    assists = Column(Integer, default=0, nullable=False)
    headshots = Column(Integer, default=0, nullable=False)
    adr = Column(Float, default=0.0, nullable=False)
    kast = Column(Integer, default=0, nullable=False)
    hs_percent = Column(Integer, default=0, nullable=False)
    rating = Column(Float, default=0.0, nullable=False, index=True)

    opening_kills = Column(Integer, default=0, nullable=False)
    opening_deaths = Column(Integer, default=0, nullable=False)
    clutch_wins = Column(Integer, default=0, nullable=False)
    clutch_attempts = Column(Integer, default=0, nullable=False)
    utility_damage = Column(Integer, default=0, nullable=False)
    flash_assists = Column(Integer, default=0, nullable=False)
    mvp_rounds = Column(Integer, default=0, nullable=False)

    demo = relationship("Demo", back_populates="players")


class DemoRound(Base):
    """One row per round. Used for fast per-demo round listings."""

    __tablename__ = "demo_rounds"

    id = Column(Integer, primary_key=True, index=True)
    demo_id = Column(Integer, ForeignKey("demos.id", ondelete="CASCADE"), nullable=False, index=True)

    number = Column(Integer, nullable=False)
    half = Column(Integer, nullable=False)
    winner = Column(String, nullable=False)        # "ct" | "tt"
    end_reason = Column(String, nullable=False)
    duration_seconds = Column(Integer, nullable=False)
    start_tick = Column(Integer, nullable=False)
    end_tick = Column(Integer, nullable=False)
    ct_equipment_value = Column(Integer, default=0, nullable=False)
    tt_equipment_value = Column(Integer, default=0, nullable=False)
    bomb_planted = Column(Boolean, default=False, nullable=False)
    bomb_site = Column(String, nullable=True)      # "A" | "B" | None

    demo = relationship("Demo", back_populates="rounds")


class DemoKill(Base):
    """One row per kill. Indexed for cross-demo player aggregations."""

    __tablename__ = "demo_kills"

    id = Column(Integer, primary_key=True, index=True)
    demo_id = Column(Integer, ForeignKey("demos.id", ondelete="CASCADE"), nullable=False, index=True)

    round_number = Column(Integer, nullable=False, index=True)
    tick = Column(Integer, nullable=False)
    killer_steam_id = Column(String, nullable=False, index=True)
    victim_steam_id = Column(String, nullable=False, index=True)
    weapon = Column(String, nullable=False)
    headshot = Column(Boolean, default=False, nullable=False)
    through_smoke = Column(Boolean, default=False, nullable=False)
    blinded = Column(Boolean, default=False, nullable=False)
    is_opening_kill = Column(Boolean, default=False, nullable=False)

    killer_x = Column(Float, nullable=False)
    killer_y = Column(Float, nullable=False)
    victim_x = Column(Float, nullable=False)
    victim_y = Column(Float, nullable=False)

    demo = relationship("Demo", back_populates="kills")
