# RIFTSCOPE 🎯
### CS2 2D Demo Replay & Analytics — Phase 2

> **Replay every round on a 2D tactical map.** Watch player movements, kills,
> smokes, molotovs and bomb plants unfold in real time. Plus deep stats:
> ratings, economy, clutches and more.

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
the live processing: queued → processing 5%…100% → completed. Click the
demo to open the **2D Replay** — pick any round, hit play, and watch the
match unfold on the tactical map.

The replay shows player movement, kills (with skull markers), smokes &
molotovs (translucent areas), bomb plants and defuses. Use the scrubber to
jump anywhere, change speed (0.5x–4x), or hover the kill feed to highlight
that player on the map.

> The dev parser produces deterministic stub data seeded by the file’s
> name+size, so you can iterate on the UI without needing a real Rust
> toolchain. Plug in `demoparser2` for production (see Production stack).

---

## Project structure

```
riftscope/
├── apps/
│   ├── web/                         # Next.js frontend
│   │   ├── app/                     # App Router pages
│   │   ├── components/              # UI components
│   │   ├── lib/
│   │   │   ├── api.ts               # Typed API client
│   │   │   └── hooks/useDemos.ts    # React Query hooks (polling)
│   │   └── types/demo.ts            # Mirrors backend schemas
│   │
│   └── api/                         # FastAPI backend
│       ├── main.py                  # Entry point + lifespan
│       ├── core/settings.py         # pydantic-settings
│       ├── db/
│       │   ├── database.py          # SQLAlchemy engine + session
│       │   └── models/demo.py       # Demo ORM model
│       ├── routers/
│       │   ├── demos.py             # /demos endpoints
│       │   └── players.py           # /players/search
│       ├── schemas/demo.py          # Pydantic v2 schemas
│       ├── services/
│       │   ├── storage.py           # Streaming local FS storage
│       │   └── demo_parser.py       # Parser (stub → demoparser2)
│       ├── workers/demo_worker.py   # Async pipeline (BackgroundTasks → Celery)
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
| GET    | `/health`                                  | Health probe                                   |
| GET    | `/demos`                                   | List all demos                                 |
| POST   | `/demos/upload`                            | Upload a `.dem` file (multipart/form-data)     |
| GET    | `/demos/{id}`                              | Demo metadata                                  |
| GET    | `/demos/{id}/status`                       | Lightweight status (polled every 1.5s)         |
| GET    | `/demos/{id}/analysis`                     | Full analysis (lightweight, no per-frame data) |
| GET    | `/demos/{id}/timeline/{round_number}`      | Per-round 2D timeline (frames + events)        |
| DELETE | `/demos/{id}`                              | Remove demo + its file                         |
| GET    | `/players/search?query=...`                | Search players across processed demos          |

Status lifecycle: `uploaded → queued → processing → completed | failed`.

---

## Production stack (Docker)

The `prod` profile runs the full architecture: PostgreSQL, Redis, MinIO,
Celery worker, real `demoparser2`. **This requires Linux/macOS or WSL2** —
`demoparser2` ships Rust extensions that don’t reliably build on bare
Windows + Python 3.14.

```bash
cd docker
EXTRA_REQS=prod docker compose --profile prod up --build
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
- [ ] **Phase 3** — Swap parser stub → demoparser2 (real player coordinates &
                    events), real CS2 radar overlays per map, PostgreSQL
                    primary, Celery + Redis queue, MinIO storage
- [ ] **Phase 4** — Per-frame view direction & weapon visuals, advanced
                    grenade trajectories, utility heatmap, demoparser2
                    smoke/flash/he timing
- [ ] **Phase 5** — Player profiles, comparisons, clutch detector
- [ ] **Phase 6** — Polish, PWA, deployment automation (Vercel + Railway)

---

## License

Proprietary — RIFTSCOPE. All rights reserved.
