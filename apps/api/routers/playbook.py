"""
/playbooks endpoints — CRUD for user-authored tactical-board playbooks.

Visibility model mirrors :mod:`routers.demos`: playbooks are PRIVATE to
their owner. Every query is scoped by ``user_id`` and admins bypass the
ownership check (so an operator can recover / inspect).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.utc import utcnow_naive
from db.database import get_db
from db.models.playbook import Playbook, PlaybookFolder
from db.models.user import User
from routers.deps import get_current_user
from routers.team import my_team_ids
from schemas.playbook import (
    PlaybookCreate,
    PlaybookResponse,
    PlaybookSummary,
    PlaybookUpdate,
)

router = APIRouter()


def _summary(pb: Playbook) -> PlaybookSummary:
    return PlaybookSummary(
        id=pb.id,
        title=pb.title,
        map=pb.map_name,
        side=pb.side,
        type=pb.type,
        tags=pb.tags or [],
        team_id=pb.team_id,
        folder_id=pb.folder_id,
        kind=pb.kind or "tactic",
        demo_id=pb.demo_id,
        round_number=pb.round_number,
        created_at=pb.created_at,
        updated_at=pb.updated_at,
    )


def _full(pb: Playbook) -> PlaybookResponse:
    return PlaybookResponse(
        id=pb.id,
        title=pb.title,
        map=pb.map_name,
        side=pb.side,
        type=pb.type,
        tags=pb.tags or [],
        team_id=pb.team_id,
        folder_id=pb.folder_id,
        kind=pb.kind or "tactic",
        demo_id=pb.demo_id,
        round_number=pb.round_number,
        data=pb.data or {},
        created_at=pb.created_at,
        updated_at=pb.updated_at,
    )


def _assert_folder_access(db: Session, user: User, folder_id: int) -> None:
    """403 unless the folder exists and the user can put items in it."""
    f = db.query(PlaybookFolder).filter(PlaybookFolder.id == folder_id).first()
    if f is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    if user.is_admin or f.user_id == user.id:
        return
    if f.team_id is not None and f.team_id in my_team_ids(db, user):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your folder")


def _get_accessible(pb_id: int, db: Session, user: User) -> Playbook:
    """Fetch a playbook the user can read/edit. 404 when missing, 403 when
    it's neither theirs, an admin, nor shared with a team they belong to."""
    pb = db.query(Playbook).filter(Playbook.id == pb_id).first()
    if pb is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playbook not found")
    if user.is_admin or pb.user_id == user.id:
        return pb
    if pb.team_id is not None and pb.team_id in my_team_ids(db, user):
        return pb
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your playbook")


@router.get("", response_model=list[PlaybookSummary])
def list_playbooks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    team_ids = my_team_ids(db, current_user)
    rows = (
        db.query(Playbook)
        .filter(
            or_(
                Playbook.user_id == current_user.id,
                Playbook.team_id.in_(team_ids) if team_ids else False,
            )
        )
        .order_by(Playbook.updated_at.desc())
        .all()
    )
    return [_summary(p) for p in rows]


@router.post("", response_model=PlaybookResponse, status_code=status.HTTP_201_CREATED)
def create_playbook(
    body: PlaybookCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.team_id is not None and body.team_id not in my_team_ids(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of that team")
    if body.folder_id is not None:
        _assert_folder_access(db, current_user, body.folder_id)
    pb = Playbook(
        user_id=current_user.id,
        title=body.title or "Untitled tactic",
        map_name=body.map or "de_mirage",
        side=body.side,
        type=body.type,
        tags=body.tags or [],
        team_id=body.team_id,
        folder_id=body.folder_id,
        kind=body.kind or "tactic",
        demo_id=body.demo_id,
        round_number=body.round_number,
        data=body.data or {},
    )
    db.add(pb)
    db.commit()
    db.refresh(pb)
    return _full(pb)


@router.get("/{pb_id}", response_model=PlaybookResponse)
def get_playbook(
    pb_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _full(_get_accessible(pb_id, db, current_user))


@router.put("/{pb_id}", response_model=PlaybookResponse)
def update_playbook(
    pb_id: int,
    body: PlaybookUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pb = _get_accessible(pb_id, db, current_user)
    if body.title is not None:
        pb.title = body.title
    if body.map is not None:
        pb.map_name = body.map
    if body.side is not None:
        pb.side = body.side
    if body.type is not None:
        pb.type = body.type
    if body.tags is not None:
        pb.tags = body.tags
    # team_id uses explicit presence (model_fields_set) so a client can
    # un-share by sending null without it being confused with "absent".
    if "team_id" in body.model_fields_set:
        if body.team_id is not None and body.team_id not in my_team_ids(db, current_user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of that team")
        pb.team_id = body.team_id
    # folder_id uses explicit presence so sending null moves it to root.
    if "folder_id" in body.model_fields_set:
        if body.folder_id is not None:
            _assert_folder_access(db, current_user, body.folder_id)
        pb.folder_id = body.folder_id
    if body.kind is not None:
        pb.kind = body.kind
    if "demo_id" in body.model_fields_set:
        pb.demo_id = body.demo_id
    if body.round_number is not None:
        pb.round_number = body.round_number
    if body.data is not None:
        pb.data = body.data
    pb.updated_at = utcnow_naive()
    db.commit()
    db.refresh(pb)
    return _full(pb)


@router.delete("/{pb_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_playbook(
    pb_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pb = _get_accessible(pb_id, db, current_user)
    db.delete(pb)
    db.commit()
    return None
