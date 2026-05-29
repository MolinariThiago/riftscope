"""
Pydantic v2 schemas for the Playbook API.

A Playbook ITEM is either:
  - kind="tactic": a hand-drawn board document (``data`` = {entities, frames}),
    opened/edited in /tactics.
  - kind="round": a saved demo round (``demoId`` + ``roundNumber``), played
    back in the real 2D replay viewer.

Items live in optional folders (``folderId``). Folders are their own resource.
Mirrors ``apps/web/types/playbook.ts``. Aliases are camelCase.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class PlaybookCreate(BaseModel):
    title: str = "Untitled tactic"
    map: str = "de_mirage"
    side: Optional[str] = None
    type: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    team_id: Optional[int] = Field(None, alias="teamId")
    folder_id: Optional[int] = Field(None, alias="folderId")
    kind: str = "tactic"  # "tactic" | "round"
    demo_id: Optional[int] = Field(None, alias="demoId")
    round_number: Optional[int] = Field(None, alias="roundNumber")
    data: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)


class PlaybookUpdate(BaseModel):
    """All fields optional — only the provided ones are written."""

    title: Optional[str] = None
    map: Optional[str] = None
    side: Optional[str] = None
    type: Optional[str] = None
    tags: Optional[list[str]] = None
    team_id: Optional[int] = Field(None, alias="teamId")
    folder_id: Optional[int] = Field(None, alias="folderId")
    kind: Optional[str] = None
    demo_id: Optional[int] = Field(None, alias="demoId")
    round_number: Optional[int] = Field(None, alias="roundNumber")
    data: Optional[dict[str, Any]] = None

    model_config = ConfigDict(populate_by_name=True)


class PlaybookSummary(BaseModel):
    """Lightweight row for the playbook library list."""

    id: int
    title: str
    map: str
    side: Optional[str] = None
    type: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    team_id: Optional[int] = Field(None, alias="teamId")
    folder_id: Optional[int] = Field(None, alias="folderId")
    kind: str = "tactic"
    demo_id: Optional[int] = Field(None, alias="demoId")
    round_number: Optional[int] = Field(None, alias="roundNumber")
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)


class PlaybookResponse(PlaybookSummary):
    """Full playbook including the authored entities + frames (tactics)."""

    data: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------
# Folders
# --------------------------------------------------------------------------


class FolderCreate(BaseModel):
    name: str = "Untitled folder"
    team_id: Optional[int] = Field(None, alias="teamId")

    model_config = ConfigDict(populate_by_name=True)


class FolderUpdate(BaseModel):
    name: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class FolderResponse(BaseModel):
    id: int
    name: str
    team_id: Optional[int] = Field(None, alias="teamId")
    item_count: int = Field(0, alias="itemCount")
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)
