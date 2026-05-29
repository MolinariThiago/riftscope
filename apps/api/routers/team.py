"""
/teams endpoints — create / join / list / leave / delete teams for
playbook sharing.

SQLite FK ``ondelete`` is not enforced unless ``PRAGMA foreign_keys=ON``
(which this project does not set), so team deletion fixes up dependent
rows explicitly: members are removed and shared playbooks revert to
personal (``team_id = NULL``).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.database import get_db
from db.models.playbook import Playbook
from db.models.team import Team, TeamMember
from db.models.user import User
from routers.deps import get_current_user
from schemas.team import TeamCreate, TeamJoin, TeamOut

router = APIRouter()


def _member_count(db: Session, team_id: int) -> int:
    return (
        db.query(func.count(TeamMember.id))
        .filter(TeamMember.team_id == team_id)
        .scalar()
        or 0
    )


def _out(db: Session, team: Team, role: str) -> TeamOut:
    return TeamOut(
        id=team.id,
        name=team.name,
        invite_code=team.invite_code,
        role=role,
        member_count=_member_count(db, team.id),
        created_at=team.created_at,
    )


def my_team_ids(db: Session, user: User) -> list[int]:
    rows = db.query(TeamMember.team_id).filter(TeamMember.user_id == user.id).all()
    return [r[0] for r in rows]


@router.get("", response_model=list[TeamOut])
def list_teams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Team, TeamMember.role)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .filter(TeamMember.user_id == current_user.id)
        .order_by(Team.created_at.desc())
        .all()
    )
    return [_out(db, t, role) for (t, role) in rows]


@router.post("", response_model=TeamOut, status_code=status.HTTP_201_CREATED)
def create_team(
    body: TeamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    team = Team(name=(body.name or "My team").strip() or "My team", owner_id=current_user.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=current_user.id, role="owner"))
    db.commit()
    db.refresh(team)
    return _out(db, team, "owner")


@router.post("/join", response_model=TeamOut)
def join_team(
    body: TeamJoin,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    code = (body.code or "").strip()
    team = db.query(Team).filter(Team.invite_code == code).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid invite code")
    existing = (
        db.query(TeamMember)
        .filter(TeamMember.team_id == team.id, TeamMember.user_id == current_user.id)
        .first()
    )
    if not existing:
        db.add(TeamMember(team_id=team.id, user_id=current_user.id, role="member"))
        db.commit()
    role = "owner" if team.owner_id == current_user.id else "member"
    return _out(db, team, role)


@router.post("/{team_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    if team.owner_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner can't leave — delete the team instead",
        )
    db.query(TeamMember).filter(
        TeamMember.team_id == team_id, TeamMember.user_id == current_user.id
    ).delete()
    db.commit()
    return None


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    if team.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete")
    # Explicit cleanup (SQLite FK cascade isn't enforced here).
    db.query(Playbook).filter(Playbook.team_id == team_id).update({Playbook.team_id: None})
    db.query(TeamMember).filter(TeamMember.team_id == team_id).delete()
    db.delete(team)
    db.commit()
    return None
