"""
/demos endpoints — full CRUD + status polling + analysis + per-round 2D timeline.

Phase 3A wires the storage and queue backends through their factory functions
in :mod:`services.storage` and :mod:`services.queue`, so flipping the
``STORAGE_BACKEND`` / ``QUEUE_BACKEND`` env vars swaps implementations at
startup without touching this module.
"""

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from core.utc import utcnow_naive
from db.database import get_db
from db.models.demo import Demo
from db.models.insight import DemoInsight
from db.models.user import User
from routers.deps import get_current_user
from schemas.demo import (
    DemoAnalysisResponse,
    DemoInsightsResponse,
    DemoPresignRequest,
    DemoPresignResponse,
    DemoStatusResponse,
    DemoSummary,
    DemoUploadResponse,
    RoundTimelineResponse,
    TimelineMeta,
    TimelineRoundMeta,
)
from services.queue import get_queue
from services.storage import get_storage
from workers.demo_worker import process_demo

router = APIRouter()


# ---------------------------------------------------------------------------
# Access control helper — used by every read/write endpoint below.
#
# Visibility model (decided pre-prod): demos are PRIVATE to their owner.
# Admins see everything. Legacy demos with ``user_id IS NULL`` were
# uploaded before auth was enforced — they're treated as admin-only so
# the operator can still recover / delete them, but regular users can't
# enumerate or read them.
# ---------------------------------------------------------------------------
def _check_demo_access(demo: Demo, user: User) -> None:
    """Raise 403 unless ``user`` can read/modify ``demo``.

    Rules:
      - Admins bypass every check.
      - Owners (``demo.user_id == user.id``) can read + modify their own.
      - Anyone else — including the orphan-demo case (``user_id IS NULL``,
        legacy uploads) — gets 403. Returning 404 would also be valid but
        revealing "exists but you can't see it" is preferable for an
        operator chasing a bug than silent 404s.
    """
    if user.is_admin:
        return
    if demo.user_id is not None and demo.user_id == user.id:
        return
    raise HTTPException(status_code=403, detail="Not authorized to access this demo")


# ---------------------------------------------------------------------------
# List — owner-scoped (admin bypass)
# ---------------------------------------------------------------------------
@router.get("", response_model=list[DemoSummary])
async def list_demos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the caller's own demos. Admins get the full feed.

    Anonymous callers receive 401 from ``get_current_user`` before
    reaching this function.
    """
    q = db.query(Demo).order_by(Demo.id.desc())
    if not current_user.is_admin:
        q = q.filter(Demo.user_id == current_user.id)
    demos = q.all()
    return [DemoSummary.model_validate(d.to_dict()) for d in demos]


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
@router.post("/upload", response_model=DemoUploadResponse)
async def upload_demo(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    extension = Path(file.filename).suffix.lower()
    if extension != ".dem":
        raise HTTPException(status_code=400, detail="Only .dem files are supported")

    storage = get_storage()
    _, storage_filename, abs_path = storage.save_demo(file)

    # Stamp ownership at upload time so the access checks downstream
    # (read / reprocess / delete) can authoritatively know who can touch
    # this demo. Without ``user_id`` the demo would become an orphan and
    # only admins could see it.
    demo = Demo(
        filename=file.filename,
        storage_filename=storage_filename,
        status="queued",
        processing_progress=0,
        user_id=current_user.id,
    )
    db.add(demo)
    db.commit()
    db.refresh(demo)

    queue = get_queue()
    queue.enqueue(background_tasks, process_demo, demo.id, abs_path)

    return DemoUploadResponse(
        id=str(demo.id),
        filename=demo.filename,
        status="queued",
        uploadedAt=demo.uploaded_at or utcnow_naive(),
    )


# ---------------------------------------------------------------------------
# Direct-to-storage upload (presigned PUT) — Step 1: presign
#
# The browser uploads the .dem straight to R2 with the URL we hand back,
# so a 300-500 MB demo never streams through (and never times out on) the
# API container. After the PUT lands, the client calls /finalize below.
#
# Falls back to ``mode="direct"`` when the active storage backend can't
# presign (local-filesystem dev) — the client then uses POST /demos/upload.
# ---------------------------------------------------------------------------
_UPLOAD_CONTENT_TYPE = "application/octet-stream"


@router.post("/presign", response_model=DemoPresignResponse)
async def presign_upload(
    body: DemoPresignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if Path(body.filename).suffix.lower() != ".dem":
        raise HTTPException(status_code=400, detail="Only .dem files are supported")

    storage = get_storage()
    presign = getattr(storage, "generate_presigned_put", None)
    new_key = getattr(storage, "new_object_key", None)
    supports = getattr(storage, "supports_presigned_upload", lambda: False)()
    if not (supports and presign and new_key):
        # Local FS dev: tell the browser to use the legacy multipart POST.
        return DemoPresignResponse(mode="direct")

    _, storage_filename, _ = new_key(body.filename)
    url = presign(storage_filename, content_type=_UPLOAD_CONTENT_TYPE)
    if not url:
        raise HTTPException(status_code=502, detail="Could not presign upload")

    # Register the demo up-front so finalize can flip it to "queued".
    # Status "uploaded" = slot reserved, bytes en route to storage.
    demo = Demo(
        filename=body.filename,
        storage_filename=storage_filename,
        status="uploaded",
        processing_progress=0,
        user_id=current_user.id,
    )
    db.add(demo)
    db.commit()
    db.refresh(demo)

    return DemoPresignResponse(
        mode="presigned",
        id=str(demo.id),
        url=url,
        uploadHeaders={"Content-Type": _UPLOAD_CONTENT_TYPE},
    )


# ---------------------------------------------------------------------------
# Direct-to-storage upload — Step 2: finalize
#
# Called after the browser's PUT to R2 succeeds. We confirm the object is
# really in the bucket (so a half-failed PUT can't enqueue a phantom job),
# then flip the demo to "queued" and kick off the parse pipeline.
# ---------------------------------------------------------------------------
@router.post("/{demo_id}/finalize", response_model=DemoStatusResponse)
async def finalize_upload(
    demo_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    _check_demo_access(demo, current_user)

    if demo.status not in ("uploaded", "failed"):
        # Already queued / processing / completed — idempotent no-op.
        return DemoStatusResponse(
            id=str(demo.id),
            status=demo.status,
            progress=demo.processing_progress,
            errorMessage=demo.error_message,
        )

    storage = get_storage()
    head = getattr(storage, "head", None)
    if head is not None and head(demo.storage_filename) is None:
        # The PUT never landed — don't enqueue a job that will only fail
        # on download. Mark it failed so the UI stops spinning.
        demo.status = "failed"
        demo.error_message = "Upload did not complete — file not found in storage."
        db.commit()
        raise HTTPException(status_code=400, detail="Upload not found in storage")

    bucket = getattr(storage, "bucket", None)
    abs_path = (
        f"s3://{bucket}/{demo.storage_filename}"
        if bucket
        else demo.storage_filename
    )

    demo.status = "queued"
    demo.processing_progress = 0
    demo.error_message = None
    db.commit()
    db.refresh(demo)

    queue = get_queue()
    queue.enqueue(background_tasks, process_demo, demo.id, abs_path)

    return DemoStatusResponse(
        id=str(demo.id),
        status="queued",
        progress=0,
        errorMessage=None,
    )


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------
@router.get("/{demo_id}", response_model=DemoSummary)
async def get_demo(
    demo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    _check_demo_access(demo, current_user)
    return DemoSummary.model_validate(demo.to_dict())


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
@router.get("/{demo_id}/status", response_model=DemoStatusResponse)
async def get_demo_status(
    demo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    _check_demo_access(demo, current_user)
    return DemoStatusResponse(
        id=str(demo.id),
        status=demo.status,
        progress=demo.processing_progress,
        errorMessage=demo.error_message,
    )


# ---------------------------------------------------------------------------
# Analysis (without heavy timeline frames — just metadata)
# ---------------------------------------------------------------------------
@router.get("/{demo_id}/analysis", response_model=DemoAnalysisResponse)
async def get_demo_analysis(
    demo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    _check_demo_access(demo, current_user)
    if demo.status != "completed" or not demo.analysis_data:
        raise HTTPException(status_code=409, detail=f"Demo is not ready (status={demo.status})")

    timeline = demo.analysis_data.get("timeline", {"fps": 10, "rounds": {}})
    timeline_meta = TimelineMeta(
        fps=timeline.get("fps", 10),
        rounds=[
            TimelineRoundMeta(
                roundNumber=int(rnum),
                durationSeconds=rdata["durationSeconds"],
                frameCount=rdata["frameCount"],
                eventCount=len(rdata["events"]),
                # Pre-existing demos parsed before the freeze/post
                # extension landed won't have these keys — default
                # to 0 / total duration so the frontend just shows
                # the whole timeline as "play" (legacy behaviour).
                playStartT=float(rdata.get("playStartT", 0.0)),
                playEndT=float(
                    rdata.get("playEndT", rdata["durationSeconds"])
                ),
            )
            for rnum, rdata in sorted(
                timeline.get("rounds", {}).items(), key=lambda kv: int(kv[0])
            )
        ],
    )

    summary = DemoSummary.model_validate(demo.to_dict())
    return DemoAnalysisResponse(
        demo=summary,
        players=demo.analysis_data.get("players", []),
        rounds=demo.analysis_data.get("rounds", []),
        kills=demo.analysis_data.get("kills", []),
        clutches=demo.analysis_data.get("clutches", []),
        economy=demo.analysis_data.get("economy", []),
        heatmapPoints=demo.analysis_data.get("heatmapPoints", []),
        timeline=timeline_meta,
    )


# ---------------------------------------------------------------------------
# Insights — pre-computed heuristic analytics (served from cache)
# ---------------------------------------------------------------------------
@router.get("/{demo_id}/insights", response_model=DemoInsightsResponse)
async def get_demo_insights(
    demo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    _check_demo_access(demo, current_user)
    if demo.status != "completed":
        raise HTTPException(status_code=409, detail=f"Demo is not ready (status={demo.status})")
    row = db.query(DemoInsight).filter(DemoInsight.demo_id == demo_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Insights not computed yet — re-run processing.")
    return DemoInsightsResponse(
        engineVersion=row.engine_version,
        summary=row.summary or {},
        rounds=row.rounds or [],
        players=row.players or [],
        heatmap=row.heatmap or {},
        computedAt=row.computed_at,
    )


# ---------------------------------------------------------------------------
# Per-round 2D timeline (heavy: frames + events for the replay viewer)
# ---------------------------------------------------------------------------
@router.get("/{demo_id}/timeline/{round_number}", response_model=RoundTimelineResponse)
async def get_round_timeline(
    demo_id: int,
    round_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    _check_demo_access(demo, current_user)
    if demo.status != "completed" or not demo.analysis_data:
        raise HTTPException(status_code=409, detail=f"Demo is not ready (status={demo.status})")

    timeline = demo.analysis_data.get("timeline", {})
    rounds = timeline.get("rounds", {})
    rdata = rounds.get(str(round_number))
    if not rdata:
        raise HTTPException(status_code=404, detail=f"Round {round_number} not found")

    return RoundTimelineResponse(
        roundNumber=round_number,
        fps=timeline.get("fps", 10),
        durationSeconds=rdata["durationSeconds"],
        frames=rdata["frames"],
        events=rdata["events"],
        # ``loadouts`` is the per-player snapshot the parser takes
        # at ~5 s into each round (weapon + armor + helmet + kit +
        # money + grenades). The endpoint was returning the round
        # timeline WITHOUT this field, so every front-end loadout
        # lookup returned ``undefined`` and the team panel rendered
        # placeholder slots / "—" for every player. Wiring it back
        # through restores money / armor / kit / grenade counts.
        loadouts=rdata.get("loadouts", {}),
        # Bounds of the play portion inside the extended freeze +
        # play + post timeline. Frontend uses these to clamp
        # playback when the user toggles off the freeze/post view.
        playStartT=float(rdata.get("playStartT", 0.0)),
        playEndT=float(rdata.get("playEndT", rdata["durationSeconds"])),
    )


# ---------------------------------------------------------------------------
# Reprocess — re-runs the worker on an existing demo without re-uploading.
# Use case: parser was upgraded (new fields, bug fixes) and you want to
# refresh cached analysis. Wipes the previous results via the normal
# idempotent process_demo path.
# ---------------------------------------------------------------------------
@router.post("/{demo_id}/reprocess", response_model=DemoStatusResponse)
async def reprocess_demo(
    demo_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")

    # Same private-demo rules as read endpoints — only the owner (or an
    # admin) can re-trigger parsing. Orphan demos with ``user_id IS NULL``
    # are admin-only recovery territory; anonymous reprocesses were a
    # pre-auth shortcut that no longer fits the production model.
    _check_demo_access(demo, current_user)

    if demo.status == "queued" or demo.status == "processing":
        raise HTTPException(
            status_code=409,
            detail=f"Demo already in flight (status={demo.status}). Wait for it to finish.",
        )

    storage = get_storage()
    # Reconstruct the abs_path the worker expects. For S3 we use the
    # ``s3://bucket/key`` URI that the worker's _resolve_local_demo_path
    # already knows how to download; for local we just hand back the path.
    bucket = getattr(storage, "bucket", None)
    if bucket:
        abs_path = f"s3://{bucket}/{demo.storage_filename}"
    else:
        abs_path = str(storage.get_path(demo.storage_filename))

    # Flip status FIRST so polling clients see "queued" immediately, then
    # enqueue the heavy work.
    demo.status = "queued"
    demo.processing_progress = 0
    demo.error_message = None
    demo.processed_at = None
    db.commit()
    db.refresh(demo)

    queue = get_queue()
    queue.enqueue(background_tasks, process_demo, demo.id, abs_path)

    return DemoStatusResponse(
        id=str(demo.id),
        status=demo.status,
        progress=0,
        errorMessage=None,
    )


# ---------------------------------------------------------------------------
# Delete — owner-only, admin bypass.
# ---------------------------------------------------------------------------
@router.delete("/{demo_id}", status_code=204)
async def delete_demo(
    demo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hard-delete a demo. Only the owner (or an admin) can do this.

    Previously this endpoint had NO auth at all — any visitor could
    enumerate demo IDs and wipe them. The check now matches the rest
    of the read endpoints in this module.
    """
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    _check_demo_access(demo, current_user)
    storage = get_storage()
    storage.delete_demo(demo.storage_filename)
    db.delete(demo)
    db.commit()
    return None
