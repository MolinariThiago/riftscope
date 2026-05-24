"""
Map metadata service — per-CS2-map geometry used by the parser, the API, and
the 2D replay viewer.

Phase 3A.2 — radar PNGs are the **real CS2 overviews** (1024×1024) sourced
from akiver/cs-demo-manager. Projection constants ``pos_x / pos_y / scale``
are the official Valve values (verified against the same project's
``default-maps.ts``). World→radar pixel transform:

    radar_px_x = (world_x - pos_x) / scale
    radar_px_y = (pos_y - world_y) / scale     # Y inverted — north = top

Two-level maps (Nuke, Vertigo, Train) ship a ``radar_url_lower`` plus a
``lower_threshold_z`` so the viewer can switch floors based on the active
player's elevation. Until per-frame Z lands (Phase 3B), the viewer's
manual Upper/Lower toggle uses the same metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


RADAR_SIZE = 1024  # All overview PNGs are 1024×1024


@dataclass
class Callout:
    name: str
    x: float
    y: float
    radius: float = 220.0


@dataclass
class MapPath:
    """A canonical walking corridor on a map.

    ``waypoints`` is an ordered list of (x, y) world coordinates. The stub
    parser interpolates along these so generated player paths follow the
    real walkable corridors instead of cutting through walls.
    """

    team: str          # "ct" | "tt"
    target: str        # "A" | "B"
    waypoints: list[tuple[float, float]]


@dataclass
class MapMetadata:
    name: str
    display_name: str

    # Radar projection (Valve CS2 overview <map>.txt constants).
    pos_x: float
    pos_y: float
    scale: float
    radar_size: int = RADAR_SIZE

    # Asset URLs — relative paths the frontend serves from /maps/<name>.png.
    radar_url: str = ""
    radar_url_lower: str | None = None
    lower_threshold_z: float | None = None

    # World bounds — derived from the radar projection.
    world_min_x: float = 0.0
    world_max_x: float = 0.0
    world_min_y: float = 0.0
    world_max_y: float = 0.0

    # Site / spawn / callout anchors in WORLD coordinates.
    site_a: tuple[float, float] = (0.0, 0.0)
    site_b: tuple[float, float] = (0.0, 0.0)
    spawn_ct: tuple[float, float] = (0.0, 0.0)
    spawn_tt: tuple[float, float] = (0.0, 0.0)
    callouts: list[Callout] = field(default_factory=list)

    # Hand-curated walking corridors (used by the stub parser).
    # Real demos provide their own coordinates; this only matters until 3B.
    paths: list[MapPath] = field(default_factory=list)

    def __post_init__(self) -> None:
        span = self.radar_size * self.scale
        self.world_min_x = self.pos_x
        self.world_max_x = self.pos_x + span
        self.world_max_y = self.pos_y
        self.world_min_y = self.pos_y - span
        if not self.radar_url:
            self.radar_url = f"/maps/{self.name}.png"

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["site_a"] = list(self.site_a)
        d["site_b"] = list(self.site_b)
        d["spawn_ct"] = list(self.spawn_ct)
        d["spawn_tt"] = list(self.spawn_tt)
        # Paths are internal; don't ship them to the frontend.
        d.pop("paths", None)
        return d

    def find_paths(self, team: str, target: str) -> list[MapPath]:
        return [p for p in self.paths if p.team == team and p.target == target]


# ---------------------------------------------------------------------------
# CS2 active duty + Train. Constants verified against
# https://github.com/akiver/cs-demo-manager/blob/main/src/node/database/maps/default-maps.ts
# ---------------------------------------------------------------------------

_MAPS: dict[str, MapMetadata] = {
    "de_mirage": MapMetadata(
        name="de_mirage",
        display_name="Mirage",
        pos_x=-3230, pos_y=1713, scale=5.00,
        site_a=(150, -1900),
        site_b=(-1900, 0),
        spawn_ct=(1230, 470),
        spawn_tt=(-1750, -1340),
        callouts=[
            Callout("A site", 150, -1900, 260),
            Callout("Palace", 1100, -1700, 200),
            Callout("Ramp", -700, -2400, 220),
            Callout("Tetris", 600, -1300, 180),
            Callout("Connector", -350, -1000, 180),
            Callout("Mid", -350, 0, 220),
            Callout("Top mid", -150, 700, 200),
            Callout("Catwalk", 700, -1100, 180),
            Callout("B site", -1900, 0, 260),
            Callout("Apps", -1900, -800, 220),
        ],
        paths=[
            # T → A via ramp
            MapPath("tt", "A", [(-1750, -1340), (-1300, -2000), (-700, -2400), (200, -2200), (300, -1900)]),
            # T → A via palace (long route through underpass + palace)
            MapPath("tt", "A", [(-1750, -1340), (-1100, -1500), (-300, -1700), (700, -1700), (1100, -1700), (300, -1850)]),
            # T → A via mid → connector
            MapPath("tt", "A", [(-1750, -1340), (-700, -700), (-350, 0), (-150, 700), (-350, -300), (-200, -1100), (200, -1900)]),
            # T → B via apps (typical fast B execute)
            MapPath("tt", "B", [(-1750, -1340), (-1900, -800), (-1900, -300), (-1900, 100), (-1900, 0)]),
            # T → B via mid → connector → underpass
            MapPath("tt", "B", [(-1750, -1340), (-700, -700), (-350, 0), (-350, -300), (-1100, 0), (-1900, 100)]),
            # CT → A defend (spawn → A site)
            MapPath("ct", "A", [(1230, 470), (1100, -100), (1000, -800), (500, -1500), (200, -1900)]),
            # CT → A palace defense
            MapPath("ct", "A", [(1230, 470), (1450, -300), (1450, -1100), (1100, -1700), (300, -1850)]),
            # CT → B defend via connector
            MapPath("ct", "B", [(1230, 470), (300, 300), (-350, 0), (-1100, 0), (-1900, 0)]),
            # CT → B rotate via apps
            MapPath("ct", "B", [(1230, 470), (200, 500), (-700, 200), (-1500, 200), (-1900, 0)]),
        ],
    ),
    "de_inferno": MapMetadata(
        name="de_inferno",
        display_name="Inferno",
        pos_x=-2087, pos_y=3870, scale=4.90,
        site_a=(1900, 380),
        site_b=(-1500, 600),
        spawn_ct=(2400, 1900),
        spawn_tt=(-1700, 100),
        callouts=[
            Callout("A site", 1900, 380, 260),
            Callout("Pit", 2300, 50, 200),
            Callout("Library", 1750, 850, 180),
            Callout("Apartments", 1500, 1500, 220),
            Callout("Mid", 800, 700, 200),
            Callout("Banana", -300, 800, 240),
            Callout("Car", -700, 700, 160),
            Callout("B site", -1500, 600, 260),
            Callout("Construction", -1700, 1100, 180),
        ],
        paths=[
            # T → A via apartments
            MapPath("tt", "A", [(-1700, 100), (-100, 800), (700, 1100), (1300, 1400), (1700, 1100), (1900, 600), (1900, 380)]),
            # T → A via mid → short
            MapPath("tt", "A", [(-1700, 100), (-300, 400), (500, 600), (1100, 700), (1700, 500), (1900, 380)]),
            # T → B via banana
            MapPath("tt", "B", [(-1700, 100), (-1100, 400), (-300, 800), (-700, 700), (-1300, 600), (-1500, 600)]),
            # T → B via construction
            MapPath("tt", "B", [(-1700, 100), (-1700, 600), (-1700, 1100), (-1500, 800), (-1500, 600)]),
            # CT → A defend
            MapPath("ct", "A", [(2400, 1900), (2200, 1100), (2200, 400), (2300, 50), (1900, 380)]),
            # CT → A library
            MapPath("ct", "A", [(2400, 1900), (1750, 1300), (1750, 850), (1900, 380)]),
            # CT → B defend via banana
            MapPath("ct", "B", [(2400, 1900), (1300, 1400), (300, 1100), (-300, 800), (-1500, 600)]),
            # CT → B rotate via mid
            MapPath("ct", "B", [(2400, 1900), (800, 1200), (-100, 800), (-1100, 600), (-1500, 600)]),
        ],
    ),
    "de_dust2": MapMetadata(
        name="de_dust2",
        display_name="Dust II",
        pos_x=-2476, pos_y=3239, scale=4.40,
        site_a=(1250, 2520),
        site_b=(-1600, 2400),
        spawn_ct=(150, 2400),
        spawn_tt=(-700, 0),
        callouts=[
            Callout("A site", 1250, 2520, 260),
            Callout("Long", 1300, 1200, 240),
            Callout("Long doors", 800, 1300, 160),
            Callout("Pit", 1700, 2200, 180),
            Callout("A short", 600, 2200, 200),
            Callout("Catwalk", 100, 1800, 180),
            Callout("Mid", -300, 1100, 220),
            Callout("Mid doors", -100, 600, 160),
            Callout("Tunnels (T)", -1100, 600, 220),
            Callout("Lower tunnel", -1500, 1200, 200),
            Callout("Upper tunnel", -1300, 1900, 200),
            Callout("B site", -1600, 2400, 260),
        ],
        paths=[
            # T → A long
            MapPath("tt", "A", [(-700, 0), (-200, 200), (700, 800), (1100, 1200), (1300, 1500), (1300, 2200), (1250, 2520)]),
            # T → A catwalk
            MapPath("tt", "A", [(-700, 0), (-300, 600), (-100, 1100), (100, 1800), (600, 2200), (1000, 2400), (1250, 2520)]),
            # T → A mid (rare)
            MapPath("tt", "A", [(-700, 0), (-100, 600), (-300, 1100), (100, 1800), (1250, 2520)]),
            # T → B tunnels
            MapPath("tt", "B", [(-700, 0), (-1100, 200), (-1500, 600), (-1500, 1200), (-1300, 1900), (-1600, 2400)]),
            # T → B lower → upper tunnel
            MapPath("tt", "B", [(-700, 0), (-1100, 600), (-1500, 1200), (-1300, 1900), (-1600, 2400)]),
            # CT → A long defend
            MapPath("ct", "A", [(150, 2400), (700, 2300), (1300, 2100), (1700, 2200), (1250, 2520)]),
            # CT → A short
            MapPath("ct", "A", [(150, 2400), (600, 2200), (1100, 2300), (1250, 2520)]),
            # CT → B tunnels defend
            MapPath("ct", "B", [(150, 2400), (-700, 2400), (-1300, 2300), (-1600, 2400)]),
            # CT → B rotate via tunnels
            MapPath("ct", "B", [(150, 2400), (-300, 1800), (-1300, 1900), (-1600, 2400)]),
        ],
    ),
    "de_nuke": MapMetadata(
        name="de_nuke",
        display_name="Nuke",
        pos_x=-3453, pos_y=2887, scale=7.00,
        radar_url_lower="/maps/de_nuke_lower.png",
        lower_threshold_z=-495.0,
        site_a=(450, -750),
        site_b=(450, -1100),
        spawn_ct=(2300, -650),
        spawn_tt=(-2300, -300),
        callouts=[
            Callout("A site (top)", 450, -750, 260),
            Callout("Heaven", 250, -300, 180),
            Callout("Squeaky", 750, -1500, 180),
            Callout("Outside", 1700, -1100, 240),
            Callout("Silo", 1900, 200, 200),
            Callout("B site (lower)", 450, -1100, 260),
            Callout("Vents", 100, -1100, 160),
            Callout("Ramp", -500, -200, 220),
            Callout("Lobby", -1450, -200, 220),
        ],
        paths=[
            # T → A via outside
            MapPath("tt", "A", [(-2300, -300), (-1450, -200), (-500, -200), (200, -400), (450, -750)]),
            # T → A via squeaky/secret
            MapPath("tt", "A", [(-2300, -300), (-1450, -200), (200, -1100), (750, -1500), (450, -750)]),
            # T → B via lower (ramp)
            MapPath("tt", "B", [(-2300, -300), (-1450, -200), (-500, -200), (-200, -700), (200, -1100), (450, -1100)]),
            # T → B via outside
            MapPath("tt", "B", [(-2300, -300), (-1700, -800), (-500, -1100), (450, -1100)]),
            # CT → A defend (heaven hold)
            MapPath("ct", "A", [(2300, -650), (1700, -700), (1100, -700), (450, -500), (450, -750)]),
            # CT → A via ramp
            MapPath("ct", "A", [(2300, -650), (1100, -300), (250, -300), (450, -750)]),
            # CT → B defend (lower)
            MapPath("ct", "B", [(2300, -650), (1700, -1100), (1100, -1100), (450, -1100)]),
            # CT → B via vents
            MapPath("ct", "B", [(2300, -650), (1100, -300), (450, -500), (100, -1100), (450, -1100)]),
        ],
    ),
    "de_ancient": MapMetadata(
        name="de_ancient",
        display_name="Ancient",
        pos_x=-2953, pos_y=2164, scale=5.00,
        site_a=(-1700, 200),
        site_b=(900, -750),
        spawn_ct=(-2200, -1450),
        spawn_tt=(1850, 1300),
        callouts=[
            Callout("A site", -1700, 200, 260),
            Callout("Donut", -2150, 600, 180),
            Callout("Heaven", -1300, 750, 160),
            Callout("Mid", 0, 200, 200),
            Callout("Cave", 700, 600, 180),
            Callout("Temple", -300, -300, 180),
            Callout("B site", 900, -750, 260),
            Callout("Tunnels", 600, -1300, 200),
        ],
        paths=[
            # T → A long
            MapPath("tt", "A", [(1850, 1300), (1100, 1100), (300, 800), (-300, 600), (-1100, 500), (-1700, 200)]),
            # T → A mid
            MapPath("tt", "A", [(1850, 1300), (700, 600), (0, 200), (-1100, 500), (-1700, 200)]),
            # T → B tunnels
            MapPath("tt", "B", [(1850, 1300), (1500, 600), (1100, -200), (700, -800), (900, -750)]),
            # T → B mid → temple
            MapPath("tt", "B", [(1850, 1300), (700, 600), (-300, -300), (300, -800), (900, -750)]),
            # CT → A defend (donut)
            MapPath("ct", "A", [(-2200, -1450), (-2150, -500), (-2150, 600), (-1700, 200)]),
            # CT → A heaven
            MapPath("ct", "A", [(-2200, -1450), (-1500, -200), (-1300, 750), (-1700, 200)]),
            # CT → B defend
            MapPath("ct", "B", [(-2200, -1450), (-1100, -1300), (0, -1100), (700, -800), (900, -750)]),
            # CT → B mid rotate
            MapPath("ct", "B", [(-2200, -1450), (-1100, -200), (0, 200), (700, -100), (900, -750)]),
        ],
    ),
    "de_anubis": MapMetadata(
        name="de_anubis",
        display_name="Anubis",
        pos_x=-2796, pos_y=3328, scale=5.22,
        site_a=(1400, 250),
        site_b=(-1500, 900),
        spawn_ct=(1900, 2200),
        spawn_tt=(-1900, 200),
        callouts=[
            Callout("A site", 1400, 250, 260),
            Callout("Heaven", 1900, 700, 180),
            Callout("Connector", 600, 700, 200),
            Callout("Mid", 0, 1000, 220),
            Callout("Bridge", -600, 1100, 220),
            Callout("Water", -1100, 1500, 200),
            Callout("B site", -1500, 900, 260),
            Callout("Palace", -1900, 1400, 180),
        ],
        paths=[
            # T → A via connector
            MapPath("tt", "A", [(-1900, 200), (-700, 600), (0, 700), (600, 700), (1100, 500), (1400, 250)]),
            # T → A via heaven
            MapPath("tt", "A", [(-1900, 200), (-700, 400), (700, 600), (1400, 600), (1700, 400), (1400, 250)]),
            # T → B direct
            MapPath("tt", "B", [(-1900, 200), (-1900, 700), (-1700, 1100), (-1500, 900)]),
            # T → B via bridge / water
            MapPath("tt", "B", [(-1900, 200), (-1100, 700), (-600, 1100), (-1100, 1500), (-1500, 900)]),
            # CT → A defend
            MapPath("ct", "A", [(1900, 2200), (1700, 1300), (1700, 700), (1400, 250)]),
            # CT → A connector
            MapPath("ct", "A", [(1900, 2200), (1100, 1500), (600, 700), (1100, 500), (1400, 250)]),
            # CT → B defend
            MapPath("ct", "B", [(1900, 2200), (300, 1500), (-700, 1100), (-1500, 900)]),
            # CT → B palace
            MapPath("ct", "B", [(1900, 2200), (0, 1700), (-1500, 1500), (-1900, 1400), (-1500, 900)]),
        ],
    ),
    "de_vertigo": MapMetadata(
        name="de_vertigo",
        display_name="Vertigo",
        pos_x=-3168, pos_y=1762, scale=4.00,
        radar_url_lower="/maps/de_vertigo_lower.png",
        lower_threshold_z=11700.0,
        site_a=(-1600, -800),
        site_b=(-2750, 600),
        spawn_ct=(-2300, -1900),
        spawn_tt=(0, 1100),
        callouts=[
            Callout("A site", -1600, -800, 240),
            Callout("A ramp", -1100, -1100, 200),
            Callout("Mid", -700, -200, 200),
            Callout("B site (lower)", -2750, 600, 240),
            Callout("B stairs", -2200, 0, 200),
        ],
        paths=[
            # T → A ramp
            MapPath("tt", "A", [(0, 1100), (-300, 0), (-700, -700), (-1100, -1100), (-1600, -800)]),
            # T → A mid
            MapPath("tt", "A", [(0, 1100), (-700, -200), (-1100, -800), (-1600, -800)]),
            # T → B stairs
            MapPath("tt", "B", [(0, 1100), (-1100, 600), (-2200, 0), (-2750, 600)]),
            # T → B mid
            MapPath("tt", "B", [(0, 1100), (-700, -200), (-2200, 0), (-2750, 600)]),
            # CT → A defend
            MapPath("ct", "A", [(-2300, -1900), (-1900, -1300), (-1600, -800)]),
            # CT → A ramp
            MapPath("ct", "A", [(-2300, -1900), (-1100, -1100), (-1600, -800)]),
            # CT → B defend
            MapPath("ct", "B", [(-2300, -1900), (-2300, -700), (-2750, 0), (-2750, 600)]),
            # CT → B stairs
            MapPath("ct", "B", [(-2300, -1900), (-2200, -300), (-2200, 0), (-2750, 600)]),
        ],
    ),
    "de_overpass": MapMetadata(
        name="de_overpass",
        display_name="Overpass",
        pos_x=-4831, pos_y=1781, scale=5.20,
        site_a=(-1900, 600),
        site_b=(-2700, -1900),
        spawn_ct=(-2300, 1100),
        spawn_tt=(-3700, -2700),
        callouts=[
            Callout("A site", -1900, 600, 260),
            Callout("Long", -2400, 1100, 200),
            Callout("Bathrooms", -1400, 100, 180),
            Callout("Connector", -3000, -300, 200),
            Callout("Short", -2100, 0, 180),
            Callout("Monster", -3500, -1300, 200),
            Callout("Bank", -2900, -1400, 200),
            Callout("Mid", -3200, -800, 200),
            Callout("B site", -2700, -1900, 260),
            Callout("Construction", -3700, -1700, 200),
        ],
        paths=[
            # T → A long
            MapPath("tt", "A", [(-3700, -2700), (-3500, -1300), (-3000, -300), (-2400, 600), (-2400, 1100), (-1900, 600)]),
            # T → A short / bathrooms
            MapPath("tt", "A", [(-3700, -2700), (-3000, -300), (-2100, 0), (-1400, 100), (-1900, 600)]),
            # T → B (Overpass T spawn is also B side)
            MapPath("tt", "B", [(-3700, -2700), (-3700, -1700), (-2900, -1400), (-2700, -1900)]),
            # T → B via monster
            MapPath("tt", "B", [(-3700, -2700), (-3500, -1300), (-2700, -1900)]),
            # CT → A defend
            MapPath("ct", "A", [(-2300, 1100), (-2400, 1100), (-1900, 600)]),
            # CT → A connector
            MapPath("ct", "A", [(-2300, 1100), (-1900, 600), (-1400, 100)]),
            # CT → B defend
            MapPath("ct", "B", [(-2300, 1100), (-2900, 0), (-3200, -800), (-2900, -1400), (-2700, -1900)]),
            # CT → B via mid
            MapPath("ct", "B", [(-2300, 1100), (-3000, -300), (-3200, -800), (-2700, -1900)]),
        ],
    ),
    "de_train": MapMetadata(
        name="de_train",
        display_name="Train",
        pos_x=-2308, pos_y=2078, scale=4.082077,
        radar_url_lower="/maps/de_train_lower.png",
        lower_threshold_z=-50.0,
        site_a=(150, 100),
        site_b=(-200, 1500),
        spawn_ct=(-1500, -200),
        spawn_tt=(1500, 1500),
        callouts=[
            Callout("A site", 150, 100, 260),
            Callout("Ivy", -250, -800, 200),
            Callout("Connector", -800, 200, 180),
            Callout("Pop dog", -1000, 600, 200),
            Callout("Z connector", -400, 700, 180),
            Callout("Mid", 0, 700, 200),
            Callout("B site", -200, 1500, 260),
            Callout("B halls", 700, 1000, 200),
            Callout("Ladder", -1300, 800, 180),
        ],
        paths=[
            # T → A via ivy
            MapPath("tt", "A", [(1500, 1500), (700, 1000), (300, 400), (-250, -800), (150, 100)]),
            # T → A via mid
            MapPath("tt", "A", [(1500, 1500), (700, 1000), (0, 700), (-400, 700), (150, 100)]),
            # T → B via halls
            MapPath("tt", "B", [(1500, 1500), (700, 1000), (200, 1300), (-200, 1500)]),
            # T → B via Z connector
            MapPath("tt", "B", [(1500, 1500), (700, 1000), (-400, 700), (-200, 1500)]),
            # CT → A defend
            MapPath("ct", "A", [(-1500, -200), (-800, 200), (-300, -100), (150, 100)]),
            # CT → A ivy
            MapPath("ct", "A", [(-1500, -200), (-700, -500), (-250, -800), (150, 100)]),
            # CT → B defend
            MapPath("ct", "B", [(-1500, -200), (-1300, 800), (-700, 1100), (-200, 1500)]),
            # CT → B via pop dog / Z
            MapPath("ct", "B", [(-1500, -200), (-1000, 600), (-400, 700), (-200, 1500)]),
        ],
    ),
}


def list_maps() -> list[MapMetadata]:
    return list(_MAPS.values())


def get_map(name: str) -> MapMetadata | None:
    return _MAPS.get(name)


def get_map_or_default(name: str | None) -> MapMetadata:
    """Return the requested map, falling back to a generic stylized box."""
    if name and name in _MAPS:
        return _MAPS[name]
    return MapMetadata(
        name=name or "unknown",
        display_name=(name or "Unknown").replace("de_", "").title(),
        pos_x=-2000, pos_y=2000, scale=4.0,
        site_a=(1000, -800),
        site_b=(-1000, 1000),
        spawn_ct=(-1500, -1500),
        spawn_tt=(1500, 1500),
        callouts=[
            Callout("A site", 1000, -800, 240),
            Callout("B site", -1000, 1000, 240),
            Callout("Mid", 0, 0, 220),
        ],
    )


def supported_map_names() -> list[str]:
    return list(_MAPS.keys())
