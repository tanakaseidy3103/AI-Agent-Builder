# Deployment

Status (2026-11-14): **not deployed.** No hosting account, domain or credential is configured in this repository.
Everything needed is prepared (this page, [`deploy/`](../deploy), the production image); the owner chooses where it runs.

Scope: publish the **public Demo** only. The Studio stays local and private until it has accounts and multi-user
isolation.

## What may be public, and what never

| Process | Public? | Why |
|---|---|---|
| Static frontend (demo build) | **yes** | no secrets; talks to the demo API only |
| `app.demo.app` (Demo Mode, `/demo/*`) | **yes**, behind HTTPS | anonymous sessions, per-visitor isolation, limits, its own database and storage ([DEMO.md](DEMO.md)) |
| `app.main` (Studio, `/studio/*`, `/v1/*`) | **never** | single-user and unauthenticated by design (trusts loopback). Not even present in the demo process |
| PostgreSQL, the Studio port 8000 | **never** | internal |
| Ollama (11434) | **never directly** | no authentication of its own; remote access only through a private network or the authenticating proxy below |
| Docker / the sandbox | **never** | each validation is a local `docker run`; the Docker socket is never given to the frontend or exposed |

## Recommended architecture

```
                     ┌──────────────────────────── Backend machine (Linux VM, Docker) ────────────────────────┐
Browser ──HTTPS──> static frontend          cloudflared / HTTPS proxy ──> uvicorn app.demo.app  127.0.0.1:8100
   │               (Cloudflare Pages)               ▲                        │   systemd: deploy/aab-demo.service
   └──HTTPS (CORS: exact origin) ───────────────────┘                        ├─> PostgreSQL 127.0.0.1:5434 (volume)
                                                                             ├─> docker run python:3.12-slim (sandbox)
                                                                             └─> OLLAMA_BASE_URL ──┐
                     └──────────────────────────────────────────────────────────────────────────────┼─────┘
                                       same machine (profile local-model)   or   remote model machine:
                                                                           Caddy (Bearer key) ─> Ollama 127.0.0.1:11434
```

- **Frontend:** `npm run build` with `VITE_DEMO_MODE=true` and `VITE_API_BASE=https://api.<domain>`; upload
  `apps/web/dist` (includes `_headers` with basic security headers). No model, no secret in the browser.
- **Demo API:** one uvicorn process (queue, limits and rate limiter live in it), bound to 127.0.0.1, behind a
  Cloudflare named tunnel ([`deploy/cloudflared.example.yml`](../deploy/cloudflared.example.yml)) or an HTTPS reverse
  proxy. Runs on the host, not in a container, because each validation starts a sandbox container with the host's
  `docker` CLI ([`deploy/aab-demo.service`](../deploy/aab-demo.service)).
- **PostgreSQL:** persistent volume, host-only port ([`deploy/docker-compose.demo.yml`](../deploy/docker-compose.demo.yml)).
- **Sandbox:** unchanged isolation: no network, read-only root, uid 65534, all capabilities dropped, 256 MB, 1 CPU,
  64 PIDs, wall-clock timeout; at most `DEMO_SANDBOX_CONCURRENCY` (2) at a time.
- **Model:** Ollama on the same machine (`--profile local-model`) or on a separate model machine (GPU) reached through
  [`deploy/ollama-proxy.Caddyfile.example`](../deploy/ollama-proxy.Caddyfile.example): HTTPS + `Authorization: Bearer`,
  only `/api/chat`, `/api/tags`, `/api/ps` forwarded. The API sends the key when `OLLAMA_API_KEY` is set (tested
  2026-11-14 against this machine's Ollama: no key/wrong key → 401, right key → models listed and a chat answered).
  Ollama unloads the model when idle (`OLLAMA_KEEP_ALIVE`); the web process never holds it.
- **Generation limits (already implemented):** one generation at a time, queue of 5 (HTTP 429 + `Retry-After`),
  3 per visitor session, 5 new sessions per IP per hour, prompt ≤ 1000 characters, body ≤ 64 KB, 20-minute deadline
  per job; when the model is unreachable the API answers 503 before queueing and the UI says so.
- **Examples:** the five reference Skills are seeded once, on the first start against an empty database (about 7 s on
  an idle machine; each is validated in the sandbox). Later starts only check that they exist. They are labelled
  "Example" in the UI, so they are never mistaken for generated results.

## Configuration

One environment file for the service, `/etc/aab/demo.env` (mode 600, never committed), built from
[`apps/api/.env.demo.example`](../apps/api/.env.demo.example) plus:

| Variable | Production value |
|---|---|
| `DEMO_DATABASE_URL` | `postgresql+psycopg://aab:<password>@127.0.0.1:5434/aab_demo` (name must contain `demo`) |
| `DEMO_STORAGE_DIR` | `/opt/aab/apps/api/data-demo` (must differ from the Studio's `data/`) |
| `DEMO_ALLOWED_ORIGINS` | the exact frontend origin, e.g. `https://<project>.pages.dev` (never `*`) |
| `DEMO_ALLOWED_HOSTS` | `api.<domain>` only |
| `DEMO_MODEL` and limits | as in the example; lower `DEMO_GENERATIONS_PER_SESSION` / `DEMO_QUEUE_MAX` on a weak host |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` (same machine) or `https://model.<domain>` (remote, behind the proxy) |
| `OLLAMA_API_KEY` | empty for a local model; a long random value shared with the proxy for a remote one |
| `SANDBOX_IMAGE` | `python:3.12-slim` (pull it once) |

The demo is a **demonstration** configuration (anonymous, data deleted after `DEMO_DATA_TTL_HOURS`). Never point it at
the Studio's database or storage (the app refuses).

## Hosting options and costs (prices checked 2026-11-14; confirm on each provider's page before buying)

Nothing has been contracted. Prices below come from third-party price trackers and provider pages found that day,
they change often (Hetzner raised cloud prices twice in 2026), and VAT may not be included.

| Option | What runs where | Cost basis | Generation speed | Notes |
|---|---|---|---|---|
| A. Owner's laptop + tunnel | everything on the laptop | free (electricity) | measured: 3–18 min per Skill (CPU) | depends on the laptop being on; the owner wants to avoid this |
| B. One ARM VM, model on CPU | Hetzner CAX line, e.g. CAX31/CAX41 | CAX from €5.99/month (CAX11, 2 vCPU, 4 GB) to €40.99 (CAX41, 32 GB) [1][2] | **not measured** on ARM; expect minutes per Skill, like the laptop or slower | cheapest always-on option that fits the 7B model (needs ≥ 8 GB RAM; 16 GB comfortable) |
| C. Small VM + GPU on demand | API/DB/sandbox on a small VM (e.g. CAX11); Ollama on a rented GPU behind the Caddy proxy | VM ≈ €6/month + GPU by the hour: RunPod RTX 4090 ≈ $0.34/h community, $0.89/h secure [3] (≈ $250/month if left on 24/7) | **not measured**; a GPU is expected to be much faster than CPU | best for scheduled demos (hackathon, interviews): start the GPU only for the session |
| D. Oracle Cloud Always Free (Ampere A1) | everything on one free ARM VM | free; allowance reportedly cut in 2026 to 2 OCPU / 12 GB (sources disagree on the date) [4] | **not measured**; 2 cores will be slow | capacity is often unavailable and over-limit instances can be stopped: not reliable for a public demo |
| Frontend (all options) | Cloudflare Pages | free plan: 500 builds/month, bandwidth advertised as unlimited [5] | — | upload `dist/` via the dashboard (no CLI needed) |
| Domain (options B–D) | for a named tunnel / HTTPS hostname | registrar price, not checked | — | a Quick Tunnel needs no domain but its URL changes on every restart |

Sources: [1] [Hetzner price changes 2026, Northflank](https://northflank.com/blog/hetzner-cloud-server-price-increases),
[2] [Hetzner Cloud pricing 2026, devshot](https://devshot.co/blog/hetzner-cloud-pricing),
[3] [RunPod GPU pricing, Northflank](https://northflank.com/blog/runpod-gpu-pricing),
[4] [Oracle Always Free resources (official)](https://docs.oracle.com/iaas/Content/FreeTier/resourceref.htm) and
[InfoQ, 2026-07](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/),
[5] [Cloudflare Pages limits (official)](https://developers.cloudflare.com/pages/platform/limits).

**Recommendation:** option **C** for a public demo that must not depend on the laptop and is shown at known times
(hackathon, interviews): the always-on part is a cheap VM; the GPU runs only while needed. Option **B** if the demo
must accept generations at any time and slow generation is acceptable. In both, measure one real generation on the
chosen machine before announcing the URL (`apps/api/scripts/e2e_real_ollama.py`).

## Requirements of the backend machine

- Linux x86-64 or ARM64 with Docker Engine; `python:3.12-slim` and (option B) `ollama/ollama` have both architectures.
- RAM: ~1 GB for API + PostgreSQL + sandbox (measured: API 95 MB, sandbox peak 21 MB per run); **+ ~6 GB** if the
  model runs on the same machine (qwen2.5-coder 7B Q4_K measured at ~5.5 GB loaded).
- Disk: ~10 GB (images, model 4.7 GB, database, packages, backups).
- Dedicated to the demo: it runs untrusted generated code in Docker, and the service user is in the `docker` group
  (root-equivalent). Never the owner's personal machine for a long-running public demo.

## Database, backups

- Demo tables are created on start (`create_all`) in their own database. Visitor data expires after 24 h; a schema
  change is applied by recreating the demo database (the examples are re-seeded on the next start).
- Studio (local only): `alembic upgrade head`.
- Backups: [`deploy/backup.sh`](../deploy/backup.sh) daily from cron: `pg_dump -Fc` + the storage folder, 7 days kept;
  copy them off the machine. Restore commands are in the script header.

## Health, logs, operation

| Endpoint | Meaning |
|---|---|
| `GET /health` | liveness: the process answers |
| `GET /health/ready` | readiness: `{"status": "ready" \| "degraded" \| "down", "checks": {"database", "sandbox", "model"}}`; HTTP 503 only when the database is down. Booleans only, cached 10 s |
| `GET /demo/status` | what the UI shows: model ready, queue length, limits |

- Logs: systemd journal (`journalctl -u aab-demo`). Visitor-facing errors and live events are stripped of internal
  URLs and paths (fixed 2026-11-14: stage details and events used to carry the model server's address). Sandbox
  containers use `--log-driver none`; their output is captured into the stored report.
- A restart marks running jobs as failed ("interrupted"). Docker unavailable → validations report `unavailable` and no
  Skill can become `verified`.

## Measured resource use (2026-11-14, Windows 11 laptop, 16 logical CPUs, 28 GB RAM, CPU inference)

| What | Measured |
|---|---|
| API process (idle → after 270 requests) | 95 MB → 94 MB RSS (no growth) |
| API latency (local, 20 requests each) | p50 1–10 ms, p95 ≤ 11 ms for health, lists, version detail, file, ZIP export |
| API response sizes | 0.1–8 KB JSON; ZIP export 5 KB for a reference Skill |
| API cold start to first `/health` | 1.3 s; production image (non-root) idle: 68 MB |
| `/health/ready` | 2.2 s uncached (Docker + model probes), then served from a 10 s cache |
| Sandbox run (unit tests or eval cases) | 0.6 s per container; peak memory inside 21 MB of the 256 MB limit |
| Model (`qwen2.5-coder`, 7.6B Q4_K) | ~5.5 GB RAM while loaded; unloaded by Ollama when idle; 5.7–6.5 generated tokens per model second |
| One Skill generation | 3–18 minutes (4–5 model calls, up to 1 repair round) |
| Frontend | 136 KB gzip main JS + 9 KB CSS; the Skill Flow tab (12 KB gzip) loads only when opened |

The bottleneck is model inference; the API, database and sandbox are small.

## Production image

`apps/api/Dockerfile` (used by the local `docker-compose.yml`): runs as an unprivileged user (uid 10001), writes only
to `/data`, starts uvicorn from the virtualenv, has a `HEALTHCHECK` on `/health/ready`. `.dockerignore` keeps `.env`,
`.env.demo` and Skill data out of the image (before 2026-11-14 they were copied in). Verified by a test build:
`uid=10001(app)`, no `.env`, `/app` not writable, container healthy. The image has no Docker CLI, so inside it the
sandbox reports `unavailable`: it suits the Studio container; the public demo runs on the host as described above.

## Known gaps before a public deploy

- The model's output quality: a generated Skill can be `verified` and still wrong for inputs nobody tested
  ([evidence](evidence/E2E_REAL_OLLAMA_2026-11-14.md)). The UI and docs must keep saying what `verified` means.
- Generation speed on the chosen machine is not measured yet (options B–D).
- Rate limits are per process and in memory: they reset on restart, and a single worker is required.
- No CAPTCHA; rotating IPs bypass the per-IP limits ([DEMO.md](DEMO.md)).
- A Docker escape on the backend machine reaches that machine: keep it dedicated.

## Publish steps (once the owner has chosen the option)

1. **Machine:** create the Linux VM (option B or C). Install Docker Engine. `git clone` the repository to `/opt/aab`.
   Create user `aab` (in group `docker`). `cd /opt/aab/apps/api && uv sync --frozen --no-dev`.
   `docker pull python:3.12-slim`.
2. **Database (+ local model):** create `deploy/demo.env` with a strong `POSTGRES_PASSWORD`;
   `docker compose -f deploy/docker-compose.demo.yml --env-file deploy/demo.env up -d`
   (add `--profile local-model`, then `docker compose … exec ollama ollama pull qwen2.5-coder:latest` for option B).
3. **Remote model (option C):** on the GPU machine run Ollama on 127.0.0.1 and Caddy with
   `deploy/ollama-proxy.Caddyfile.example` and a random `OLLAMA_PROXY_KEY`; pull the model there.
4. **Service:** write `/etc/aab/demo.env` (table above, mode 600), install `deploy/aab-demo.service`,
   `systemctl enable --now aab-demo`. Check `curl -s 127.0.0.1:8100/health/ready` → `ready`.
5. **Ingress:** named tunnel (`deploy/cloudflared.example.yml`) or HTTPS proxy to `127.0.0.1:8100`, hostname
   `api.<domain>`. Nothing else is exposed (check with an external port scan of the VM).
6. **Frontend:** `cd apps/web && VITE_DEMO_MODE=true VITE_API_BASE=https://api.<domain> npm run build`; create the
   Pages project and upload `dist/`. Put the Pages origin in `DEMO_ALLOWED_ORIGINS`; restart the service.
7. **Verify from outside:** `/health/ready` = ready; the site opens and creates a session; the five examples are
   listed; one real generation completes and is validated in the sandbox; the ZIP downloads; `/studio/*`, `/v1/*`,
   `/docs` answer 404; a foreign origin gets no CORS grant; the model URL never appears in the browser.
8. **Operate:** cron `deploy/backup.sh`; watch `journalctl -u aab-demo`; stop the GPU (option C) after the session.
