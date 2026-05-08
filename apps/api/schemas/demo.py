"""
Pydantic v2 schemas for demo-related API responses.

These mirror `apps/web/types/demo.ts` so the contract stays in sync.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

DemoStatus = Literal["uploaded", "queued", "processing", "completed", "failed"]


class DemoUploadResponse(BaseModel):
    id: str
    filename: str
    status: DemoStatus
    uploaded_at: datetime = Field(..., alias="uploadedAt")

    model_config = ConfigDict(populate_by_name=True)


class DemoSummary(BaseModel):
    """Lightweight demo entry for /demos list."""

    id: str
    filename: str
    status: DemoStatus
    uploaded_at: datetime = Field(..., alias="uploadedAt")
    processed_at: Optional[datetime] = Field(None, alias="processedAt")
    processing_progress: int = Field(0, alias="processingProgress")
    error_message: Optional[str] = Field(None, alias="errorMessage")
    map: Optional[str] = None
    tickrate: Optional[int] = None
    duration_seconds: Optional[int] = Field(None, alias="durationSeconds")
    round_count: Optional[int] = Field(None, alias="roundCount")
    score: Optional[list[int]] = None

    model_config = ConfigDict(populate_by_name=True)


class DemoStatusResponse(BaseModel):
    id: str
    status: DemoStatus
    progress: int
    error_message: Optional[str] = Field(None, alias="errorMessage")

    model_config = ConfigDict(populate_by_name=True)


class TimelineRoundMeta(BaseModel):
    """Lightweight per-round metadata sent inside DemoAnalysisResponse."""

    round_number: int = Field(..., alias="roundNumber")
    duration_seconds: float = Field(..., alias="durationSeconds")
    frame_count: int = Field(..., alias="frameCount")
    event_count: int = Field(..., alias="eventCount")

    model_config = ConfigDict(populate_by_name=True)


class TimelineMeta(BaseModel):
    fps: int
    rounds: list[TimelineRoundMeta]


class DemoAnalysisResponse(BaseModel):
    """Full analysis payload — without heavy per-frame data."""

    demo: DemoSummary
    players: list[dict[str, Any]]
    rounds: list[dict[str, Any]]
    kills: list[dict[str, Any]]
    clutches: list[dict[str, Any]]
    economy: list[dict[str, Any]]
    heatmap_points: list[dict[str, Any]] = Field(..., alias="heatmapPoints")
    timeline: TimelineMeta

    model_config = ConfigDict(populate_by_name=True)


class RoundTimelineResponse(BaseModel):
    """Heavy per-round timeline (frames + events) loaded on demand."""

    round_number: int = Field(..., alias="roundNumber")
    fps: int
    duration_seconds: float = Field(..., alias="durationSeconds")
    frames: list[dict[str, Any]]
    events: list[dict[str, Any]]

    model_config = ConfigDict(populate_by_name=True)
