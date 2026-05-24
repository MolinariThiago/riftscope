# RIFTSCOPE — Architecture

This document describes the production architecture of the platform: the
demo ingestion pipeline, the replay rendering stack, the analytics engine,
and the deployment topology. It is the single source of truth for "where
does X live and why".

If you are looking for setup / quick start, see `README.md`.

---

## 1. High-level overview

```
                      ┌─────────────┐
                      │   Frontend  │ Next.js 14 · React Query · Pixi/WebGL
                      │  (apps/web) │
                      └──────┬──────┘
                             │ HTTP / JSON
                             ▼
                      ┌─────────────┐
                      │   API       │ FastAPI (apps/api/main.py)
                      │  /demos     │   • routers (demos, players, maps,
                      │  /players   │     pro, /demos/{id}/insights)
                      │  /maps      │   • Pydantic v2 response shapes
                      │  /pro       │
                      └──────┬──────┘
                             │
            ┌────────────────┼─────────────────┐
            ▼                ▼                 ▼
      ┌──────────┐    ┌──────────┐      ┌────────────┐
      │  Worker  │    │ Postgres │      │  Object    │
      │ (Celery- │    │  / SQLite│      │  storage   │
      │  ready)  │    │          │      │ (MinIO/S3) │
      └────┬─────┘    └──────────┘      └────────────┘
           │
           ▼
   ┌─────────────────┐
   │  demoparser2    │ Rust-backed CS2 demo parser (real data only)
   └─────────────────┘
```

**Single golden rule:**
> *Process once → store permanently → reuse everywhere.*

No live recomputation of analytics on the request path. Every endpoint
serves data that was computed by a worker after parsing.

---

## 2. Demo ingestion pipeline

```
upload (.dem)
   │
   ▼
[storage.save_demo]
   │
   ▼
[Demo row: status=queued]
   │
   ▼
[queue.enqueue → BackgroundTask | Celery task]
   │
   ▼
[worker.process_demo]
   │
   ├─→ status=processing
   │
   ├─→ parser.parse(file)             ←  factory: stub | demoparser2
   │      └ services/demo_parser_real.py wraps demoparser2
   │
   ├─→ DemoPlayer / DemoRound / DemoKill rows  (normalized)
   │
   ├─→ DemoInsight row                          (pre-computed analytics)
   │
   └─→ status=completed
```

### 2.1 Backends are factory-resolved

`apps/api/services/parser_factory.py` returns the active parser based on
`PARSER_BACKEND`:

| `PARSER_BACKEND` | Implementation | Notes |
|---|---|---|
| `demoparser2` (default) | `services/demo_parser_real.py` (`RealDemoParser`) | Wraps the Rust parser. Used in production. |
| `stub` | `services/demo_parser.py` (`DemoParserService`) | Deterministic synthetic data — only used when the real wheel can't install (e.g. unsupported Python). |

Same shape for `STORAGE_BACKEND` (`local` / `s3`) and `QUEUE_BACKEND`
(`inprocess` / `celery`). The router code never imports a concrete
backend — only the factory.

### 2.2 What demoparser2 produces vs what we store

`demoparser2` exposes a stream-y API: `parse_ticks(props)`, `parse_event(name)`,
`parse_grenades()`, `parse_player_info()`, `parse_header()`. The real parser
glues these into a single normalized dict (`apps/api/services/demo_parser_real.py`):

```python
{
  "meta":       {map, tickrate, durationSeconds, roundCount, score},
  "players":    [PlayerStats × 10],
  "rounds":     [Round × N],
  "kills":      [Kill × M with killerPos, victimPos],
  "clutches":   [...],
  "economy":    [{round, ctSpent, ttSpent, ctType, ttType}, ...],
  "heatmapPoints": [...],
  "timeline": {
    "fps": 10,
    "rounds": {
      "1": {
        "frames":   [{t, players: [{x, y, yaw, hp, alive, ...}]}, ...],
        "events":   [{type: kill|bomb_*|grenade_thrown, ..., killerX, killerY, throwerX, throwerY}, ...],
        "loadouts": {steamId: {weapon, armor, helmet, kit, money}, ...},
        "durationSeconds": ...,
        "frameCount": ...,
      },
      ...
    }
  }
}
```

This blob is persisted as `Demo.analysis_data` (JSONB on Postgres, JSON on
SQLite). Aggregate fields are also denormalized into `DemoPlayer`,
`DemoRound`, `DemoKill` so cross-demo queries stay fast.

### 2.3 Tick → frame sampling

Real demos run at 64 (MM) or 128 (Faceit / pro). The replay viewer renders
at **10 FPS** to keep payload manageable. The worker samples every
`tickrate / 10` ticks and **back-fills missing players** from their last
known state — the timeline always exposes a stable 10-player roster per
frame so the renderer never has to handle disappearing entities.

### 2.4 Synchronization invariants

- `frame[i].t === i / TIMELINE_FPS` exactly (no drift from gaps).
- All event timings are `(event.tick - round.startTick) / tickrate`.
- Kill positions come from a `(tick, steamid) → (X, Y, Z)` lookup
  on the raw tick stream, so the marker on the map is *exactly* where
  the player stood when the engine reported the death.
- Bomb plant / explode / defuse events carry the planter's position
  (looked up by the same mechanism) — no `0,0` placeholders.
- Grenade events carry both **landing** (`x`, `y`) and **release**
  (`throwerX`, `throwerY`) coordinates, derived from `parse_grenades`'s
  first-tick-per-entity.

---

## 3. Insights engine (`apps/api/services/insights.py`)

Heuristic-only, runs synchronously inside the worker right after parsing.
Output is persisted to `DemoInsight` (one row per demo, JSON columns).

| Heuristic | What it detects |
|---|---|
| **Opening duel** | First kill of each round, attributing it to killer & victim. |
| **Trade** | Back-to-back kills (≤ ~5s of ticks) where the second kill's victim is the first kill's killer. |
| **Fast plant** | Bomb planted before `t = 25s` of round duration. |
| **Eco win** | Winner's equipment value < $5k AND opponent had $4k+ more. |
| **Anti-eco loss** | Loser was on eco AND winner had $8k+ more — and still lost. |
| **Defuse / explode** | Tagged as severity-`good` / `info` based on round end reason. |
| **Heatmap grid** | 32 × 32 cell aggregation of kill / death positions, world-bounded by the actual coordinates seen. |

Every insight references a real `round`, `tick`, or `steamId`. There is **no
random / mock / LLM-generated content** in this pipeline.

The engine is versioned (`engine_version = "1"`); upgrading the version
forces a re-compute on next demo processing.

The `DemoInsightsResponse` Pydantic schema is identical to the persisted
JSON — the endpoint is a thin pass-through. No live computation.

---

## 4. Replay rendering

### 4.1 Renderer

The 2D map view uses **PixiJS v8 + pixi-viewport**, GPU-accelerated:

- `apps/web/components/replay/PixiMapCanvas.tsx`
- Lazy-loaded via `next/dynamic({ ssr: false })` so SSR / first paint
  don't pay the WebGL cost.
- Six layered `Container`s (radar → overlays → grenade areas → kill
  trajectories → event markers → players) — each updated independently
  per frame so the renderer never repaints the whole stage.
- `Viewport` provides smooth wheel zoom + pinch + drag pan with clamp
  + center-snap. Initial zoom 1.18 in fullBleed mode crops the radar
  PNG's letterbox so the playable area visually fills the viewport.
- Player nodes are diff-updated against the steamId map between
  frames — Pixi `Container`s persist across frames; only the inner
  graphics geometry is rewritten when state changes. Names of
  text labels are only assigned when the string actually differs (no
  texture upload churn).

### 4.2 Coordinate transform

```
radar_px_x = (world_x - pos_x) / scale
radar_px_y = (pos_y - world_y) / scale     # Y inverted
```

`pos_x`, `pos_y`, `scale` come from `apps/api/services/maps.py`, which
ships the canonical Valve overview constants (verified against
`akiver/cs-demo-manager/src/node/database/maps/default-maps.ts`).

The same constants are exposed via `GET /maps/{name}` so the frontend
projects worlds coords into radar pixels deterministically.

### 4.3 Replay determinism

- `useRoundPlayback` advances `time` via `requestAnimationFrame`,
  scaled by `speed`. No setTimeout, no React re-render per frame.
- `currentFrame` is interpolated from the two adjacent frames using
  the linear `(time × fps - i)` parameter — smooth at any speed.
- Pause / scrub / speed change all preserve the same time invariants;
  no hidden state.

### 4.4 Layered, opt-in rendering

The replay viewer's `LayersPanel` toggles each rendering layer
independently (kills, grenades, paths, heatmap, view arrows, callouts,
sites, bomb, grid, radar overlay) — toggles flow into Pixi via the
`layers` prop and trigger only the affected effect to redraw.

---

## 5. Frontend

```
apps/web/
  app/                 ← Next.js App Router pages
    (dashboard)/
      demos/page.tsx           ← demo library (date-grouped DemoCards)
      demo/[id]/replay/page.tsx ← full-bleed Pixi viewer
      pro/page.tsx             ← Liquipedia-fed pro match feed
      compare/page.tsx         ← player + match comparison (radar chart)
      players/page.tsx         ← cross-demo player search
      profile/page.tsx
      settings/page.tsx
  components/
    replay/                    ← Pixi canvas + UI panels
      PixiMapCanvas.tsx        ← WebGL renderer (one stage, six layers)
      ReplayTimelineBar.tsx    ← unified bottom bar (rounds + events + tools)
      TeamLoadoutPanel.tsx     ← cs2.cam-style team panels
      KillFeed.tsx
      ExchangesPanel.tsx
      InsightsPanel.tsx        ← reads /demos/{id}/insights
      LayersPanel.tsx
      layers.ts                ← shared ReplayLayers type (no React deps)
  lib/
    api.ts                     ← typed fetch client
    hooks/useDemos.ts          ← React Query hooks (demos, analysis,
                                  timeline, insights, search)
    stores/settings.ts         ← Zustand persisted store (theme, locale,
                                  default replay layers, integrations)
    i18n/                      ← lightweight translator (en/es/pt)
```

### 5.1 React Query cache strategy

| Query                           | staleTime | Notes |
|---------------------------------|-----------|-------|
| `useDemos()`                    | default   | Auto-refetch every 2s if any demo is active. |
| `useDemoStatus(id)`             | 0         | Polled at 1.5s while processing. |
| `useDemoAnalysis(id)`           | 5 min     | Heavy; rarely changes. |
| `useDemoInsights(id)`           | 1 hour    | Versioned by engine_version. |
| `useRoundTimeline(id, round)`   | 30 min    | Heaviest payload — round-scoped. |
| `useMapMeta(name)`              | 1 hour    | Static map data. |

---

## 6. Pro match ingestion (`/pro`)

```
LiquipediaSource.list_recent_matches()
   │
   ▼
ProMatch row  (UNIQUE on (source, source_match_id))
   │
   ▼
GET /pro/matches  →  feed UI
```

- `apps/api/services/demo_sources/base.py` defines the `DemoSource`
  Protocol — every external feed implements it.
- `LiquipediaSource` uses the official MediaWiki API + a custom
  User-Agent, parses the rendered match list HTML with tight regexes
  pinned to the `match-info-header-opponent` / `match-info-header-scoreholder`
  classes Liquipedia uses for structured matches.
- Idempotent upserts on `(source, source_match_id)` — re-running
  `POST /pro/sync` is safe and only touches rows that changed (score,
  played_at, demo_url).
- Adding a new source = one new file in `services/demo_sources/`;
  register it in `__init__.py` and the worker picks it up automatically.

HLTV is intentionally **not** a default source — scraping HLTV's site
violates their TOS. Manual demo-URL importing of public `.dem` files
remains a viable extension; bulk scraping is not.

---

## 7. Storage layer

| Backend | Location | Used by | When |
|---|---|---|---|
| Local filesystem | `apps/api/storage/uploads/` | dev | `STORAGE_BACKEND=local` (default) |
| S3 / MinIO | `s3://${S3_BUCKET}` | prod | `STORAGE_BACKEND=s3` |

The storage service exposes `save_demo`, `get_path`, `delete_demo`. The
S3 backend slot exists in `services/storage.py` and falls back to local
if not yet wired — the rest of the codebase is unaware of which
implementation is active.

---

## 8. Database schema

```
demos               id, status, map_name, score_ct, score_tt, ...,
                    analysis_data (JSON / JSONB)
demo_players        id, demo_id FK, steam_id idx, name idx, team,
                    kills, deaths, rating, adr, ...
demo_rounds         id, demo_id FK, number, winner, end_reason,
                    bomb_planted, bomb_site, ...
demo_kills          id, demo_id FK, round_number idx, killer_steam_id idx,
                    victim_steam_id idx, weapon, headshot,
                    killer_x, killer_y, victim_x, victim_y, ...
demo_insights       id, demo_id FK UNIQUE, engine_version,
                    summary | rounds | players | heatmap (JSON)
pro_matches         id, source, source_match_id (UNIQUE pair),
                    team_a, team_b, score_a, score_b,
                    map_name, event_name, played_at, demo_url, demo_id FK?
```

Indices: `demos(status)`, `demo_players(steam_id, name, rating)`,
`demo_kills(round_number, killer_steam_id, victim_steam_id)`,
`pro_matches(source, played_at, source_match_id UNIQUE)`,
`demo_insights(demo_id UNIQUE)`.

---

## 9. Deployment topology

The repo ships `docker/docker-compose.yml` with two profiles:

### 9.1 Dev profile

```
docker compose --profile dev up
```

- Web (Next.js) on `:3000`
- API (FastAPI + slim deps) on `:8000`
- SQLite + in-process queue + local FS storage

### 9.2 Prod profile

```
EXTRA_REQS=prod docker compose --profile prod up
```

- Web (Next.js) on `:3000`
- API on `:8000` — installs `requirements-prod.txt` (asyncpg, celery,
  boto3, demoparser2, etc.)
- Postgres 16 on `:5432`
- Redis 7 on `:6379`
- MinIO on `:9000` (API) + `:9001` (console)
- Celery worker container
- Set in env:
  ```
  PARSER_BACKEND=demoparser2
  STORAGE_BACKEND=s3
  QUEUE_BACKEND=celery
  DATABASE_URL=postgresql+asyncpg://...
  REDIS_URL=redis://redis:6379/0
  S3_ENDPOINT=http://minio:9000
  ```

### 9.3 Recommended hosting

- **Frontend:** Vercel (default). The app is Next.js 14 App Router and
  uses no edge-only features.
- **API + workers:** Fly.io / Railway / Render. The Celery worker
  needs ≥ 4 GB RAM for `parse_ticks` on long pro demos.
- **Postgres:** Neon / Supabase / managed RDS.
- **Object storage:** R2 / S3 / Backblaze B2 / MinIO. Prefer pre-signed
  URLs for direct browser uploads when traffic grows.
- **CDN:** Vercel for `apps/web/public/maps/*.png` (radar overlays).

### 9.4 Env vars summary

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./riftscope.db` | `postgresql+asyncpg://...` for prod |
| `REDIS_URL` | `redis://localhost:6379/0` | Required when `QUEUE_BACKEND=celery` |
| `PARSER_BACKEND` | `demoparser2` | falls back to `stub` if wheel missing |
| `STORAGE_BACKEND` | `local` | `s3` for production |
| `QUEUE_BACKEND` | `inprocess` | `celery` for production |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` | empty | Used when `STORAGE_BACKEND=s3` |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | Comma-separated JSON list |
| `UPLOAD_MAX_BYTES` | 500 MB | Streamed in 1 MB chunks |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Frontend → API base |

---

## 10. Performance budgets

| Concern | Budget | Where enforced |
|---|---|---|
| First contentful paint (replay viewer) | < 1.5s on broadband | Lazy Pixi via `next/dynamic({ ssr: false })` |
| Time to first frame after timeline load | < 100ms | React Query cache + `staleTime: 30 min` |
| Frame redraw | < 16ms (60 FPS) | One Pixi `redraw` per render; no SVG DOM |
| Demo parse | < 60s per 300 MB demo | demoparser2 in Rust |
| Insights compute | < 1s after parse | Pure Python, in-process, `apps/api/services/insights.py` |
| Page bundle (replay) | ~ 14 KB + Pixi (lazy) | Webpack chunk splitting |

---

## 11. Determinism & data integrity

- The same `.dem` file always produces the same `analysis_data` (parser
  is deterministic — same bytes in, same JSON out).
- The same `analysis_data` always produces the same `DemoInsight`
  (heuristic engine is pure; `engine_version` captures any logic change).
- The same insights always render to the same Pixi scene at any given
  `(round, time)` (no random state in the renderer).
- Re-processing a demo wipes and re-creates all dependent rows
  atomically; partial state is never visible.

---

## 12. Where to extend

Adding a new heuristic insight → drop a new branch in
`apps/api/services/insights.py::_round_insights`. Bump `ENGINE_VERSION`.

Adding a new demo source (Faceit, ESL, BLAST) → create a new file
in `services/demo_sources/` implementing the `DemoSource` protocol;
register it in the package's `__init__.py`.

Adding a new replay overlay (e.g. utility heatmap, smoke timing rings)
→ add a new layer flag to `apps/web/components/replay/layers.ts` and
draw it in a dedicated `Container` inside `PixiMapCanvas.tsx`.

Adding a new map → add metadata in `apps/api/services/maps.py` (with
the canonical `pos_x`, `pos_y`, `scale`) and drop the radar PNG in
`apps/web/public/maps/{map}.png`. The script
`apps/api/scripts/download_radars.py` automates the download for
supported maps.
