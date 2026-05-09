"""
/maps endpoints — per-CS2-map metadata used by the 2D replay viewer to draw
sites, callouts and the world->canvas projection.
"""

from fastapi import APIRouter, HTTPException

from schemas.demo import MapMetadataResponse
from services.maps import get_map, list_maps

router = APIRouter()


@router.get("", response_model=list[MapMetadataResponse])
async def list_supported_maps():
    return [MapMetadataResponse.model_validate(m.to_dict()) for m in list_maps()]


@router.get("/{map_name}", response_model=MapMetadataResponse)
async def get_map_metadata(map_name: str):
    m = get_map(map_name)
    if not m:
        raise HTTPException(status_code=404, detail=f"Map '{map_name}' not supported")
    return MapMetadataResponse.model_validate(m.to_dict())
