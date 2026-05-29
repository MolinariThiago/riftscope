"""Pydantic v2 schemas for team membership + sharing."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class TeamCreate(BaseModel):
    name: str = "My team"


class TeamJoin(BaseModel):
    code: str


class TeamOut(BaseModel):
    id: int
    name: str
    invite_code: str = Field(..., alias="inviteCode")
    role: str  # the requesting user's role: "owner" | "member"
    member_count: int = Field(..., alias="memberCount")
    created_at: datetime = Field(..., alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)
