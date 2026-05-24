"""
/players endpoints — search players across all completed demos.

Phase 3A queries the normalized ``demo_players`` table (indexed by Steam ID
and name) instead of scanning ``Demo.analysis_data`` blobs. The scan path is
still used as a fallback when no normalized rows exist (e.g. demos parsed
before the migration), so existing data remains searchable.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends

from db.database import get_db
from db.models.demo import Demo, DemoPlayer

router = APIRouter()


@router.get("/search")
async def search_players(query: str = "", db: Session = Depends(get_db)):
    q = (query or "").strip().lower()

    # Indexed query against the normalized table — completed demos only.
    base = (
        db.query(
            DemoPlayer.steam_id.label("steamId"),
            func.max(DemoPlayer.name).label("name"),
            func.count(DemoPlayer.id).label("demosPlayed"),
            func.sum(DemoPlayer.kills).label("totalKills"),
            func.sum(DemoPlayer.deaths).label("totalDeaths"),
            func.avg(DemoPlayer.rating).label("avgRating"),
            func.avg(DemoPlayer.adr).label("avgAdr"),
        )
        .join(Demo, Demo.id == DemoPlayer.demo_id)
        .filter(Demo.status == "completed")
    )

    if q:
        base = base.filter(func.lower(DemoPlayer.name).like(f"%{q}%"))

    rows = base.group_by(DemoPlayer.steam_id).all()

    if rows:
        results = [
            {
                "steamId": r.steamId,
                "name": r.name,
                "demosPlayed": int(r.demosPlayed or 0),
                "totalKills": int(r.totalKills or 0),
                "totalDeaths": int(r.totalDeaths or 0),
                "avgRating": round(float(r.avgRating or 0.0), 2),
                "avgAdr": round(float(r.avgAdr or 0.0), 1),
            }
            for r in rows
        ]
        results.sort(key=lambda p: p["avgRating"], reverse=True)
        return {"query": query, "results": results, "total": len(results)}

    # Fallback: scan analysis_data for legacy demos without normalized rows.
    demos = (
        db.query(Demo)
        .filter(Demo.status == "completed")
        .order_by(Demo.id.desc())
        .all()
    )

    aggregated: dict[str, dict] = {}
    for demo in demos:
        if not demo.analysis_data:
            continue
        for player in demo.analysis_data.get("players", []):
            if q and q not in player["name"].lower():
                continue
            sid = player["steamId"]
            entry = aggregated.setdefault(sid, {
                "steamId": sid,
                "name": player["name"],
                "demosPlayed": 0,
                "totalKills": 0,
                "totalDeaths": 0,
                "_ratingSum": 0.0,
                "_adrSum": 0.0,
            })
            entry["demosPlayed"] += 1
            entry["totalKills"] += player["kills"]
            entry["totalDeaths"] += player["deaths"]
            entry["_ratingSum"] += player["rating"]
            entry["_adrSum"] += player["adr"]

    results = []
    for entry in aggregated.values():
        played = entry["demosPlayed"]
        results.append({
            "steamId": entry["steamId"],
            "name": entry["name"],
            "demosPlayed": played,
            "totalKills": entry["totalKills"],
            "totalDeaths": entry["totalDeaths"],
            "avgRating": round(entry["_ratingSum"] / played, 2) if played else 0,
            "avgAdr": round(entry["_adrSum"] / played, 1) if played else 0,
        })

    results.sort(key=lambda p: p["avgRating"], reverse=True)
    return {"query": query, "results": results, "total": len(results)}
