"""
Generate procedural radar SVGs from each map's metadata.

These aren't 1:1 with CS2's real radars — they're stylized sketches that
approximate site / spawn / callout layout based on the per-map anchor
coordinates. Way better than blank placeholders, and they update
automatically if you tweak the metadata in services/maps.py.

Drop SimpleRadar SVGs in apps/web/public/maps/ to override.

Usage:
    cd apps/api
    .\\.venv\\Scripts\\python.exe scripts/generate_radars.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add apps/api to sys.path so imports work when running this script directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.maps import MapMetadata, list_maps  # noqa: E402


OUT_DIR = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "maps"
OUT_DIR.mkdir(parents=True, exist_ok=True)

RADAR_SIZE = 1024


def project(world_x: float, world_y: float, m: MapMetadata) -> tuple[float, float]:
    return ((world_x - m.pos_x) / m.scale, (m.pos_y - world_y) / m.scale)


def project_radius(world_units: float, m: MapMetadata) -> float:
    return world_units / m.scale


def build_svg(m: MapMetadata, lower: bool = False) -> str:
    """Build a procedural radar SVG that hints at the map's layout."""

    # Project anchors to radar pixels
    site_a = project(m.site_a[0], m.site_a[1], m)
    site_b = project(m.site_b[0], m.site_b[1], m)
    spawn_ct = project(m.spawn_ct[0], m.spawn_ct[1], m)
    spawn_tt = project(m.spawn_tt[0], m.spawn_tt[1], m)

    # Per-map accent — gives each map a distinctive tint
    accents = {
        "de_mirage":  ("#c8a06e", "#5a4a2e"),  # sand
        "de_inferno": ("#d4724a", "#4a2818"),  # red brick
        "de_dust2":   ("#d4a85a", "#5a4020"),  # desert
        "de_nuke":    ("#5a8aa0", "#1f3540"),  # industrial
        "de_ancient": ("#5a8a5a", "#1f3a1f"),  # jungle
        "de_anubis":  ("#a08854", "#3a3020"),  # egypt
        "de_vertigo": ("#7a6a8a", "#2a253a"),  # construction
        "de_overpass":("#8a7a5a", "#302820"),  # urban
    }
    accent, accent_dark = accents.get(m.name, ("#4a5560", "#1a2030"))

    parts: list[str] = []
    parts.append(f'<?xml version="1.0" encoding="UTF-8"?>')
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {RADAR_SIZE} {RADAR_SIZE}" '
        f'width="{RADAR_SIZE}" height="{RADAR_SIZE}">'
    )

    # Defs
    parts.append(f"""<defs>
  <radialGradient id="bg-grad" cx="50%" cy="50%" r="62%">
    <stop offset="0%" stop-color="#0f1726" stop-opacity="0.95"/>
    <stop offset="100%" stop-color="#06080f" stop-opacity="1"/>
  </radialGradient>
  <linearGradient id="building" x1="0" x2="0" y1="0" y2="1">
    <stop offset="0%" stop-color="{accent}" stop-opacity="0.18"/>
    <stop offset="100%" stop-color="{accent_dark}" stop-opacity="0.32"/>
  </linearGradient>
  <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
    <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1a2030" stroke-width="0.7"/>
  </pattern>
  <filter id="soft-glow" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation="3"/>
  </filter>
</defs>""")

    # Background
    parts.append(f'<rect width="{RADAR_SIZE}" height="{RADAR_SIZE}" fill="url(#bg-grad)"/>')
    parts.append(f'<rect width="{RADAR_SIZE}" height="{RADAR_SIZE}" fill="url(#grid)"/>')

    # Outer playable boundary (rounded)
    parts.append(
        f'<rect x="48" y="48" width="{RADAR_SIZE - 96}" height="{RADAR_SIZE - 96}" '
        f'fill="none" stroke="{accent}" stroke-opacity="0.18" stroke-width="2" '
        f'stroke-dasharray="6 8" rx="20"/>'
    )

    # Faint connecting routes between callouts (sketches the map flow)
    callout_pts = [project(c.x, c.y, m) for c in m.callouts]
    # Sort callouts by some heuristic to draw smooth-ish flow
    if len(callout_pts) > 1:
        # Simple TSP-ish: nearest-neighbor from spawn_ct
        ordered = []
        remaining = list(callout_pts)
        cur = spawn_ct
        while remaining:
            nxt = min(remaining, key=lambda p: (p[0] - cur[0]) ** 2 + (p[1] - cur[1]) ** 2)
            ordered.append(nxt)
            remaining.remove(nxt)
            cur = nxt
        path_d = "M " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in ordered)
        parts.append(
            f'<path d="{path_d}" fill="none" stroke="{accent}" '
            f'stroke-opacity="0.08" stroke-width="3" stroke-linecap="round"/>'
        )

    # Site footprints (large, distinctive)
    site_radius = project_radius(420, m)
    parts.append(_site_block(site_a, site_radius, "A", accent, lower=lower))
    parts.append(_site_block(site_b, site_radius, "B", accent, lower=lower))

    # Spawn footprints
    spawn_r = project_radius(360, m)
    parts.append(
        f'<rect x="{spawn_ct[0] - spawn_r:.1f}" y="{spawn_ct[1] - spawn_r:.1f}" '
        f'width="{spawn_r*2:.1f}" height="{spawn_r*2:.1f}" fill="hsl(213 100% 65% / 0.05)" '
        f'stroke="hsl(213 100% 65% / 0.25)" stroke-width="1.5" stroke-dasharray="4 3" rx="6"/>'
    )
    parts.append(
        f'<text x="{spawn_ct[0]:.1f}" y="{spawn_ct[1]:.1f}" text-anchor="middle" '
        f'dominant-baseline="middle" fill="hsl(213 100% 65% / 0.55)" font-size="13" '
        f'font-family="monospace" letter-spacing="1.5">CT</text>'
    )
    parts.append(
        f'<rect x="{spawn_tt[0] - spawn_r:.1f}" y="{spawn_tt[1] - spawn_r:.1f}" '
        f'width="{spawn_r*2:.1f}" height="{spawn_r*2:.1f}" fill="hsl(33 100% 64% / 0.05)" '
        f'stroke="hsl(33 100% 64% / 0.25)" stroke-width="1.5" stroke-dasharray="4 3" rx="6"/>'
    )
    parts.append(
        f'<text x="{spawn_tt[0]:.1f}" y="{spawn_tt[1]:.1f}" text-anchor="middle" '
        f'dominant-baseline="middle" fill="hsl(33 100% 64% / 0.55)" font-size="13" '
        f'font-family="monospace" letter-spacing="1.5">T</text>'
    )

    # Map name + lower marker
    suffix = " · LOWER" if lower else ""
    parts.append(
        f'<text x="{RADAR_SIZE // 2}" y="44" text-anchor="middle" '
        f'fill="{accent}" fill-opacity="0.55" font-size="14" font-family="monospace" '
        f'letter-spacing="3" font-weight="700">{m.display_name.upper()}{suffix}</text>'
    )

    parts.append('</svg>')
    return "\n".join(parts)


def _site_block(pos: tuple[float, float], r: float, label: str, accent: str, lower: bool) -> str:
    cx, cy = pos
    color = "hsl(213 100% 65%)" if label == "A" else "hsl(280 80% 70%)"
    return f"""
<g>
  <rect x="{cx - r:.1f}" y="{cy - r:.1f}" width="{r * 2:.1f}" height="{r * 2:.1f}"
    fill="url(#building)" stroke="{accent}" stroke-opacity="0.4"
    stroke-width="2" stroke-dasharray="4 3" rx="10"/>
  <text x="{cx:.1f}" y="{cy + 7:.1f}" text-anchor="middle" font-size="36"
    font-weight="700" fill="{color}" fill-opacity="0.32"
    font-family="system-ui, sans-serif">{label}</text>
</g>"""


def main() -> None:
    maps = list_maps()
    written = []
    for m in maps:
        # Upper / default radar
        path = OUT_DIR / f"{m.name}.svg"
        path.write_text(build_svg(m, lower=False), encoding="utf-8")
        written.append(path.name)

        # Lower-level variant for two-floor maps
        if m.radar_url_lower:
            lower_name = m.radar_url_lower.lstrip("/").split("/")[-1]
            (OUT_DIR / lower_name).write_text(
                build_svg(m, lower=True), encoding="utf-8"
            )
            written.append(lower_name)

    print(f"wrote {len(written)} radar SVGs to {OUT_DIR}:")
    for n in written:
        print("  -", n)


if __name__ == "__main__":
    main()
