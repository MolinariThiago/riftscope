# Map radar overlays

Real CS2 radar PNGs (1024×1024) used as the backdrop of the 2D replay viewer.

## Source & attribution

Sourced from **[akiver/cs-demo-manager](https://github.com/akiver/cs-demo-manager)**
(`static/images/maps/cs2/radars/`). Same upstream data as the popular
desktop CS Demo Manager app — Valve's overview PNGs decoded from the CS2
game files.

When redistributing, credit the upstream project. License: same as upstream.

## How to refresh / add maps

```bash
cd apps/api
.\.venv\Scripts\python.exe scripts/download_radars.py
```

The script reads the supported map list from `services/maps.py` and pulls
each map's `_radar.png` (and `_lower.png` for two-floor maps) into this
folder.

## File mapping

| File                        | Map                       | Lower variant?  |
|-----------------------------|---------------------------|-----------------|
| `de_mirage.png`             | Mirage                    |                 |
| `de_inferno.png`            | Inferno                   |                 |
| `de_dust2.png`              | Dust II                   |                 |
| `de_nuke.png`               | Nuke (upper)              | `de_nuke_lower.png` |
| `de_ancient.png`            | Ancient                   |                 |
| `de_anubis.png`             | Anubis                    |                 |
| `de_vertigo.png`            | Vertigo (upper)           | `de_vertigo_lower.png` |
| `de_overpass.png`           | Overpass                  |                 |
| `de_train.png`              | Train (upper)             | `de_train_lower.png` |

## Two-level maps

The viewer's top-right Upper / Lower toggle swaps the radar image. Once
real demos surface a per-frame `z` coordinate (Phase 3B), the toggle will
auto-switch based on `MapMetadata.lowerThresholdZ`:

| Map         | Threshold Z |
|-------------|-------------|
| de_nuke     | -495        |
| de_vertigo  | 11700       |
| de_train    | -50         |
