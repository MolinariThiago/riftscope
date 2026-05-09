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
from schemas.demo import (
    DemoAnalysisResponse,
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
