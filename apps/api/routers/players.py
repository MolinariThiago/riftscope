"""
/players endpoints — search players across all completed demos.

Phase 3: this will run against a normalized players table indexed by Steam ID.
For now we scan completed demos' analysis_data on the fly — fast enough for
small libraries, transparent to swap.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models.demo import Demo

router = APIRouter()


@router.get("/search")
async def search_players(query: str = "", db: Session = Depends(get_db)):
    q = (query or "").strip().lower()

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
                "avgRating": 0.0,
                "avgAdr": 0.0,
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
