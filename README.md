# AI Agent Builder

> **Create once. Reuse anywhere.**

Describe an AI agent in plain language. AI Agent Builder generates a reusable, tested Skill package — with its own code, tests, and evaluation cases — that installs into Claude Code, Codex, or Cursor with one command.

就職作品 — HAL名古屋 · 日本語の手順: [docs/ja/QUICKSTART.md](docs/ja/QUICKSTART.md)

![Agent Studio — desktop view (English)](docs/evidence/screenshots/final-studio-start.png)

---

## What problem does this solve?

When you use multiple AI coding assistants (Claude Code, Codex, Cursor), you re-describe the same capability in each one. There is no standard way to package an agent capability once and reuse it everywhere.

AI Agent Builder generates **Skills** — self-contained packages with a clear interface, real tests, and an evaluation suite. A Skill you generate once exports to any supported coding agent. If it fails, the platform tells you exactly why, and tries to repair it automatically.

---

## Who should use this?

- **Developers** who want to standardize repeated agent capabilities across tools
- **Teams** building internal tooling with AI coding agents
- **Anyone learning** how reliable AI code generation and verification actually work

---

## What makes it different?

| Other tools | AI Agent Builder |
|---|---|
| "The AI generated this" — no verification | Deterministic AST checks + sandbox execution before any claim of quality |
| Black-box generation | 10 persisted pipeline stages; you see every step |
| Agent definition locked to one tool | ZIP export + install commands for Claude Code, Codex, Cursor |
| Vague quality signals | `validated` = every static check passed; `verified` = all unit tests + eval cases passed in Docker |
| Repair is manual | Bounded repair loop feeds the exact failure (input, expected, actual) back to the model |

**Honest limitation:** with 7-billion-parameter local models (qwen2.5-coder, llama3.2:3b), the platform generates structurally valid Skills (`validated`) but does not yet produce `verified` ones consistently (0/42 in Benchmark C). The 5 human-written reference Skills pass the same checks. See [docs/benchmarks/PHASE1_ANALYSIS.md](docs/benchmarks/PHASE1_ANALYSIS.md).

---

## Main features

- **10-stage generation pipeline** — analyze → specify → plan → generate → validate → test generation → sandbox tests → evaluate → report → package; every stage is persisted so a restart doesn't lose progress
- **Bounded repair loop** — feeds real failure details (traceback, expected vs actual) back to the model; stops when no progress is detected, never loops forever
- **Docker sandbox** — generated code runs with no network, read-only filesystem, unprivileged user, CPU/memory/PID limits, and a wall-clock timeout; the host process never executes generated code directly
- **Deterministic validation** — 20 AST-based checks (forbidden imports, hallucinated stdlib APIs, hardcoded secrets, unsafe instructions) with no LLM in the verdict
- **Objective quality signals** — `validated` / `verified` are computed by the validator, never by the model itself; a hidden holdout eval case prevents the model from special-casing visible inputs
- **Export to anything** — ZIP, Claude Code install command, Codex install command, Cursor install command; tested end-to-end for Claude Code and Codex
- **Bilingual UI** — full English and Japanese (444 keys each, 100% parity)
- **Public `/v1` API + Python SDK** — call any validated Skill from external applications

---

## How the generation pipeline works

```
User prompt
    │
    ▼
[1] analyze     Planner: LLM interprets the request → structured spec (JSON Schema constrained)
[2] specify     Planner: build Manifest (id, version, kind, permissions, input/output schemas)
[3] plan        Planner: enumerate all files to generate
    │
    ▼
[4] generate_files  Developer: LLM writes scripts/main.py, generates eval cases from spec
[5] test_generation Tester: LLM writes tests/test_main.py from the spec (not from the code)
    │
    ▼  ┌─────── repair loop (up to 3 rounds) ──────┐
[6] static_validation  Reviewer: 20 deterministic AST checks  │
[7] sandbox_tests      Tester: run unit tests in Docker        │
[8] evaluate           Tester: run eval cases in Docker        │
    │  if failures and progress: → back to [4] ───────────────┘
    ▼
[9] report      Reviewer: collect results, record repair history
[10] package    Builder: write Skill to storage, store status
```

The model never decides the status. Only the deterministic validator does.

---

## Architecture

```
apps/web/          React + TypeScript + Vite + Tailwind + TanStack Query
                   Agent Studio: Chat (38%) | Agent Office + Pipeline (62%)
                   Bilingual (EN/JA), mobile-ready, light theme

apps/api/          FastAPI + Python 3.12 + SQLAlchemy + Alembic + Postgres
                   Pipeline, sandbox, validation, auth, export, audit log

packages/contracts/  Shared JSON Schema contracts (TypeScript + Pydantic mirror)
packages/sdk-python/ Python SDK for calling Skills via /v1 API (stdlib only, Python ≥ 3.8)

skills/reference/  5 human-written benchmark Skills (all pass `verified`)
                   python-code-analyzer · laravel-bug-analyzer · api-test-planner
                   react-accessibility-analyzer · project-documentation-generator
```

Security boundary: generated code runs **only** in Docker (`--network none`, `--read-only`, uid 65534, `--cap-drop ALL`, `--security-opt no-new-privileges`, 256 MB RAM, 1 CPU, 64 PID limit). See [docs/SECURITY.md](docs/SECURITY.md).

---

## Technologies

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | Type-safe, fast dev loop |
| Styling | Tailwind CSS v4 (`@theme` tokens) | Single CSS cascade for all 16 color tokens; light/dark switch = 1 file |
| State | TanStack Query | Server-state polling without a WebSocket; survives reconnects |
| Backend | FastAPI + Python 3.12 | Async, type-annotated; `datetime.UTC` and new type hints require ≥3.12 |
| Database | PostgreSQL + SQLAlchemy + Alembic | Relational history; reproducible migrations |
| LLM | Ollama (local) | No API key required; swappable via `LLM_MODEL` env var |
| Sandbox | Docker (`python:3.12-slim`) | Strongest isolation available without a VM |
| Validation | stdlib `ast` | Deterministic, no network, no LLM bias |
| Auth | SHA-256 hashed API keys | Never store plaintext; revocable per key |
| i18n | Custom hook `useT()` | 444 EN = 444 JA keys; parity enforced by Vitest |

---

## Requirements

| Component | Version | Notes |
|---|---|---|
| Node.js | 22+ | For the frontend dev server and Vitest |
| npm | 10+ | Included with Node.js 22 |
| [uv](https://docs.astral.sh/uv/) | latest | Manages Python 3.12 and all API dependencies |
| Docker Desktop | 29+ | Required for Postgres and the sandbox; `docker pull python:3.12-slim` |
| [Ollama](https://ollama.com) | 0.40+ | Local LLM server |
| GPU (recommended) | ≥6 GB VRAM | qwen2.5-coder:latest (7B); works on CPU but generation is much slower |
| OS | Windows 11 / macOS / Linux | Tested on Windows 11 Pro |

---

## Installation — Windows

### 1. Clone the repository

```bash
git clone https://github.com/tanakaseidy3103/AI-Agent-Builder.git
cd AI-Agent-Builder
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Install backend dependencies

```bash
cd apps/api
uv sync          # creates .venv with Python 3.12 and all packages
cd ../..
```

### 4. Configure environment

```bash
cp .env.example apps/api/.env
# Edit apps/api/.env if you need a non-default Postgres password or model
```

Default `apps/api/.env`:
```
DATABASE_URL=postgresql+psycopg://aab:change-me@127.0.0.1:5433/aab
OLLAMA_BASE_URL=http://localhost:11434
LLM_MODEL=qwen2.5-coder:latest
STORAGE_DIR=data
SANDBOX_IMAGE=python:3.12-slim
RATE_LIMIT_PER_MINUTE=30
```

### 5. Start Postgres

```bash
docker compose up -d db        # starts Postgres on 127.0.0.1:5433
```

### 6. Run database migrations

```bash
cd apps/api
.venv\Scripts\python.exe -m alembic upgrade head
cd ../..
```

### 7. Pull the sandbox image

```bash
docker pull python:3.12-slim
```

### 8. Start Ollama and pull the model

```bash
ollama serve                            # keep this running in a terminal
ollama pull qwen2.5-coder               # ~4 GB download
```

### 9. Start the backend

```bash
cd apps/api
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
# API is now on http://localhost:8000
```

The API must run on the **host** (not in a Docker container) so it can call the Docker CLI for the sandbox.

### 10. Start the frontend

In another terminal:

```bash
npm run dev:web
# Studio opens at http://localhost:5173
```

### 11. (Optional) Seed reference Skills

```bash
curl -X POST http://localhost:8000/studio/reference/seed
```

This imports the 5 human-written reference Skills. They all pass `verified` and are useful as benchmarks and examples.

---

## How to create an Agent

1. Open http://localhost:5173 and go to **Studio**.
2. Type a plain-language description in the prompt box. Example:
   > "Create an agent that reads Python files, finds lines with TODO or FIXME comments, and reports file and line number."
3. Click **Generate**. The Agent Office shows the pipeline progressing in real time.
4. When generation completes, inspect the **Validation** tab for the status and any failures.
5. The **Files** tab shows the generated source code.

**Status meanings:**

| Status | What it means |
|---|---|
| `validated` | All 20 static checks passed. No dangerous code, no hardcoded secrets, correct structure. |
| `verified` | `validated` **and** ≥3 unit tests all passed **and** all eval cases passed in the Docker sandbox. |
| `validation_failed` | At least one static check failed. The Validation tab shows what failed and how to fix it. |

---

## How to test a generated Agent

The **Validation** tab shows the sandbox test results. Each unit test and eval case is listed with pass/fail status.

To run the tests yourself outside the platform (for a code Skill):

```bash
# From the extracted ZIP or the data/skills/<id>/ directory:
cd <skill-directory>
# Run unit tests (requires the scripts/ directory on the Python path):
python -c "
import sys; sys.path.insert(0, 'scripts')
import importlib.util, unittest
spec = importlib.util.spec_from_file_location('test_main', 'tests/test_main.py')
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(mod))
"
```

---

## How to export and use an Agent

### Export from the Studio

1. After a successful generation, click the **Export** tab.
2. Click **Download ZIP** to get the full package.
3. Click **Copy install command** next to your preferred coding agent.

### Install in Claude Code

```bash
claude skill install ./my-skill.zip
```

Or use the generated command from the Export tab (includes the correct path).

### Install in Codex

```bash
codex skill install ./my-skill.zip --root ~/.agents/skills
```

### Use from the Python SDK

```python
from agent_builder import SkillClient

client = SkillClient(base_url="http://localhost:8000", api_key="aab_your_key_here")
result = client.run("python-code-analyzer", {"files": {"main.py": open("main.py").read()}})
print(result)
```

### Use from the `/v1` API

Create an API key in Studio → Settings, then:

```bash
curl -X POST http://localhost:8000/v1/skills/python-code-analyzer/run \
  -H "Authorization: Bearer aab_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"files": {"main.py": "import os\ndef run(): pass\n"}}'
```

---

## Supported integrations

| Integration | Implementation | End-to-end tested | Evidence |
|---|---|---|---|
| ZIP export | ✅ | ✅ | `docs/evidence/e2e-claude-code-20261106-091520.json` |
| Claude Code | ✅ | ✅ | `docs/evidence/e2e-claude-code-20261106-091520.json` |
| Codex | ✅ | ✅ | `docs/evidence/e2e-codex-20261106-091557.json` |
| Cursor | ✅ adapter | ⚠️ adapter only, not E2E tested | No E2E evidence exists |
| Python SDK | ✅ | ✅ used in Codex E2E | `packages/sdk-python/` |
| JavaScript SDK | ❌ | ❌ | Not implemented |

---

## Running tests

```bash
# Backend (requires Docker running for real sandbox tests)
cd apps/api
.venv\Scripts\python.exe -m pytest -q        # 184 tests

# Frontend unit tests + build
cd apps/web
npx vitest run                                # 30 tests
npm run build                                 # TypeScript check + production build

# Python SDK
cd packages/sdk-python
PYTHONPATH=. ../../apps/api/.venv/Scripts/python.exe -m pytest tests/ -q

# Reference Skills (run their own tests independently)
cd skills/reference/python-code-analyzer
python -c "
import sys; sys.path.insert(0, 'scripts')
import importlib.util, unittest
spec = importlib.util.spec_from_file_location('test_main', 'tests/test_main.py')
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromModule(mod))
"
```

Full test documentation: [docs/TESTING.md](docs/TESTING.md)

---

## Security model

See [docs/SECURITY.md](docs/SECURITY.md) for the complete security model.

**Key controls:**

- Generated code runs **only** in Docker with no network, read-only filesystem, unprivileged user (uid 65534), all capabilities dropped, 256 MB RAM limit, 64 PID limit, and a wall-clock timeout.
- The host process never executes generated code directly.
- Result integrity: the sandbox runner writes one marked JSON line then immediately calls `os._exit()`, preventing any generated code from forging test results.
- Path traversal prevention: all package paths go through `safe_relpath()` with an allowlist.
- Secret detection: 6 provider-format patterns + generic assignment check on all generated files.
- API keys stored as SHA-256 hashes, never plaintext.
- Studio accessible from localhost only (loopback + Host header check prevents DNS-rebinding).

---

## Known limitations

See [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for the full list.

**Key limitations:**

- **0/42 generated code Skills reach `verified`** with the local 7B models tested. The validator is correctly calibrated (the 5 reference Skills pass); the models' code quality is insufficient. A larger model (14B+) would likely improve this. (Benchmark C, 2026-11-06)
- **Pipeline roles are not autonomous agents.** The Agent Office shows five real pipeline stages. "Researcher" and "Security reviewer" are shown as planned but do not exist.
- **Single-user, local-only.** No accounts, no tenant isolation. The Studio is protected by a loopback check only. Required before any shared deployment.
- **Background generation is in-process.** Restarting the API abandons running jobs.
- **Sandbox requires Docker on the host.** The API container cannot run the sandbox.

---

## Screenshots

| View | Screenshot |
|---|---|
| Studio (desktop, English) | [final-studio-start.png](docs/evidence/screenshots/final-studio-start.png) |
| Studio (desktop, validated result) | [final-studio-run-validated.png](docs/evidence/screenshots/final-studio-run-validated.png) |
| Studio (mobile, Japanese) | [final-mobile-ja-studio.png](docs/evidence/screenshots/final-mobile-ja-studio.png) |
| Agent Office live | [office-live.png](docs/evidence/screenshots/office-live.png) |
| Overview page (desktop) | [final-overview.png](docs/evidence/screenshots/final-overview.png) |
| Evaluations page | [final-evaluations.png](docs/evidence/screenshots/final-evaluations.png) |

Demo plan and 90-second walkthrough script: [docs/DEMO_PLAN.md](docs/DEMO_PLAN.md)

---

## Roadmap

See [docs/FINAL_PRODUCT_ROADMAP.md](docs/FINAL_PRODUCT_ROADMAP.md) for the full roadmap.

**Planned for Phase 2:**
- Try a 14B+ local code model (qwen2.5-coder:14b, requires ≥12 GB VRAM) to improve the verified rate
- Spec-first test generation (write tests from the spec before writing code)
- Smaller, single-rule tasks to increase the probability of verified output
- User accounts and tenant isolation (required before any shared deployment)
- GitHub integration and hosted deployment option
- JavaScript SDK

---

## Documentation

| Document | Language | Content |
|---|---|---|
| [docs/skills.md](docs/skills.md) | English | Package format, pipeline, statuses, export, API, SDK |
| [docs/SECURITY.md](docs/SECURITY.md) | English | Security boundaries, known gaps, dependency audit |
| [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) | English | Honest list of what does not work |
| [docs/TESTING.md](docs/TESTING.md) | English | Test commands and results |
| [docs/benchmarks/](docs/benchmarks/) | English | Reproducible AI quality benchmarks |
| [docs/DEMO_PLAN.md](docs/DEMO_PLAN.md) | English | 90-second demo script for HAL Nagoya |
| [docs/evidence/HAL_NAGOYA_READINESS_REPORT.md](docs/evidence/HAL_NAGOYA_READINESS_REPORT.md) | English | Full production audit report |
| [docs/adr/](docs/adr/) | English | Architecture decision records |
| [docs/ja/QUICKSTART.md](docs/ja/QUICKSTART.md) | 日本語 | クイックスタート |
| [docs/ja/ENTERPRISE_READINESS.md](docs/ja/ENTERPRISE_READINESS.md) | 日本語 | 企業導入準備状況 |

---

*AI Agent Builder is a graduation portfolio project (就職作品) for HAL Nagoya. All benchmark results are real and reproducible. No results have been fabricated.*
