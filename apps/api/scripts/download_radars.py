"""
Download real CS2 radar PNGs from akiver/cs-demo-manager into
apps/web/public/maps. Idempotent — overwrites local files.

Usage:
    cd apps/api
    .\\.venv\\Scripts\\python.exe scripts/download_radars.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.maps import list_maps  # noqa: E402

OUT = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "maps"
OUT.mkdir(parents=True, exist_ok=True)

BASE = "https://raw.githubusercontent.com/akiver/cs-demo-manager/main/static/images/maps/cs2/radars/"


def main() -> None:
    maps = list_maps()
    needed: list[str] = []
    for m in maps:
        needed.append(f"{m.name}.png")
        if m.radar_url_lower:
            needed.append(m.radar_url_lower.lstrip("/").split("/")[-1])

    ok = 0
    for fname in needed:
        url = f"{BASE}{fname}"
        try:
            r = httpx.get(url, timeout=20, follow_redirects=True)
            if r.status_code == 200 and len(r.content) > 1000:
                (OUT / fname).write_bytes(r.content)
                print(f"OK  {fname:30s} {len(r.content)/1024:.1f} KB")
                ok += 1
            else:
                print(f"--  {fname}: HTTP {r.status_code}")
        except Exception as exc:
            print(f"ER  {fname}: {exc!r}")

    print(f"\nDownloaded {ok}/{len(needed)} radars to {OUT}")


if __name__ == "__main__":
    main()
