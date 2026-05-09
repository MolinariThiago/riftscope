# RIFTSCOPE 🎯
### CS2 2D Demo Replay & Analytics — Phase 3A

> **Replay every round on a 2D tactical map.** Watch player movements, view
> directions, kills, smokes, molotovs and bomb plants unfold in real time.
> Toggle analysis layers (paths, heatmap, callouts, view arrows) and dig
> into ratings, economy and clutches.

---

## Stack

| Layer        | Tech                                    |
|--------------|-----------------------------------------|
| Frontend     | Next.js 14 + TypeScript + Tailwind CSS  |
| Data layer   | React Query + Zustand                   |
| Backend      | FastAPI (Python 3.12+)                  |
| ORM          | SQLAlchemy 2                            |
| DB (dev)     | SQLite (zero-config)                    |
| DB (prod)    | PostgreSQL (asyncpg)                    |
| Queue (dev)  | FastAPI BackgroundTasks (in-process)    |
| Queue (prod) | Celery + Redis                          |
| Parser       | Stub (dev) → demoparser2 (prod)         |
| Storage      | Local FS (dev) → MinIO/S3 (prod)        |

All three swap points (parser / storage / queue) are now **factory-driven**
and selected via `PARSER_BACKEND` / `STORAGE_BACKEND` / `QUEUE_BACKEND` env
vars — no router or worker code changes needed when the production
implementations land.

---

## Quick start — Windows / Python 3.14 / Node 20

The dev stack runs **without** Docker, PostgreSQL, Redis or any Rust
toolchain. SQLite + in-process workers + a deterministic parser stub make
the full pipeline (upload → queue → process → render) work on a fresh
Windows machine.

### 1. Backend

```powershell
cd apps\api

py -m venv .venv
.\.venv\Scripts\activate

py -m pip install --upgrade pip
py -m pip install -r requirements.txt

py -m uvicorn main:app --reload --port 8000
```

API ready at <http://localhost:8000>. Swagger UI at <http://localhost:8000/docs>.

### 2. Frontend (in another terminal)

```powershell
cd apps\web

npm install
npm run dev
```

Web ready at <http://localhost:3000>.

### 3. Drop a demo

Go to <http://localhost:3000/demos/upload>, drop any `.dem` file, and watch
the live processing: `queued → processing 5%…100% → completed`. Click the
demo to open the **2D Replay** — pick any round, hit play, and watch the
match unfold on the tactical map.

The replay shows per-map radar geometry, player movement, view directions,
kills (with skull markers), smokes & molotovs (translucent areas with
correct radii), bomb plants and defuses. Use the **Layers** panel to
toggle paths, heatmap, callouts, view-direction cones and grenade zones.
Scrub anywhere, change speed (0.5x–4x), or hover the kill feed to
highlight that player on the map.

> The dev parser produces deterministic stub data seeded by the file’s
> name+size, anchored to the active map's real bombsite / spawn / callout
> coordinates. Movement looks coherent on Mirage vs Inferno vs Nuke.
> Plug in `demoparser2` for production by flipping `PARSER_BACKEND` (see
> Production stack).

---

## Project structure

```
riftscope/
├── apps/
│   ├── web/                         # Next.js frontend
│   │   ├── app/                     # App Router pages
│   │   ├── components/
│   │   │   └── replay/
│   │   │       ├── MapCanvas.tsx    # Per-map radar + layered overlays
│   │   │       ├── LayersPanel.tsx  # Toggle paths / heatmap / callouts / etc.
│   │   │       ├── KillFeed.tsx
│   │   │       ├── PlaybackControls.tsx
│   │   │       └── RoundSelector.tsx
│   │   ├── lib/
│   │   │   ├── api.ts               # Typed API client (demos + maps)
│   │   │   └── hooks/
│   │   │       ├── useDemos.ts      # React Query hooks (polling)
│   │   │       ├── useMaps.ts       # Per-map metadata
│   │   │       └── useRoundPlayback.ts
│   │   └── types/demo.ts            # Mirrors backend schemas
│   │
│   └── api/                         # FastAPI backend
│       ├── main.py                  # Entry point + lifespan
│       ├── core/settings.py         # Env-driven settings + backend selectors
│       ├── db/
│       │   ├── database.py          # SQLAlchemy engine + session
│       │   └── models/demo.py       # Demo + DemoPlayer + DemoRound + DemoKill
│       ├── routers/
│       │   ├── demos.py             # /demos endpoints
│       │   ├── players.py           # /players/search (indexed)
│       │   └── maps.py              # /maps and /maps/{name}
│       ├── schemas/demo.py          # Pydantic v2 schemas
│       ├── services/
│       │   ├── maps.py              # Per-CS2-map metadata
│       │   ├── storage.py           # DemoStorage protocol + LocalDemoStorage + factory
│       │   ├── queue.py             # DemoQueue protocol + InProcessQueue + factory
│       │   ├── parser_factory.py    # Resolves stub / demoparser2 backend
│       │   └── demo_parser.py       # Stub parser (per-map anchors + yaw + radii)
│       ├── workers/demo_worker.py   # Async pipeline (writes JSON + normalized rows)
│       ├── requirements.txt         # Slim deps (Win + Py 3.14 safe)
│       └── requirements-prod.txt    # PostgreSQL/Redis/Celery/demoparser2
│
└── docker/
    ├── Dockerfile.api               # supports EXTRA_REQS=slim|prod
    ├── Dockerfile.web
    └── docker-compose.yml           # profiles: dev | prod
```

---

## API reference

| Method | Path                                       | Description                                    |
|--------|--------------------------------------------|------------------------------------------------|
| GET    | `/health`                                  | Health probe + active backend info             |
| GET    | `/demos`                                   | List all demos                                 |
| POST   | `/demos/upload`                            | Upload a `.dem` file (multipart/form-data)     |
| GET    | `/demos/{id}`                              | Demo metadata                                  |
| GET    | `/demos/{id}/status`                       | Lightweight status (polled every 1.5s)         |
| GET    | `/demos/{id}/analysis`                     | Full analysis (lightweight, no per-frame data) |
| GET    | `/demos/{id}/timeline/{round_number}`      | Per-round 2D timeline (frames + events + yaw)  |
| DELETE | `/demos/{id}`                              | Remove demo + its file                         |
| GET    | `/players/search?query=...`                | Search players (indexed `demo_players`)        |
| GET    | `/maps`                                    | List maps with full metadata                   |
| GET    | `/maps/{name}`                             | Per-map metadata (sites, callouts, bounds)     |

Status lifecycle: `uploaded → queued → processing → completed | failed`.

---

## Phase 3A — what shipped

- **Per-map metadata service** (`services/maps.py`): real-ish bombsite,
  spawn and callout coordinates for de_mirage, de_inferno, de_dust2,
  de_nuke, de_ancient, de_anubis, de_vertigo. Exposed at `/maps`.
- **2D replay viewer redesign**: per-map radar (sites + callouts driven
  by metadata), spawn zones, view-direction cones, layered overlays and
  a `LayersPanel` with toggles for paths, heatmap, view arrows, grenades,
  kills, callouts and the bomb marker.
- **Parser stub upgrades**: anchors come from map metadata, every player
  frame carries a `yaw` derived from movement, grenade events ship a
  `radius`, kills sit near sites and key chokepoints.
- **Normalized schema**: `demo_players`, `demo_rounds`, `demo_kills`
  tables with proper FKs and indices. `Demo.analysis_data` still holds
  the heavy per-frame timeline; aggregates query the indexed tables.
- **`/players/search` indexed**: scans the `demo_players` table by
  default; falls back to JSON scan for legacy demos.
- **Backend selector flags**: `PARSER_BACKEND`, `STORAGE_BACKEND`,
  `QUEUE_BACKEND` plus `parser_factory.get_parser()`,
  `storage.get_storage()`, `queue.get_queue()` so swapping in
  demoparser2 / MinIO / Celery in Phase 3B is an env flip.

---

## Phase 3B — production swap (Linux / WSL2)

The `prod` profile runs the full architecture: PostgreSQL, Redis, MinIO,
Celery worker, real `demoparser2`. **This requires Linux/macOS or WSL2** —
`demoparser2` ships Rust extensions that don’t reliably build on bare
Windows + Python 3.14.

```bash
cd docker
EXTRA_REQS=prod docker compose --profile prod up --build
```

Set in the API environment:

```env
DATABASE_URL=postgresql+asyncpg://riftscope:riftscope@db:5432/riftscope
PARSER_BACKEND=demoparser2
STORAGE_BACKEND=s3
QUEUE_BACKEND=celery
REDIS_URL=redis://redis:6379/0
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

Services:

- Web: <http://localhost:3000>
- API: <http://localhost:8000>
- MinIO Console: <http://localhost:9001>
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

For dev-in-Docker (slim deps, SQLite, no PostgreSQL/Redis):

```bash
cd docker
docker compose --profile dev up --build
```

---

## Roadmap

- [x] **Phase 1** — Frontend base, landing, dashboard shell, upload UI
- [x] **Phase 2** — FastAPI backend, async processing, 2D replay viewer with
                    per-round timeline, real-time polling, stats pages
- [x] **Phase 3A** — Per-map radar metadata, layered 2D analysis (paths,
                    heatmap, view directions, callouts, grenade radii),
                    normalized schema, factory-driven backend selectors
- [ ] **Phase 3B** — Activate demoparser2 (real player coordinates &
                    events), real CS2 radar overlays per map, PostgreSQL
                    primary, Celery + Redis queue, MinIO storage
- [ ] **Phase 4** — Per-frame weapon visuals, advanced grenade
                    trajectories, utility heatmap, demoparser2 smoke /
                    flash / he timing
- [ ] **Phase 5** — Player profiles, comparisons, clutch detector
- [ ] **Phase 6** — Polish, PWA, deployment automation (Vercel + Railway)

---

## License

Proprietary — RIFTSCOPE. All rights reserved.
