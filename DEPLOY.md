# RIFTSCOPE — Deploy Walkthrough

Single source of truth for going from a clean machine to "first demo
uploaded in prod". Stack: **Vercel** (Next.js) + **Railway** (FastAPI +
Postgres) + **Cloudflare R2** (demo storage).

Cost: **$0 to start** (free tiers + $5/mo Railway credit).

---

## 0 · Pre-flight

You need accounts on:

1. **GitHub** — already have it ✓
2. **Vercel** — sign up at <https://vercel.com> (use the GitHub login, free Hobby plan)
3. **Railway** — sign up at <https://railway.app> (GitHub login, $5 trial credit/mo)
4. **Cloudflare** — sign up at <https://dash.cloudflare.com> (free; only need R2)
5. **Steam Web API key** — get one at <https://steamcommunity.com/dev/apikey>
   (paste your eventual public domain or just `localhost` — Steam doesn't validate it)

You also need:

- The repo pushed to a GitHub repository (private is fine).
- A **random 64-char `SECRET_KEY`**. Generate it now and save it; we'll paste it
  into Railway later:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
# or
openssl rand -base64 48
```

---

## 1 · Push the repo to GitHub

```bash
git add -A
git commit -m "chore: prep for prod deploy"
git push origin main
```

Make sure `.gitignore` covers `apps/api/.env`, `apps/api/.venv`,
`apps/api/riftscope.db`, `apps/web/node_modules`, `apps/web/.next`.

---

## 2 · Cloudflare R2 — bucket for demos

R2 is S3-compatible **without egress fees**, which is the killer feature
when you serve 300-700 MB demo files.

1. Cloudflare dashboard → **R2** → **Create bucket**
   - Name: `riftscope-demos`
   - Location: Automatic
2. Once created, **Manage R2 API Tokens** → **Create API token**
   - Permissions: **Object Read & Write**
   - Bucket: `riftscope-demos` only (don't grant account-wide)
   - TTL: forever (or rotate later)
3. Copy down the four values shown ONCE:
   - `Access Key ID`     → goes to `S3_ACCESS_KEY`
   - `Secret Access Key` → goes to `S3_SECRET_KEY`
   - `Endpoint`          → goes to `S3_ENDPOINT` (looks like `https://<id>.r2.cloudflarestorage.com`)
   - Bucket name         → goes to `S3_BUCKET=riftscope-demos`

Free tier covers 10 GB of storage + 1 M Class A operations / month, plenty
for the pro-demo seeding phase.

### 2b · R2 CORS — REQUIRED for direct browser uploads

The browser uploads `.dem` files **straight to R2** with a presigned PUT
(so 300-500 MB demos never time out streaming through Railway). For that
cross-origin PUT to work, the bucket needs CORS rules allowing your
frontend origin.

Cloudflare dashboard → bucket `riftscope-demos` → **Settings** → **CORS
policy** → **Edit** → paste:

```json
[
  {
    "AllowedOrigins": ["https://riftscope-cs2.vercel.app"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace the origin with your real Vercel URL (exact: scheme, host, no
trailing slash). Add a second entry for `http://localhost:3000` if you
also want direct uploads to work in dev against the prod bucket.

> Without this, uploads fail in the browser console with
> `blocked by CORS policy` on the R2 host (the API itself still works —
> it's the direct PUT that's blocked).

---

## 3 · Railway — backend + Postgres

### 3.1 · New project

1. railway.app → **New Project** → **Deploy from GitHub repo** → pick your repo.
2. Railway will detect the monorepo and ask for a **root directory**.
   Set: `apps/api` (this is where `Dockerfile` lives — Railway uses it
   automatically and skips Nixpacks).
3. Click **Deploy**. The first build will fail because env vars and DB
   aren't wired yet — that's expected.

### 3.2 · Add Postgres

1. Inside the project → **+ New** → **Database** → **Add PostgreSQL**.
2. Once provisioned, click the Postgres service → **Variables** tab →
   copy the `DATABASE_URL` value (looks like `postgresql://postgres:...@.../railway`).
3. **Important**: the project uses **asyncpg**, so replace the scheme:
   - From: `postgresql://...`
   - To:   `postgresql+asyncpg://...`

   Actually our SQLAlchemy setup uses sync drivers (psycopg2). Use the
   stock `postgresql://...` value as-is — Railway's default works.

### 3.3 · Backend env vars

Go to the backend service (the one built from `apps/api`) → **Variables**.
Paste these one by one (use the **Raw Editor** to bulk paste):

```bash
# --- App ---
ENVIRONMENT=production
APP_VERSION=0.3.0

# --- Database (paste Railway's value — KEEP the postgresql:// scheme) ---
DATABASE_URL=${{Postgres.DATABASE_URL}}

# --- Security (paste the 64-char value you generated in step 0) ---
SECRET_KEY=<the secrets.token_urlsafe(48) value>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080

# --- CORS — JSON array. After step 4 we'll come back and add the real
# Vercel URL. For now leave it as a placeholder. ---
CORS_ORIGINS=["https://riftscope-frontend.vercel.app"]

# --- Steam OpenID — points at the FRONTEND, not the API ---
STEAM_API_KEY=<your steam key from step 0>
STEAM_REALM=https://riftscope-frontend.vercel.app
FRONTEND_ORIGIN=https://riftscope-frontend.vercel.app

# --- Backend selectors ---
PARSER_BACKEND=demoparser2
STORAGE_BACKEND=s3
QUEUE_BACKEND=inprocess

# --- Cloudflare R2 (from step 2) ---
S3_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
S3_BUCKET=riftscope-demos
S3_ACCESS_KEY=<R2 Access Key ID>
S3_SECRET_KEY=<R2 Secret Access Key>
S3_REGION=auto

# --- Monetization off for now ---
MONETIZATION_ENABLED=false
```

### 3.4 · Expose the API publicly

1. Backend service → **Settings** → **Networking** → **Generate Domain**.
2. Railway gives you `https://riftscope-api-production.up.railway.app`
   (or similar). Copy it — we'll need it for Vercel.
3. Go back to **Variables** and add:
   ```
   BASE_URL=https://riftscope-api-production.up.railway.app
   ```

### 3.5 · Trigger a fresh deploy

The container should now boot cleanly. Watch the **Deploy Logs** —
you want to see:

```
INFO     Uvicorn running on http://0.0.0.0:<PORT>
INFO     Started server process
```

Quick smoke test from your laptop:

```bash
curl https://<your-railway-url>/health
# → {"status":"ok","service":"riftscope-api","version":"0.3.0",...}
```

If it fails to boot, the most common reasons:

| Error | Fix |
|---|---|
| `SECRET_KEY is still the development placeholder` | You didn't set `SECRET_KEY`. |
| `FRONTEND_ORIGIN still points at localhost` | `FRONTEND_ORIGIN` is empty / wrong. |
| `STEAM_REALM still points at localhost` | Same as above. |
| `psycopg2.OperationalError` | Wrong `DATABASE_URL` — use Railway's reference variable `${{Postgres.DATABASE_URL}}`. |
| `Could not parse JSON` for CORS | `CORS_ORIGINS` must be **JSON**: `["https://..."]`, not comma-separated. |

---

## 4 · Vercel — frontend

### 4.1 · Import the repo

1. vercel.com → **Add New** → **Project** → Import the GitHub repo.
2. **Root Directory**: `apps/web`
3. Framework Preset: **Next.js** (auto-detected)
4. **DO NOT DEPLOY YET** — first add env vars below.

### 4.2 · Env vars

Under **Environment Variables**:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<your-railway-url>` (no trailing slash) |

That's it. Everything else is hardcoded or read at build time.

### 4.3 · Deploy

Click **Deploy**. First build takes 2-3 minutes. When done, Vercel gives
you `https://<project>.vercel.app`.

### 4.4 · Fix Steam OpenID realm

Now that you know the real Vercel URL, update **Railway**:

1. Railway → backend → **Variables** → edit:
   - `CORS_ORIGINS` → `["https://<your-vercel-url>"]`
   - `STEAM_REALM` → `https://<your-vercel-url>`
   - `FRONTEND_ORIGIN` → `https://<your-vercel-url>`
2. Railway redeploys automatically.

---

## 5 · First admin promotion

Steam users are created with `is_admin=false` on first login. To unlock
the `/admin` panel and the manual demo upload form, you need to flip one
row in Postgres.

1. Log in once at `https://<your-vercel-url>` via Steam (so your user row
   exists in the DB).
2. Railway → Postgres service → **Data** tab (or use any Postgres client
   with the connection string). Run:

   ```sql
   UPDATE users SET is_admin = true WHERE steam_id = '<your steam id 64>';
   ```

   Your Steam ID 64 is the long number in your Steam profile URL
   (`steamcommunity.com/profiles/76561198XXXXXXXXX`).

3. Refresh the Vercel page. You should now see the **Admin** entry in
   the sidebar.

---

## 6 · Upload your first pro demo

1. Frontend → **Admin** → upload form (or the regular `/demos` page with
   the floating upload button).
2. The browser asks the API to presign an upload, PUTs the `.dem`
   **directly to R2**, then calls `/demos/{id}/finalize`, which verifies
   the object and queues `_persist_normalized` / `_persist_round_tactics`
   / `_persist_insights` in-process. (Local-FS dev has no presign, so it
   falls back to a multipart POST through the API.)
3. Parsing a 300-500 MB demo takes 3-8 minutes (single uvicorn worker,
   demoparser2 is the bottleneck — that's CS2's protobuf decoding, not
   our code). Watch the status bar in the demo card; it updates every 5 s.
4. When status flips to `completed`, the demo shows up in `/anti-strat`
   and `/vetos` immediately (the per-round tactics are computed on the
   same pass).

---

## 7 · Adding the queue later (optional, when volume grows)

The current setup parses demos inline (`QUEUE_BACKEND=inprocess`). One
uvicorn worker can only chew through one demo at a time. When that
becomes a bottleneck (say, batch-uploading 20 demos at once):

1. Add **Upstash Redis** to Railway (free tier 256 MB, plenty for a job queue).
2. Switch backend `QUEUE_BACKEND=celery` and add `REDIS_URL=<from Upstash>`.
3. Add a second Railway service running:
   ```
   celery -A workers.demo_worker worker --loglevel=info -Q demo_processing
   ```
4. The codepath is identical — `process_demo` is decorated as a Celery
   task already (see end of `workers/demo_worker.py`).

Until then: **don't bother**. Inprocess is fine for manual seeding.

---

## 8 · Troubleshooting cheat sheet

**Steam login redirects but `/auth/me` returns 401**
→ Cookie is being dropped. Confirm `ENVIRONMENT=production` is set (so
`SameSite=None; Secure` kicks in) and that `CORS_ORIGINS` exactly
matches the Vercel URL (no trailing slash, no `www` mismatch).

**Demo upload fails with `502 Bad Gateway` after 30 s**
→ Railway's edge proxy times out at 30 s by default for HTTP responses.
Demo uploads stream the body so the *upload* part is fine, but if you
see this on `/health`, the container probably crashed during boot.
Check Deploy Logs.

**"No Postgres connection pool"**
→ You used `postgresql+asyncpg://...` but the codebase uses sync
SQLAlchemy. Use `postgresql://...`.

**R2 returns 403 on upload**
→ Token doesn't have **Object Write** permission, OR the bucket name in
`S3_BUCKET` doesn't exist. R2 doesn't auto-create buckets.

**Demos parse fine but `/anti-strat` is empty**
→ Existing demos uploaded before Phase-0 don't have `team_a_name`/
`team_b_name` populated. Re-upload, or run
`apps/api/scripts/backfill_anti_strat.py` (you'd need to do this on
the Railway container, easiest via Railway's web shell).

---

## 9 · Backups (do this before you have 100 demos to lose)

- **Postgres**: Railway → Postgres service → **Backups** tab → enable
  daily snapshots. Free up to 30 days.
- **R2**: rely on R2's 11-nines durability for objects; or set up a
  rclone job to a second R2 bucket / B2 mirror if paranoid.
- **Code**: GitHub already covers this.
