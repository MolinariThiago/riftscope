"""
Pydantic v2 schemas for demo / map API responses.

These mirror ``apps/web/types/demo.ts`` so the contract stays in sync.
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
    # Team identity (Phase 0). A started CT, B started T. Null until a
    # demo is (re)parsed with clan extraction.
    team_a: Optional[str] = Field(None, alias="teamA")
    team_b: Optional[str] = Field(None, alias="teamB")

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
    # Bounds of the actual play period inside the full timeline
    # (which now includes freeze + post). Frontend uses these to
    # clamp playback when the user toggles off the freeze/post view.
    play_start_t: float = Field(0.0, alias="playStartT")
    play_end_t: float = Field(0.0, alias="playEndT")

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
    loadouts: dict[str, dict[str, Any]] = Field(default_factory=dict)
    # Bounds of the actual play period inside the full extended
    # timeline (freeze + play + post). Frontend uses these to clamp
    # playback when the user toggles off the freeze/post view.
    play_start_t: float = Field(0.0, alias="playStartT")
    play_end_t: float = Field(0.0, alias="playEndT")

    model_config = ConfigDict(populate_by_name=True)


# ---------------------------------------------------------------------------
# Map metadata (Phase 3A)
# ---------------------------------------------------------------------------


class MapCalloutResponse(BaseModel):
    name: str
    x: float
    y: float
    radius: float


class DemoInsightsResponse(BaseModel):
    """Pre-computed insights payload — served from cache, never live."""

    engine_version: str = Field(..., alias="engineVersion")
    summary: dict[str, Any]
    rounds: list[dict[str, Any]]
    players: list[dict[str, Any]]
    heatmap: dict[str, Any]
    computed_at: Optional[datetime] = Field(None, alias="computedAt")

    model_config = ConfigDict(populate_by_name=True)


class MapMetadataResponse(BaseModel):
    name: str
    display_name: str = Field(..., alias="displayName")

    # Radar projection (Valve overview <map>.txt constants)
    pos_x: float = Field(..., alias="posX")
    pos_y: float = Field(..., alias="posY")
    scale: float
    radar_size: int = Field(..., alias="radarSize")

    # Asset URLs
    radar_url: str = Field(..., alias="radarUrl")
    radar_url_lower: Optional[str] = Field(None, alias="radarUrlLower")
    lower_threshold_z: Optional[float] = Field(None, alias="lowerThresholdZ")

    # World bounds (derived)
    world_min_x: float = Field(..., alias="worldMinX")
    world_max_x: float = Field(..., alias="worldMaxX")
    world_min_y: float = Field(..., alias="worldMinY")
    world_max_y: float = Field(..., alias="worldMaxY")

    # Anchors (world coords)
    site_a: list[float] = Field(..., alias="siteA")
    site_b: list[float] = Field(..., alias="siteB")
    spawn_ct: list[float] = Field(..., alias="spawnCt")
    spawn_tt: list[float] = Field(..., alias="spawnTt")
    callouts: list[MapCalloutResponse]

    model_config = ConfigDict(populate_by_name=True)
