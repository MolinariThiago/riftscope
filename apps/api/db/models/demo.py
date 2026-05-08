"""
Demo SQLAlchemy model — full schema for RIFTSCOPE platform.

Status flow:
    uploaded -> queued -> processing -> completed
                                    `-> failed
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Float, Text, JSON

from db.database import Base


class Demo(Base):
    __tablename__ = "demos"

    # Identity
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)              # original name (display)
    storage_filename = Column(String, nullable=False)      # uuid-based name on disk

    # Lifecycle
    status = Column(String, default="uploaded", nullable=False, index=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    processed_at = Column(DateTime, nullable=True)
    processing_progress = Column(Integer, default=0, nullable=False)  # 0..100
    error_message = Column(Text, nullable=True)

    # Match metadata (filled by parser)
    map_name = Column(String, nullable=True)
    tick_rate = Column(Integer, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    round_count = Column(Integer, nullable=True)
    score_ct = Column(Integer, nullable=True)
    score_tt = Column(Integer, nullable=True)

    # Heavy parser output (denormalized JSON for v1; will move to relational tables in Phase 3)
    analysis_data = Column(JSON, nullable=True)

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
            "score": [self.score_ct, self.score_tt] if self.score_ct is not None else None,
        }
