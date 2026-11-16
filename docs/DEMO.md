# Public Demo Mode

A separate, visitor-safe backend for a free public demo:
- Frontend on Cloudflare Pages.
- Backend on the author's machine.
- Exposed through a Cloudflare Quick Tunnel.

**Local mode is unchanged**: `app.main` with `/studio/*` and `/v1/*` never goes through the tunnel.

Status: implemented and tested locally. **Not deployed.** Tunnel and Pages publication are later steps that need the
owner's approval.

## Design

| | Local mode (unchanged) | Demo Mode |
|---|---|---|
| Process | `uvicorn app.main:app --port 8000` | `uvicorn app.demo.app:app --host 127.0.0.1 --port 8100` |
| Routes | `/studio/*`, `/v1/*`, office, `/health` | `/demo/*` and `/health` only. The admin routes **do not exist** in this process |
| Database | `aab` | `aab_demo`. It refuses to start unless the database name contains `demo` |
| Storage | `data/` | `DEMO_STORAGE_DIR` (e.g. `data-demo/`), required |
| Who | the owner, loopback only | anonymous visitors, each with a session token (`X-Demo-Session`; only its SHA-256 is stored) |
| Data visibility | everything | own jobs and Skills only, plus read-only examples (the reference Skills) |

Not available in the demo, by design:
- install into a project, folder analysis;
- API keys, the audit log;
- deleting, seeding;
- plan review, model choice;
- `/v1`, the event WebSocket, `/docs`.

### Limits (environment variables, `apps/api/.env.demo.example`)

| Variable | Default | What it bounds |
|---|---|---|
| `DEMO_MAX_PROMPT_CHARS` | 1000 | request length |
| `DEMO_MAX_REQUEST_BYTES` | 64000 | any HTTP body (413) |
| `DEMO_MAX_CONCURRENT_GENERATIONS` | 1 | model use (worker threads) |
| `DEMO_QUEUE_MAX` | 5 | waiting + running generations (429) |
| `DEMO_GENERATIONS_PER_SESSION` | 3 | per visitor |
| `DEMO_SESSIONS_PER_IP_PER_HOUR` | 5 | new visitor sessions per IP |
| `DEMO_RATE_LIMIT_PER_MINUTE` | 240 | requests per IP and per session (polling is about 2 per second during a run) |
| `DEMO_SANDBOX_CONCURRENCY` | 2 | concurrent "run tests again" (429 when busy) |
| `DEMO_JOB_TIMEOUT_S` | 1200 | wall clock per generation; later model calls are refused and the job fails clearly |
| `DEMO_DATA_TTL_HOURS` | 24 | sessions and their Skills are deleted afterwards (hourly cleanup) |
| `DEMO_MODEL` | qwen2.5-coder:latest | the only model the demo uses |

Network settings:
- CORS: `DEMO_ALLOWED_ORIGINS`, exact origins only; `*` is refused at startup.
- Host allowlist: `DEMO_ALLOWED_HOSTS` (default `*.trycloudflare.com,localhost,127.0.0.1`).

Visitor IP:
- The demo listens on 127.0.0.1 only. Its only direct client is `cloudflared`.
- uvicorn's default proxy-header handling (trusting 127.0.0.1) turns the tunnel's `X-Forwarded-For` into the
  visitor's address.
- **Do not** set `FORWARDED_ALLOW_IPS=*` and do not bind `0.0.0.0`. Otherwise visitors could forge their IP and evade the
  per-IP limits.

### Frontend (build time)
- `VITE_API_BASE`: backend URL. Default `/api` (local Vite proxy).
- `VITE_DEMO_MODE=true`:
  - maps `/studio/*` calls to `/demo/*`;
  - creates the visitor session;
  - hides Projects, API keys, the plan review, install commands, publishing and deletion;
  - downloads ZIPs through `fetch`;
  - shows a banner with the connection state: ready / model unavailable / queue full / server offline.
- Nothing secret is in the bundle. Checked: the only matches are help text naming an environment variable.

## Run locally

Local mode, as before:

```powershell
docker compose up -d db
cd apps\api; .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
npm run dev:web      # repository root → http://localhost:5173
```

Demo Mode on this machine (no tunnel, no deploy):

```powershell
# once: a separate database (does not touch "aab")
docker exec ai-agent-builder-db-1 createdb -U aab aab_demo
copy apps\api\.env.demo.example apps\api\.env.demo   # then edit: password, DEMO_ALLOWED_ORIGINS=http://127.0.0.1:4173

# backend (Ollama and Docker running for real generations)
cd apps\api; .venv\Scripts\python.exe -m uvicorn app.demo.app:app --host 127.0.0.1 --port 8100

# frontend as it would be published (another terminal, apps\web)
$env:VITE_DEMO_MODE = "true"; $env:VITE_API_BASE = "http://127.0.0.1:8100"
npx vite build --outDir dist-demo --emptyOutDir; npx vite preview --outDir dist-demo --host 127.0.0.1 --port 4173
# open http://127.0.0.1:4173
```

## Tests

```powershell
cd apps\api; .venv\Scripts\python.exe -m pytest tests/test_demo.py   # demo backend (50 tests)
cd apps\api; .venv\Scripts\python.exe -m pytest                      # everything
cd apps\web; npx vitest run                                          # includes src/demo.test.ts
cd apps\web; npm run e2e:demo                                        # demo build + demo backend (MOCKED LLM), desktop + mobile
cd apps\web; npx playwright test                                     # local-mode suite, unchanged
```

`npm run e2e:demo` starts `apps/api/scripts/demo_mock_server.py`. That is the real demo application with a **mocked
LLM** and the real Docker sandbox, on SQLite under `test-results/demo-mock/`. It is not evidence of real-model quality.

## Remaining risks (read before publishing)
- **The host is the server.** Visitor-generated code runs in Docker on the owner's machine. The sandbox has no network,
  a read-only filesystem, an unprivileged user, no capabilities, memory/CPU/PID limits and a timeout. A container or VM
  escape would still compromise the machine. Keep the system updated, avoid personal data on that account, and run the
  demo only when wanted.
- **Downloaded ZIPs run outside any sandbox** on the visitor's computer. The UI says so.
- **`verified` can be gamed** by a crafted prompt: Skill code shares a process with its unit tests (see
  `docs/SECURITY.md`).
- **Abuse:** limits are per IP and per session. Rotating IPs bypasses them. There is no CAPTCHA.
- **Quick Tunnel:** a random URL that changes on every restart (the frontend must be rebuilt); meant for testing, with no
  uptime guarantee. Confirm the current limits in Cloudflare's documentation before publishing.
- **Availability:** generation takes minutes on a CPU-only laptop and runs one at a time. When the laptop sleeps, the
  demo is offline (the UI says so).
