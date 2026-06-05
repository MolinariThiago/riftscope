"""
ProMatch — pro / community matches discovered from external sources
(Liquipedia today, more sources later).

Separated from Demo because:
- A pro match exists *before* we have its .dem file (and may never).
- Multiple sources can describe the same match — we dedupe on
  ``(source, source_match_id)``.
- A pro match can later be linked to a parsed Demo via ``demo_id``.
"""

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from core.utc import utcnow_naive
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

    # Competitive tier of the match — set by the admin at upload time
    # and used downstream by the AI scoring engine (later phases) to
    # weight insights / opening picks / aggression patterns by skill
    # level. NOT surfaced in the public ``/pro`` feed; lives purely as
    # internal metadata. Expected values:
    #   - ``S+`` : Majors (IEM Cologne, Katowice, Major main stage)
    #   - ``S``  : BLAST Premier finals, ESL Pro League grand finals
    #   - ``A``  : Tier-1 regional, BLAST Showdown, IEM regional
    #   - ``B``  : Tier-2 online, qualifiers, smaller LANs
    #   - ``C``  : Tier-3, FACEIT cups, FPL-C tournaments
    #   - NULL   : unclassified / pickup match / amateur
    tier = Column(String, nullable=True, index=True)

    played_at = Column(DateTime, nullable=True, index=True)
    indexed_at = Column(DateTime, default=utcnow_naive, nullable=False)

    demo_url = Column(String, nullable=True)

    # When the user imports + parses this match, link the resulting Demo row.
    demo_id = Column(Integer, ForeignKey("demos.id", ondelete="SET NULL"), nullable=True)

    # Import lifecycle for the DOWNLOAD phase (before a Demo row exists, so it
    # can't be tracked via demo status yet). The manual import endpoint now
    # returns immediately and runs the download in the background, updating
    # this so the /pro UI can show "downloading…" / "failed" instead of
    # hanging on an open request.
    #   None        — idle / never imported (or done: demo_id is set)
    #   "importing" — download from HLTV in progress
    #   "failed"    — download / extract failed (reason in import_error)
    import_status = Column(String, nullable=True)
    import_error = Column(String, nullable=True)

    # Download accounting — feeds the daily budget cap in the scheduler.
    # ``import_bytes`` is the .rar / .zip size pulled from HLTV (NOT the
    # uncompressed .dem size — what matters for the proxy budget is what
    # actually came over the wire).  ``import_completed_at`` is when
    # the download finished, so the scheduler can sum
    # ``SUM(import_bytes) WHERE import_completed_at >= today_utc``
    # to enforce ``PRO_DAILY_DOWNLOAD_LIMIT_GB``.
    import_bytes = Column(BigInteger, nullable=True, index=True)
    import_completed_at = Column(DateTime, nullable=True, index=True)

    # Team logo URLs scraped from the source page. HLTV serves stable
    # team logos at ``https://img-cdn.hltv.org/teamlogo/<id>.svg`` —
    # the scraper extracts the team id from the row's anchor and we
    # store the assembled URL. Null when the source didn't surface
    # team ids (older Liquipedia rows, or any HLTV row without team
    # links). The frontend renders a small img if present and falls
    # back to text-only when null.
    team_a_logo_url = Column(String, nullable=True)
    team_b_logo_url = Column(String, nullable=True)

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
            # ``tier`` is intentionally exposed in the API so the future
            # AI consumer + admin tooling can read it. The public ``/pro``
            # cards just ignore the field — clean UX, internal data.
            "tier": self.tier,
            "playedAt": self.played_at.isoformat() if self.played_at else None,
            "demoUrl": self.demo_url,
            "demoId": self.demo_id,
            "importStatus": self.import_status,
            "importError": self.import_error,
            "importBytes": self.import_bytes,
            "importCompletedAt": (
                self.import_completed_at.isoformat() if self.import_completed_at else None
            ),
            "teamALogoUrl": self.team_a_logo_url,
            "teamBLogoUrl": self.team_b_logo_url,
        }
