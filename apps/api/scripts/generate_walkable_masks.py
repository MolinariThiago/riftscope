"""
Generate professional walkable masks for the 2D replay viewer.

For every supported CS2 map, this script:

  1. Reads ``maps/<map>.nav`` from the local Steam VPK
     (the authoritative nav mesh CS2 itself uses for bot pathing).
  2. Parses the nav file with awpy 2.0+.
  3. Projects each NavArea's 4 corners from world -> radar pixel
     coords using the per-map ``pos_x / pos_y / scale`` constants.
  4. Rasterises the polygons to a high-resolution mask image, then
     downsamples for clean anti-aliased edges.
  5. Applies a Gaussian blur for soft wall-edge falloff.
  6. Writes the result to ``apps/web/public/maps/<map>_walkable.png``.

For two-level maps (Nuke / Vertigo / Train) the script also writes
an ``_lower_walkable.png`` containing only the NavAreas whose centroid
Z is below the lower-threshold.

Why this beats radar-image-based mask generation:
  • Pixel-perfect walkable area straight from the game's nav data.
  • No dependency on radar PNG quality / colour palette.
  • Knows about clip brushes, slopes, and elevation layers.
  • Identical to the mask that big-name CS2 stats sites use.

Usage:
    "C:/.../Python312/python.exe" scripts/generate_walkable_masks.py

(Requires Python 3.12 because awpy 2.0.x does not support 3.14 yet.)

Dependencies (Python 3.12 venv or system install):
    pip install awpy>=2.0.2 vpk pillow numpy scipy
"""

from __future__ import annotations

import os
import struct
import sys
from pathlib import Path

import numpy as np
import vpk
from awpy.nav import Nav
from PIL import Image, ImageDraw, ImageFilter


# -----------------------------------------------------------------------------
# Patch awpy.nav to support CS2 nav v36 (2025+ format).
#
# v36 differs from v35 in two ways our parser cares about:
#
#   1. After the standard 16-byte file header, v36 inserts 129 extra
#      bytes (a build hash + some flags) BEFORE the corner_count.
#
#   2. Between the polygon block and the area block, v36 inserts a
#      VARIABLE-length section (138-144 bytes depending on the map).
#      v35 had a fixed 8-byte skip there. We can't hard-code an offset,
#      so we scan forward looking for the area-block signature:
#         area_count (100..polygon_count+10) followed by
#         first_area_id == 1 + valid hull_index + polygon_index < polygon_count
#      That pattern is unique enough to reliably locate the block.
#
# The polygon and area record layouts themselves are unchanged, so we
# only patch the two seams above. We do it by textually editing the
# awpy.nav source and re-executing the module in place.
# -----------------------------------------------------------------------------
V36_HEADER_EXTRA_BYTES = 129
V36_AREA_SCAN_RANGE = 1000  # max gap bytes we'll scan between polys and areas


def _patch_awpy_v36() -> None:
    nav_module = sys.modules[Nav.__module__]
    src = Path(nav_module.__file__).read_text(encoding="utf-8")

    patched = src.replace(
        "if version < 30 or version > 35:",
        "if version < 30 or version > 36:",
    )

    # 1) After ``polygons = None`` and before the polygon read, insert
    # the 129-byte v36 header-extra skip.
    polygon_marker = "            polygons = None\n            if version >= 31:"
    polygon_inject = (
        "            polygons = None\n"
        f"            if version == 36:\n"
        f"                f.read({V36_HEADER_EXTRA_BYTES})  # v36 build-hash extra\n"
        "            if version >= 31:"
    )
    patched = patched.replace(polygon_marker, polygon_inject)

    # 2) Replace the fixed unk2/unk3 skips for v36 with a pattern scan
    # that jumps to the real area-block start. The original code reads:
    #     if version >= 32: f.read(4)  # unk2
    #     if version >= 35: f.read(4)  # unk3
    #     areas = cls._read_areas(...)
    # For v36, we instead advance ``f`` to the offset where the
    # area_count + first-id-1 pattern starts, then call _read_areas.
    area_marker = (
        "            if version >= 32:\n"
        "                f.read(4)  # Skip unk2\n"
        "\n"
        "            if version >= 35:\n"
        "                f.read(4)  # Skip unk3\n"
        "\n"
        "            areas = cls._read_areas(f, polygons, version)"
    )
    area_inject = (
        "            if version == 36:\n"
        "                # Find the real area block by scanning for the\n"
        "                # area_count + first-area-id-1 pattern.\n"
        "                _pos = f.tell()\n"
        "                _polycount = len(polygons) if polygons else 0\n"
        "                _buf = f.read(" + str(V36_AREA_SCAN_RANGE) + ")\n"
        "                _found = None\n"
        "                for _i in range(len(_buf) - 30):\n"
        "                    _ac = struct.unpack_from('<I', _buf, _i)[0]\n"
        "                    if not (100 <= _ac <= _polycount + 10):\n"
        "                        continue\n"
        "                    if struct.unpack_from('<I', _buf, _i + 4)[0] != 1:\n"
        "                        continue\n"
        "                    if _buf[_i + 16] > 31:  # hull_index sanity\n"
        "                        continue\n"
        "                    _pi = struct.unpack_from('<I', _buf, _i + 17)[0]\n"
        "                    if _pi >= _polycount:\n"
        "                        continue\n"
        "                    _found = _i\n"
        "                    break\n"
        "                if _found is None:\n"
        "                    raise ValueError('v36: could not locate area block')\n"
        "                f.seek(_pos + _found)\n"
        "            elif version >= 32:\n"
        "                f.read(4)  # Skip unk2\n"
        "                if version >= 35:\n"
        "                    f.read(4)  # Skip unk3\n"
        "\n"
        "            areas = cls._read_areas(f, polygons, version)"
    )
    patched = patched.replace(area_marker, area_inject)

    if patched == src:
        return  # already patched or upstream changed
    exec(compile(patched, nav_module.__file__, "exec"), nav_module.__dict__)
    print("[patch] awpy.nav: accept v36 (header skip + area scan)")


_patch_awpy_v36()
from awpy.nav import Nav  # noqa: E402,F811  reload after patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from services.maps import list_maps, MapMetadata  # noqa: E402


CS2_MAPS_DIR = Path(
    r"C:\Program Files (x86)\Steam\steamapps\common"
    r"\Counter-Strike Global Offensive\game\csgo\maps"
)

WEB_PUBLIC_MAPS = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "maps"
NAV_CACHE_DIR = Path(__file__).resolve().parent / "_nav_cache"
NAV_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Render the mask at 2× the final resolution and downsample for clean
# anti-aliasing on polygon edges. The radar PNGs are 1024×1024, so we
# rasterise at 2048×2048 and resize down.
RENDER_SCALE = 2

# Gaussian blur radius applied AFTER downsampling, in final-resolution
# pixels. ~3 px gives a soft wall-edge transition without bleeding
# the walkable area too far past the actual geometry.
EDGE_BLUR_RADIUS_PX = 3.0


def extract_nav(map_name: str) -> Path:
    """Pull the .nav file out of the map's VPK and cache it locally."""
    cached = NAV_CACHE_DIR / f"{map_name}.nav"
    if cached.exists():
        return cached
    vpk_path = CS2_MAPS_DIR / f"{map_name}.vpk"
    if not vpk_path.exists():
        raise FileNotFoundError(
            f"CS2 map VPK not found: {vpk_path}\n"
            f"Is CS2 installed at the standard Steam path?"
        )
    pak = vpk.open(str(vpk_path))
    nav_data = pak[f"maps/{map_name}.nav"].read()
    cached.write_bytes(nav_data)
    return cached


def project(meta: MapMetadata, world_x: float, world_y: float) -> tuple[float, float]:
    """World coords -> radar pixel coords at RENDER_SCALE resolution.

    Mirrors the frontend's ``project`` helper and the formula in the
    services.maps docstring:

        radar_px = (world_x - pos_x) / scale
        radar_py = (pos_y - world_y) / scale   # Y flipped

    Then scaled up by RENDER_SCALE for super-sampling.
    """
    px = (world_x - meta.pos_x) / meta.scale * RENDER_SCALE
    py = (meta.pos_y - world_y) / meta.scale * RENDER_SCALE
    return (px, py)


def rasterise_areas(
    nav: Nav,
    meta: MapMetadata,
    z_filter: tuple[float, float] | None = None,
) -> Image.Image:
    """Rasterise every NavArea polygon, project + draw, return greyscale mask.

    ``z_filter``: optional (min_z, max_z). Areas whose CENTROID Z lies
    outside this band are skipped. Used to produce the per-floor masks
    for Nuke / Vertigo / Train.
    """
    side = meta.radar_size * RENDER_SCALE
    img = Image.new("L", (side, side), 0)
    draw = ImageDraw.Draw(img)

    drawn = 0
    for area in nav.areas.values():
        # Centroid filter for two-floor maps
        if z_filter is not None:
            cz = area.centroid.z
            if not (z_filter[0] <= cz < z_filter[1]):
                continue

        # Project each corner to radar pixel coords. ``corners`` is
        # guaranteed 4-long for CS2 v35 nav files.
        pts = [project(meta, c.x, c.y) for c in area.corners]
        draw.polygon(pts, fill=255)
        drawn += 1

    return img, drawn


def finalise_mask(big: Image.Image) -> Image.Image:
    """Downsample super-sampled mask + apply soft Gaussian edge blur.

    Returns the final 1024×1024 alpha-channel mask ready to ship as
    ``<map>_walkable.png``.
    """
    final_side = big.size[0] // RENDER_SCALE
    small = big.resize((final_side, final_side), Image.LANCZOS)
    blurred = small.filter(ImageFilter.GaussianBlur(radius=EDGE_BLUR_RADIUS_PX))

    # Convert to RGBA where RGB=white and alpha=mask value. This lets
    # Pixi consume it as an alpha mask directly (the texture's alpha
    # channel is what Pixi's masking uses).
    rgba = Image.new("RGBA", blurred.size, (255, 255, 255, 0))
    rgba.putalpha(blurred)
    return rgba


def generate_for_map(meta: MapMetadata) -> list[Path]:
    """Generate one (or two) walkable masks for the given map.

    Returns the list of generated PNG paths.
    """
    print(f"\n=== {meta.name} ({meta.display_name}) ===")
    nav_path = extract_nav(meta.name)
    nav = Nav.from_path(str(nav_path))
    print(f"  Loaded nav v{nav.version} with {len(nav.areas)} areas")

    outputs: list[Path] = []

    if meta.lower_threshold_z is None:
        # Single-floor map: render every NavArea.
        big, drawn = rasterise_areas(nav, meta, z_filter=None)
        final = finalise_mask(big)
        out_path = WEB_PUBLIC_MAPS / f"{meta.name}_walkable.png"
        final.save(out_path, optimize=True)
        print(f"  Rendered {drawn}/{len(nav.areas)} areas")
        print(f"  Wrote {out_path.name}")
        outputs.append(out_path)
    else:
        # Two-floor map: split by centroid Z.
        threshold = meta.lower_threshold_z
        total = len(nav.areas)
        upper_count = sum(1 for a in nav.areas.values() if a.centroid.z >= threshold)
        lower_count = total - upper_count

        # Heuristic: if either floor has < 15 % of the total areas,
        # the threshold doesn't produce a meaningful 2-floor split.
        # That's the case for Train where 88 % of nav is below z=-50
        # and the "upper" view is just a handful of catwalks — the
        # two radar PNGs are visually nearly identical and both
        # should use the full nav.
        #
        # Nuke (~18 % on the lower bombsite) and Vertigo (~39 %) keep
        # their per-floor splits because each floor really does have
        # distinct walkable geometry that should clip independently.
        min_floor_ratio = min(upper_count, lower_count) / max(1, total)
        if min_floor_ratio < 0.15:
            print(
                f"  Imbalanced split (upper={upper_count}, lower={lower_count}); "
                f"falling back to full-nav mask for both variants."
            )
            full_big, drawn = rasterise_areas(nav, meta, z_filter=None)
            full = finalise_mask(full_big)
            upper_path = WEB_PUBLIC_MAPS / f"{meta.name}_walkable.png"
            lower_path = WEB_PUBLIC_MAPS / f"{meta.name}_lower_walkable.png"
            full.save(upper_path, optimize=True)
            full.save(lower_path, optimize=True)
            print(f"  Both variants: {drawn}/{total} areas (full nav)")
            outputs.extend([upper_path, lower_path])
        else:
            upper_big, upper_drawn = rasterise_areas(
                nav, meta, z_filter=(threshold, float("inf"))
            )
            lower_big, lower_drawn = rasterise_areas(
                nav, meta, z_filter=(float("-inf"), threshold)
            )

            upper = finalise_mask(upper_big)
            lower = finalise_mask(lower_big)

            upper_path = WEB_PUBLIC_MAPS / f"{meta.name}_walkable.png"
            lower_path = WEB_PUBLIC_MAPS / f"{meta.name}_lower_walkable.png"
            upper.save(upper_path, optimize=True)
            lower.save(lower_path, optimize=True)

            print(f"  Upper: rendered {upper_drawn}/{total} areas -> {upper_path.name}")
            print(f"  Lower: rendered {lower_drawn}/{total} areas -> {lower_path.name}")
            outputs.extend([upper_path, lower_path])

    return outputs


def main() -> None:
    if not CS2_MAPS_DIR.exists():
        print(f"ERROR: CS2 maps dir not found: {CS2_MAPS_DIR}")
        print("Set the correct Steam install path at the top of this file.")
        sys.exit(1)

    print(f"Reading nav files from: {CS2_MAPS_DIR}")
    print(f"Writing masks to:       {WEB_PUBLIC_MAPS}")

    all_outputs: list[Path] = []
    for meta in list_maps():
        try:
            outputs = generate_for_map(meta)
            all_outputs.extend(outputs)
        except FileNotFoundError as exc:
            print(f"  SKIP {meta.name}: {exc}")
        except Exception as exc:  # noqa: BLE001
            print(f"  FAIL {meta.name}: {type(exc).__name__}: {exc}")

    print(f"\nGenerated {len(all_outputs)} walkable masks total:")
    for p in all_outputs:
        size_kb = p.stat().st_size / 1024
        print(f"  {p.name:38s} {size_kb:7.1f} KB")


if __name__ == "__main__":
    main()
