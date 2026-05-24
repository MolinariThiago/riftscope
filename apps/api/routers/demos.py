"""
/demos endpoints — full CRUD + status polling + analysis + per-round 2D timeline.

Phase 3A wires the storage and queue backends through their factory functions
in :mod:`services.storage` and :mod:`services.queue`, so flipping the
``STORAGE_BACKEND`` / ``QUEUE_BACKEND`` env vars swaps implementations at
startup without touching this module.
"""

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from db.database import get_db
from db.models.demo import Demo
from db.models.insight import DemoInsight
from db.models.user import User
from routers.deps import get_current_user, get_current_user_optional
from schemas.demo import (
    DemoAnalysisResponse,
    DemoInsightsResponse,
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
# List
# ---------------------------------------------------------------------------
@router.get("", response_model=list[DemoSummary])
async def list_demos(db: Session = Depends(get_db)):
    demos = db.query(Demo).order_by(Demo.id.desc()).all()
    return [DemoSummary.model_validate(d.to_dict()) for d in demos]


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
@router.post("/upload", response_model=DemoUploadResponse)
async def upload_demo(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    extension = Path(file.filename).suffix.lower()
    if extension != ".dem":
        raise HTTPException(status_code=400, detail="Only .dem files are supported")

    storage = get_storage()
    _, storage_filename, abs_path = storage.save_demo(file)

    demo = Demo(
        filename=file.filename,
        storage_filename=storage_filename,
        status="queued",
        processing_progress=0,
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
        uploadedAt=demo.uploaded_at or datetime.utcnow(),
    )


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------
@router.get("/{demo_id}", response_model=DemoSummary)
async def get_demo(demo_id: int, db: Session = Depends(get_db)):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    return DemoSummary.model_validate(demo.to_dict())


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
@router.get("/{demo_id}/status", response_model=DemoStatusResponse)
async def get_demo_status(demo_id: int, db: Session = Depends(get_db)):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
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
async def get_demo_analysis(demo_id: int, db: Session = Depends(get_db)):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
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
async def get_demo_insights(demo_id: int, db: Session = Depends(get_db)):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
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
async def get_round_timeline(demo_id: int, round_number: int, db: Session = Depends(get_db)):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
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
    current_user: User | None = Depends(get_current_user_optional),
):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")

    # Ownership check is conditional:
    #   - If the demo has an owner (user_id), a logged-in user must
    #     either be that owner OR an admin.
    #   - If the demo is orphan (user_id is NULL — anonymous upload
    #     from before auth was wired) anyone, authenticated or not,
    #     can re-parse it. This unblocks dev / single-user setups
    #     that don't run the Steam OpenID flow yet.
    if demo.user_id is not None:
        if current_user is None:
            raise HTTPException(
                status_code=401,
                detail="This demo is owned by another account — sign in to reprocess.",
            )
        if demo.user_id != current_user.id and not current_user.is_admin:
            raise HTTPException(status_code=403, detail="Not authorized")

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
# Delete
# ---------------------------------------------------------------------------
@router.delete("/{demo_id}", status_code=204)
async def delete_demo(demo_id: int, db: Session = Depends(get_db)):
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    storage = get_storage()
    storage.delete_demo(demo.storage_filename)
    db.delete(demo)
    db.commit()
    return None
