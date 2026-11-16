# AI Agent Builder

AI Agent Builder turns a plain-language request into an **Agent Skill**: a small package (`SKILL.md`, a Python script,
unit tests and evaluation cases) that AI coding tools such as Claude Code, Codex and Cursor can install and use. The
Skill is written by a local model through Ollama, checked statically, executed in an isolated Docker sandbox, repaired
from its real failures, and given a status that is decided by the checks, never by the model.

![Overview](docs/screenshots/overview.png)

## Contents

[Vision](#vision) · [Problem](#the-problem) · [Features](#key-features) · [How generation works](#how-skill-generation-works) ·
[Static validation](#static-validation) · [Sandbox](#docker-sandbox) · [Repair](#automatic-repair) · [Statuses](#statuses) ·
[Limits of verification](#what-verified-does-and-does-not-mean) · [Screenshots](#screenshots) · [Architecture](#architecture) ·
[Stack](#technology-stack) · [Prerequisites](#prerequisites) · [Installation](#installation) · [Configuration](#environment-configuration) ·
[Backend](#start-the-backend) · [Frontend](#start-the-frontend) · [Tests](#run-the-tests) · [Generate and export](#generate-and-export-a-skill) ·
[API](#api-endpoints) · [Security model](#security-model) · [Demo Mode](#demo-mode) · [NAS Project Memory](#nas-project-memory-simulation) · [Limitations and roadmap](#limitations-and-roadmap) · [Repository](#repository-structure) · [License](#contributing-and-license)

## Vision

Generated code should come with evidence. A Skill that an AI tool will run on your project should say what was
checked, what passed, what failed and what was never tested, so that a person can decide whether to trust it.

## The problem

Asking a language model for "a tool that finds X in my code" gives code that looks right. Whether it runs, handles
empty input, or matches its own description is usually discovered later, on the user's machine. AI Agent Builder
moves that discovery into the build: the Skill is executed against tests and evaluation cases in a sandbox before it
is offered for export.

## Key features

- Natural-language request to a complete Skill package, with a local model (no API key, no cloud).
- Static validation of every package: structure, manifest, schemas, unsafe instructions, secrets, Python policy.
- Execution of unit tests and evaluation cases in a locked-down Docker container.
- A bounded repair loop fed with the real failures (static checks, tracebacks, failing cases).
- An objective status (`validation_failed`, `validated`, `verified`) and a full report per version.
- Studio UI: live pipeline view, code workspace, a **Skill Flow** diagram built from the real files, evaluations
  per version, export with install commands for Claude Code, Codex and Cursor. English and Japanese.
- Public **Demo Mode**: anonymous, isolated visitor sessions with limits, served from the author's machine.
- **NAS Project Memory harness (SIMULATION)**: a read-only, deterministic run of the UGREEN Skill's workflow on an
  allowlisted local folder, with cited answers and a reviewer that rejects unsupported quotes. Not a NAS connection.

## How Skill generation works

```mermaid
flowchart LR
  R[Request] --> S[Specification<br/>schemas, rules, error cases]
  S --> C[Eval cases<br/>from the spec only]
  C --> G[Code<br/>scripts/main.py]
  G --> T[Unit tests<br/>from the spec only]
  T --> V[Static validation]
  V -->|pass| X[Sandbox: tests + eval cases]
  V -->|fail| F[Repair]
  X -->|all pass| OK[verified]
  X -->|failures| F
  F --> V
  X -->|budget spent or no progress| VAL[validated]
  V -->|unrepairable| VF[validation_failed]
```

1. **Specification.** The model returns name, description, kind, instructions, `rules`, `error_cases` and JSON
   schemas for input and output. The input must carry the data itself (`{"files": {path: text}}` or a document
   string), never file paths.
2. **Evaluation cases** are written from the specification only, constrained by the real `input_schema`. When there
   are more than two, the last one is a **holdout**: the code model never sees it.
3. **Code** is written from the specification and the visible example inputs.
4. **Unit tests** are written from the specification, without seeing the code, so they cannot simply copy its bugs.
5. Static validation, sandbox execution and evaluation decide the status; the repair loop runs in between.

Every stage is persisted and shown live in the Studio. Details: [docs/skills.md](docs/skills.md).

## Static validation

Deterministic checks, no code executed (`apps/api/app/skills/validation.py`):

| Area | Checks |
|---|---|
| Structure | safe relative paths, size limits, `SKILL.md` and `manifest.json` present |
| Manifest | schema, slug, semantic version, permissions, compatibility, no external dependencies |
| Instructions | no destructive commands, piped downloads, privilege escalation or prompt-injection text in Markdown |
| Secrets | provider key formats and hard-coded credentials |
| Python | syntax, allowed imports (standard library only), forbidden calls (`eval`, `exec`, `subprocess`, `os.system`, writes…), hallucinated standard-library attributes |
| Code Skills | `run(data)` entrypoint; reads input only from `data`; ≥ 3 tests that call `run()` with real assertions; test inputs that match `input_schema`; ≥ 2 eval cases with non-empty expectations |

Static validation is defence in depth and fast feedback. It is **not** the security boundary; the sandbox is.

## Docker sandbox

Every execution of generated code is a fresh container (`apps/api/app/skills/sandbox.py`):

```text
docker run -i --rm --network none --read-only --tmpfs /tmp:size=32m
  --memory 256m --memory-swap 256m --cpus 1 --pids-limit 64
  --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges
  python:3.12-slim  timeout <N>  python -I ...
```

- No host mounts: the package is streamed in as a tar archive; the host environment is never forwarded.
- Evaluation expectations and the holdout flag never enter the container; outputs are judged on the host.
- Output is capped on the host; failures are classified (`timeout`, `memory`, `load_error`, `infrastructure`…).
- If Docker is unavailable, nothing can become `verified`.

Security model and known gaps: [docs/SECURITY.md](docs/SECURITY.md).

## Automatic repair

When a round fails, the model receives the failing checks with their how-to-fix hints, test tracebacks, and for each
failing visible eval case its input, expected and actual output (the holdout stays hidden). Rules:

- at most 3 repair rounds; stop early when two rounds fail identically or the failure cannot be fixed by code;
- tests are frozen unless the test file itself is broken, so the model cannot weaken them to pass.

## Statuses

| Status | Meaning | Exportable |
|---|---|---|
| `validation_failed` | at least one static check failed | no |
| `validated` | every static check passed; behaviour **not** proven (tests or eval cases failed, the sandbox was unavailable, or the Skill is instruction-only) | yes, with a warning |
| `verified` | code Skill, validated, and in the sandbox: ≥ 3 unit tests all passed, and every eval case (holdout included) raised no error, matched `output_schema`, was deterministic over two runs and met its expectation | yes |

## What `verified` does and does not mean

`verified` means the Skill passed **the verification suite configured for it**: its own unit tests and evaluation
cases, written by the same model from the specification. It does **not** guarantee correct behaviour for every input.

Measured example (2026-11-14, `qwen2.5-coder` 7B on CPU, independent oracle with hand-written inputs): a CSV-header
Skill was `verified` but wrong for quoted headers and header-only files, which its own tests did not cover; a TODO/FIXME
Skill was `verified` and correct on every oracle case. After the prompts asked for format edge cases, two more CSV runs
ended honestly `validated` because their tests caught the bugs. Evidence:
[docs/evidence/E2E_REAL_OLLAMA_2026-11-14.md](docs/evidence/E2E_REAL_OLLAMA_2026-11-14.md). Read the code before you run
an exported Skill.

## Screenshots

All screenshots are of the running application with real data: five human-written reference Skills and three Skills
generated by `qwen2.5-coder` on a local machine (captured 2026-11-16).

| | |
|---|---|
| **Agent Studio**: a real run, its stages and an honest `validated` outcome<br>![Agent Studio](docs/screenshots/agent-studio-real-run.png) | **Code Workspace**: files of a Skill<br>![Code Workspace](docs/screenshots/code-workspace.png) |
| **Skill Flow**: structure derived from the files; scanned items are marked approximate<br>![Skill Flow](docs/screenshots/skill-flow.png) | **Validation report**: criteria and sandbox evidence<br>![Validation](docs/screenshots/validation-report.png) |
| **Evaluations**: pass rate per version of generated Skills<br>![Evaluations](docs/screenshots/evaluations.png) | **Export**: ZIP contents and install commands<br>![Export](docs/screenshots/export.png) |
| **My Agents**: examples are labelled<br>![My Agents](docs/screenshots/my-agents.png) | **Mobile**<br>![Mobile overview](docs/screenshots/mobile-overview.png) |

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[React + TypeScript Studio]
  end
  subgraph Host[Your machine]
    API[FastAPI<br/>pipeline, validation, export]
    DB[(PostgreSQL)]
    FS[(Skill packages<br/>STORAGE_DIR)]
    OL[Ollama<br/>local model]
    DK[[Docker sandbox<br/>one container per run]]
  end
  UI -- /api --> API
  API --> DB
  API --> FS
  API --> OL
  API -- docker run --> DK
```

The Studio (`app.main`) is single-user and local-only. The public demo is a separate process (`app.demo.app`) with its
own database and storage. Design notes: [docs/architecture.md](docs/architecture.md), [docs/adr/](docs/adr/).

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query |
| Backend | Python 3.12, FastAPI, SQLAlchemy, Alembic, Pydantic |
| Database | PostgreSQL (SQLite in tests) |
| Model | Ollama, default `qwen2.5-coder:latest` |
| Sandbox | Docker, `python:3.12-slim` |
| Tests | pytest, Vitest, Playwright |

## Prerequisites

| Component | Version |
|---|---|
| Node.js / npm | 22+ / 10+ |
| [uv](https://docs.astral.sh/uv/) | recent (installs Python 3.12 and the API dependencies) |
| Docker | Docker Desktop or Engine; `docker pull python:3.12-slim` |
| [Ollama](https://ollama.com) | 0.40+, with `ollama pull qwen2.5-coder` (about 4.7 GB) |
| Hardware | 16 GB RAM recommended; a GPU makes generation much faster (CPU works, minutes per Skill) |

## Installation

```bash
git clone https://github.com/tanakaseidy3103/AI-Agent-Builder.git
cd AI-Agent-Builder
npm install                     # frontend workspace
cd apps/api && uv sync && cd ../..
docker pull python:3.12-slim
ollama pull qwen2.5-coder
```

## Environment configuration

```bash
cp .env.example apps/api/.env   # never commit it
```

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://aab:change-me@127.0.0.1:5433/aab` | Studio database |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | model server |
| `OLLAMA_API_KEY` | empty | only for a remote model server behind an authenticating proxy |
| `LLM_MODEL` | `qwen2.5-coder:latest` | model used for generation |
| `STORAGE_DIR` | `data` | where Skill packages are stored |
| `SANDBOX_IMAGE` | `python:3.12-slim` | sandbox image |
| `STUDIO_LOCAL_ONLY` | `true` | Studio routes answer loopback clients only |
| `PROJECT_MEMORY_FOLDERS` | empty (off) | `id=path;id2=path` allowlist for the NAS Project Memory SIMULATION |

Demo Mode uses `DEMO_*` variables in `apps/api/.env.demo` ([template](apps/api/.env.demo.example)).

## Start the backend

```bash
docker compose up -d db                              # PostgreSQL on 127.0.0.1:5433
cd apps/api
.venv/Scripts/python.exe -m alembic upgrade head     # macOS/Linux: .venv/bin/python
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

Run the API on the host, not in a container: it starts sandbox containers with the host's `docker` CLI.
Health: `GET /health` (liveness) and `GET /health/ready` (database, sandbox, model).
Optional: `curl -X POST http://localhost:8000/studio/reference/seed` imports the five reference Skills.

## Start the frontend

```bash
npm run dev:web                 # http://localhost:5173 (proxies /api to port 8000)
```

## Run the tests

```bash
cd apps/api && .venv/Scripts/python.exe -m pytest -q          # backend; Docker tests are skipped without Docker
cd apps/web && npx vitest run && npm run build               # frontend unit tests, type check, production build
cd apps/web && npx playwright test                            # browser tests, desktop + mobile (mocked LLM API)
cd apps/web && npm run e2e:demo                               # public Demo Mode build
cd packages/sdk-python && PYTHONPATH=. python -m pytest tests -q   # Python SDK
cd apps/api && .venv/Scripts/python.exe -u scripts/e2e_real_ollama.py   # real model + sandbox + independent oracle
```

Results on this branch, re-run 2026-11-16 with saved logs (Windows 11, Docker 29.9.2, real sandbox):

| Suite | Result |
|---|---|
| Backend (`pytest`) | 377 passed, 1 skipped (a symlink test that needs admin rights on Windows; the junction variant runs) |
| of which NAS Project Memory harness | 47 passed, 1 skipped: **mocked environment (SIMULATION), not NAS validation** |
| UGREEN Skill package | 29 passed |
| Frontend unit (Vitest) | 90 passed |
| Production build | OK |
| Playwright local, desktop + mobile (mocked LLM, real API and sandbox) | 72 passed, 0 failed, 36 skipped (opt-in real-model and screenshot tests, desktop-only tests in the mobile project) |
| Playwright Demo Mode, desktop + mobile | 16 passed, 2 skipped (opt-in UX tour) |

Python SDK: unchanged from `audit/security-hardening` (6 passed there). Details: [docs/TESTING.md](docs/TESTING.md).

Latest results and what each layer proves: [docs/TESTING.md](docs/TESTING.md).

## Generate and export a Skill

1. Open **Agent Studio**, describe the Skill (or pick an example), and choose **Create agent**.
2. Follow the stages; the run takes a few minutes with a local model.
3. Open the result: **Files**, **Flow**, **Tests**, **Validation** and **Repairs** show the evidence.
4. **Export** downloads a ZIP and shows install commands that refuse to overwrite an existing copy, for example into
   `~/.claude/skills/` (Claude Code) or `~/.agents/skills/` (Codex). Restart the tool afterwards.

Generated Skills can also be called through the local `/v1` API with an API key, or the Python SDK in
`packages/sdk-python`.

## API endpoints

| Route | Access | Purpose |
|---|---|---|
| `POST /studio/skills/plan`, `POST /studio/skills/generate`, `GET /studio/jobs/{id}` | Studio (local) | plan and generate a Skill, follow the job |
| `GET /studio/skills`, `GET /studio/versions/{id}`, `POST /studio/versions/{id}/validate` | Studio (local) | list Skills, read a version and its report, revalidate |
| `GET /studio/versions/{id}/export/{target}`, `GET /studio/versions/{id}/install/{target}` | Studio (local) | ZIP and install commands (`claude-code`, `codex`, `cursor`, `canonical`) |
| `POST /studio/api-keys`, `GET /studio/audit`, `GET /studio/evaluations` | Studio (local) | API keys, audit log, evaluation history |
| `GET /studio/agents`, `GET /studio/events`, WebSocket | Studio (local) | live pipeline roles and events |
| `GET /studio/project-memory/folders`, `POST /studio/project-memory/ask` | loopback only, off by default | NAS Project Memory SIMULATION |
| `GET /v1/skills`, `POST /v1/skills/{slug}/run`, `GET /v1/runs/{id}` | `Authorization: Bearer <API key>` | run a stored Skill in the sandbox |
| `GET /health`, `GET /health/ready` | open | liveness, readiness |

```bash
curl -X POST http://127.0.0.1:8000/v1/skills/<slug>/run -H "Authorization: Bearer <your-api-key>"      -H "content-type: application/json" -d '{"input": {}}'
```

## Security model

- Studio routes serve the local machine only and refuse cross-site browser requests; there are no user accounts.
- Generated code runs only in the Docker sandbox: no network, read-only file system, non-root, all capabilities
  dropped, CPU, memory, process and time limits. It never runs on the host.
- Static checks reject unsafe instructions, secrets and risky Python before execution (a quality gate, not a
  security boundary).
- API keys are stored hashed and can be revoked; Skill runs are logged.
- Demo Mode is a separate process with its own data and limits; it has no admin, install, `/v1` or Project Memory routes.
- Details and open risks: [docs/SECURITY.md](docs/SECURITY.md).

## Demo Mode

A visitor-safe backend (`app.demo.app`) for showing the product publicly from the author's machine:

- anonymous sessions; each visitor sees only their own jobs plus read-only examples;
- limits on prompt size, generations per session, sessions per IP, queue length and job time; one generation at a time;
- an optional access code for presentations; no admin, install or `/v1` routes in that process;
- one process can serve the built site and its API on one origin, published through a Cloudflare Quick Tunnel.

Details: [docs/DEMO.md](docs/DEMO.md), deployment options: [docs/DEPLOY.md](docs/DEPLOY.md), Windows scripts:
[deploy/homelab/](deploy/homelab/).

## NAS Project Memory (SIMULATION)

`apps/api/app/nas/` runs the read workflow of the UGREEN Skill on a local folder: Planner → Researcher (documented
read actions `ug-filesystem ls/find/cat`, `ug-knowledge collect-evidence`, served by a local adapter) → Analyst
(rules for decisions, tasks, owners, deadlines, risks, requirements, conflicts, duplicates) → Reviewer (every
confirmed claim must quote text that exists in the folder). No model call; about 15 ms on the sample project.

```bash
cd apps/api && python scripts/project_memory_sim.py   # sample project, prints a cited answer marked SIMULATION
```

**This is not a UGREEN integration.** On a NAS, the Skill runs inside Uliya and the platform experts do the work; the
Skill Kit documents no off-device API, so the `UliyaAdapter` refuses rather than pretending. Design, security model,
tests and gaps: [docs/NAS_PROJECT_MEMORY.md](docs/NAS_PROJECT_MEMORY.md).

## Limitations and roadmap

- Generated code quality depends on the local model. With 7B models on CPU, `verified` is rare (0/42 in benchmark C,
  2026-11-06) and can be wrong for untested inputs (see above). Generation takes minutes.
- The Studio has no user accounts or multi-tenant isolation; only Demo Mode may be exposed.
- Generation jobs run inside the API process; a restart interrupts them.
- Cursor support is an adapter without end-to-end evidence.

Full list: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). Roadmap: [docs/FINAL_PRODUCT_ROADMAP.md](docs/FINAL_PRODUCT_ROADMAP.md).

## UGREEN Hackathon 2026

[hackathons/ugreen-2026/](hackathons/ugreen-2026/) contains **NAS Project Memory**, a Skill written during the
UGREEN Hackathon 2026 on AI NAS in UGREEN's own Skill format (Markdown that delegates to NAS experts). It is
independent from the code in this repository and has not yet run on a NAS (finalists get one remote-access day on a
UGREEN AI NAS). The local harness above tests its read workflow in SIMULATION only.

## Repository structure

```text
apps/api/            FastAPI backend: pipeline, validation, sandbox, Studio and Demo APIs, tests
apps/api/app/nas/    NAS Project Memory SIMULATION harness (read-only, local folders)
apps/web/            React Studio, Vitest unit tests, Playwright end-to-end tests
packages/contracts/  shared JSON Schema contracts
packages/sdk-python/ Python SDK for the /v1 API
skills/reference/    five human-written reference Skills used as benchmarks and examples
deploy/              deployment templates and Windows homelab scripts
docs/                architecture, Skill format, security, testing, deployment, benchmarks, evidence
docs/screenshots/    current application screenshots used in this README
hackathons/          UGREEN Hackathon 2026 Skill and submission material
```

## Contributing and license

Issues and pull requests are welcome; please run the tests above before opening one. This repository does not yet
have a licence file, so all rights are reserved by the author until one is added.
