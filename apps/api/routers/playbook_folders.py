"""
/playbook-folders endpoints — folders that group Playbook items.

Same visibility model as playbooks (routers.playbook): a folder is the
owner's, or shared with a team they belong to; admins see everything.
Separate router (mounted at /playbook-folders) so the ``/folders`` path
never collides with ``/playbooks/{pb_id}``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from core.utc import utcnow_naive
from db.database import get_db
from db.models.playbook import Playbook, PlaybookFolder
from db.models.user import User
from routers.deps import get_current_user
from routers.team import my_team_ids
from schemas.playbook import FolderCreate, FolderResponse, FolderUpdate

router = APIRouter()


def _resp(f: PlaybookFolder, item_count: int) -> FolderResponse:
    return FolderResponse(
        id=f.id,
        name=f.name,
        team_id=f.team_id,
        item_count=item_count,
        created_at=f.created_at,
        updated_at=f.updated_at,
    )


def _get_accessible(folder_id: int, db: Session, user: User) -> PlaybookFolder:
    f = db.query(PlaybookFolder).filter(PlaybookFolder.id == folder_id).first()
    if f is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    if user.is_admin or f.user_id == user.id:
        return f
    if f.team_id is not None and f.team_id in my_team_ids(db, user):
        return f
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your folder")


@router.get("", response_model=list[FolderResponse])
def list_folders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    team_ids = my_team_ids(db, current_user)
    rows = (
        db.query(PlaybookFolder)
        .filter(
            or_(
                PlaybookFolder.user_id == current_user.id,
                PlaybookFolder.team_id.in_(team_ids) if team_ids else False,
            )
        )
        .order_by(PlaybookFolder.name)
        .all()
    )
    counts = dict(
        db.query(Playbook.folder_id, func.count(Playbook.id))
        .filter(Playbook.folder_id.isnot(None))
        .group_by(Playbook.folder_id)
        .all()
    )
    return [_resp(f, counts.get(f.id, 0)) for f in rows]


@router.post("", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
def create_folder(
    body: FolderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.team_id is not None and body.team_id not in my_team_ids(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of that team")
    f = PlaybookFolder(
        user_id=current_user.id,
        team_id=body.team_id,
        name=(body.name or "Untitled folder").strip() or "Untitled folder",
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return _resp(f, 0)


@router.put("/{folder_id}", response_model=FolderResponse)
def rename_folder(
    folder_id: int,
    body: FolderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = _get_accessible(folder_id, db, current_user)
    if body.name is not None and body.name.strip():
        f.name = body.name.strip()
    f.updated_at = utcnow_naive()
    db.commit()
    db.refresh(f)
    cnt = db.query(Playbook).filter(Playbook.folder_id == f.id).count()
    return _resp(f, cnt)


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a folder; its items revert to loose (folder_id → NULL)."""
    f = _get_accessible(folder_id, db, current_user)
    db.query(Playbook).filter(Playbook.folder_id == f.id).update(
        {Playbook.folder_id: None}, synchronize_session=False
    )
    db.delete(f)
    db.commit()
    return None
