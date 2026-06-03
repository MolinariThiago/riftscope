"""Pydantic schemas for the feedback widget + admin queue."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# Mirror of FEEDBACK_CATEGORIES in db/models/feedback.py. Kept as Literal
# so OpenAPI / TypeScript codegen sees the closed enum.
FeedbackCategory = Literal[
    "bug", "demo_issue", "idea", "suggestion", "question",
]
FeedbackStatus = Literal["open", "reviewing", "resolved", "dismissed"]


class FeedbackCreate(BaseModel):
    """Payload the widget POSTs to /feedback."""

    category: FeedbackCategory
    subject: Optional[str] = Field(None, max_length=120)
    body: str = Field(..., min_length=1, max_length=1500)
    # Auto-captured context (the user doesn't type these). All optional
    # so a degraded client can still submit.
    page_url: Optional[str] = Field(None, alias="pageUrl", max_length=500)
    user_agent: Optional[str] = Field(None, alias="userAgent", max_length=500)
    demo_id: Optional[int] = Field(None, alias="demoId")

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("body")
    @classmethod
    def _strip_body(cls, v: str) -> str:
        # Strip whitespace and re-validate — "       " shouldn't pass min_length.
        s = (v or "").strip()
        if not s:
            raise ValueError("body cannot be empty")
        return s

    @field_validator("subject")
    @classmethod
    def _strip_subject(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = v.strip()
        return s or None


class FeedbackPublic(BaseModel):
    """Slim response shown to the reporter after submit — just confirms
    we got it. Intentionally does NOT echo back internal triage state."""

    id: int
    status: FeedbackStatus
    created_at: datetime = Field(..., alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)


class FeedbackReporter(BaseModel):
    id: Optional[str] = None
    nick: Optional[str] = None
    steam_id: Optional[str] = Field(None, alias="steamId")
    avatar_url: Optional[str] = Field(None, alias="avatarUrl")

    model_config = ConfigDict(populate_by_name=True)


class FeedbackAdmin(BaseModel):
    """Full record shown in the /admin queue."""

    id: int
    category: FeedbackCategory
    subject: Optional[str]
    body: str
    status: FeedbackStatus
    page_url: Optional[str] = Field(None, alias="pageUrl")
    user_agent: Optional[str] = Field(None, alias="userAgent")
    demo_id: Optional[int] = Field(None, alias="demoId")
    admin_notes: Optional[str] = Field(None, alias="adminNotes")
    created_at: Optional[datetime] = Field(None, alias="createdAt")
    updated_at: Optional[datetime] = Field(None, alias="updatedAt")
    reporter: Optional[FeedbackReporter] = None

    model_config = ConfigDict(populate_by_name=True)


class FeedbackAdminUpdate(BaseModel):
    """PATCH body for triage. Either field may be sent on its own."""

    status: Optional[FeedbackStatus] = None
    admin_notes: Optional[str] = Field(
        None, alias="adminNotes", max_length=5000,
    )

    model_config = ConfigDict(populate_by_name=True)


class FeedbackAdminList(BaseModel):
    total: int
    items: list[FeedbackAdmin]
    # Counts per status so the UI can render filter chips with numbers.
    counts: dict[str, int]

    model_config = ConfigDict(populate_by_name=True)
