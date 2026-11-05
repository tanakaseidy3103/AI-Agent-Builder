# Skill Compiler

Turns a natural-language description into a reusable, testable, installable AI Skill.

Status legend: **Implemented** = code + automated tests in this repo. **Planned** = not built.

## 1. Skill package format (Implemented) — `format_version: "1"`

A package contains only the files it needs.

```
<slug>/
├── SKILL.md          always  — YAML frontmatter (name, description) + agent instructions
├── manifest.json     always  — machine-readable metadata (below)
├── README.md         always  — human summary
├── scripts/main.py   code    — LLM-generated; must define run(data: dict) -> dict
├── scripts/cli.py    code    — trusted template: python scripts/cli.py --dir <path> | input.json
├── tests/test_main.py code   — LLM-generated unittest tests
└── docs/usage.md     code    — usage + input schema
```

`manifest.json` (Pydantic model `app/skills/package.py::Manifest`):

| Field | Meaning |
|---|---|
| `id` | stable slug, `[a-z0-9-]{3,64}`; equals SKILL.md `name` |
| `name`, `description`, `version` (semver) | metadata |
| `kind` | `instructions` (no code) or `code` |
| `tools` | tools the host agent needs (e.g. `Read`, `Grep`) |
| `dependencies` | external pip packages — **rejected in MVP** (sandbox is offline, stdlib only) |
| `permissions` | subset of `compute`, `read-input-files`, `llm`, `network`, `filesystem-write`; the last two are never granted |
| `input_schema`, `output_schema` | JSON Schema, top-level `type: object` |
| `execution` | `runtime`, `entrypoint`, `timeout_seconds` (≤60), `memory_mb` (≤1024) |
| `tests` | `framework: unittest`, `path` |
| `compatibility` | export targets: `claude-code`, `codex`, `cursor` |

Natural-language instructions (SKILL.md), executable code (`scripts/`), and tool requirements (`tools`) are kept separate.

Path rules (`safe_relpath`): relative POSIX paths only; no `..`, absolute paths, drive letters, backslashes, NUL or hidden files;
root files limited to SKILL.md/manifest.json/README.md; top dirs limited to `scripts tests examples docs`;
extension allowlist; ≤50 files, ≤100 KB per file, ≤1 MB total.

## 2. Generation pipeline (Implemented) — `app/skills/pipeline.py`

`POST /studio/skills/generate` creates a `GenerationJob` and runs in a background task. Each stage is persisted
(`status`, `detail`, `duration_ms`) and polled by the UI.

| # | Stage | What happens | LLM? |
|---|---|---|---|
| 1 | analyze | model returns a spec (JSON Schema-constrained via Ollama structured output) | yes |
| 2 | specify | build `Manifest`; one repair call if I/O schemas are invalid; new version if slug exists (never overwrite) | repair only |
| 3 | plan | deterministic file list from `kind` | no |
| 4 | generate_files | code Skills: model writes `scripts/main.py`; one repair call with the failing checks | yes |
| 5 | static_validation | all static checks except tests | no |
| 6 | test_generation | model writes unittest tests from the code; one repair call | yes |
| 7 | sandbox_tests | static checks again + tests in Docker sandbox | no |
| 8 | report | `ValidationRun` with every check and test | no |
| 9 | package | files to `STORAGE_DIR/skills/<version_id>/`, `SkillVersion` row | no |

LLM errors (unreachable, invalid JSON, Ollama 500) fail the job with the real message. Validation failures do **not**
abort: the package is stored as `generated` so the user can see what failed.

The user may force `kind` (`auto | instructions | code`).

### Statuses

| Status | Meaning | Exportable | Runnable via /v1 |
|---|---|---|---|
| `generated` | produced by the model, static validation failed | no | no |
| `validated` | all static checks pass | yes | instruction Skills only |
| `verified` | validated **and** ≥1 generated test, all passing in the sandbox | yes | yes |

An instruction-only Skill can never be `verified` — nothing executable exists to test.

## 3. Validation (Implemented) — `app/skills/validation.py`, `app/skills/sandbox.py`

Static (never executes code): structure/paths/limits, manifest schema, frontmatter ↔ id, I/O schemas, permissions,
dependency declarations, compatibility targets, Python syntax (`ast`), entrypoint defines `run`, imports are stdlib or local,
forbidden modules (`subprocess socket ctypes urllib http importlib …`), forbidden calls (`eval exec compile __import__`,
`os.system os.environ …`, `open()` for writing), tests present for code Skills.

The static policy is defense-in-depth only. **The sandbox is the security boundary:**

```
docker run -i --rm --network none --memory 256m --memory-swap 256m --cpus 1 --pids-limit 64
  --read-only --tmpfs /tmp:size=32m --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges
  python:3.12-slim timeout <N> python -I -c <bootstrap>
```

- No host mounts: the package is streamed as a tar on stdin and extracted with `tarfile` `filter='data'` (blocks traversal/links).
- Host environment variables are never forwarded (verified by `test_host_env_not_leaked_and_fs_readonly`).
- Timeout inside the container (exit 124) plus a host-side kill as a safety net; exit 137 = memory limit.
- Results come back as the **final** stdout line, written by the trusted runner with `os.write` followed by
  `os._exit(0)` (skips `atexit` hooks, kills threads). The host accepts only the last line, so fake markers printed
  by generated code are ignored (`test_generated_code_cannot_forge_test_results`). Residual risk: a background thread
  racing the microseconds between the write and `_exit`.

Report: per-check pass/fail/warn, per-test result with traceback, sandbox status/duration/error, overall status.

## 4. Local installation (Implemented: ZIP + commands. Planned: companion app)

`GET /studio/versions/{id}/export/{target}` → ZIP · `GET /studio/versions/{id}/install/{target}` → commands.

| Target | ZIP layout | Extract into | Confidence |
|---|---|---|---|
| `claude-code` | `<slug>/SKILL.md …` | `~/.claude/skills/` (user) or `<project>/.claude/skills/` | High — Agent Skills format |
| `codex` | `<slug>/SKILL.md …` | `~/.codex/skills/` | Medium — same SKILL.md frontmatter; **verify path for your Codex version** |
| `cursor` | `.cursor/rules/<slug>.mdc` + `.cursor/skills/<slug>/…` | project root | Medium — Cursor has no identical Skill format; exported as a project rule pointing to the canonical package |
| `canonical` | `<slug>/…` | anywhere | — |

Rules:
- Canonical files are always included unchanged.
- Install commands check for an existing directory and **refuse to overwrite**. Replacement commands are shown only
  after the user ticks a confirmation box, and they rename the old copy to `.bak-<timestamp>` first.
- Only `validated`/`verified` versions are exportable.
- The platform cannot see the user's machine and never claims a Skill is installed.
- Installed code runs **outside** our sandbox, under the coding agent's own permission prompts.

Verified in this repo: `test_export_installs_into_fake_home_and_runs_cli` extracts the ZIP into a temp home and runs
`scripts/cli.py --dir` on a real folder; the generated bash command was also run twice against a temp `$HOME`
(installs, then refuses). PowerShell commands were **not** executed in tests.

Planned: a local companion (CLI/tray app) that receives a signed one-click install request, shows a diff, asks for
confirmation, and writes into the target directory.

## 5. Public API (Implemented)

Auth: `Authorization: Bearer aab_…`. Keys are created in the Studio, shown once, stored as SHA-256 hashes, revocable.
Rate limit: `RATE_LIMIT_PER_MINUTE` per key (in-process; see limitations).

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/skills` | runnable Skills (latest runnable version each) |
| GET | `/v1/skills/{slug}?version=` | metadata + I/O schemas |
| POST | `/v1/skills/{slug}/run` | body `{"input": {...}, "version"?: "x.y.z"}` |
| GET | `/v1/runs/{run_id}` | only the key that created the run can read it |

Run response: `{run_id, status: completed|failed, skill, version, output, error, duration_ms}`.
Errors: 401 bad key · 404 unknown Skill · 409 no runnable version · 413 input > 1 MB · 422 input ≠ schema · 429 rate limit · 503 sandbox unavailable.

Code Skills run `run(input)` in the sandbox. Instruction Skills call the LLM with SKILL.md as the system prompt and
return `{"text": …}`.

Studio API (`/studio/*`, local-only until user accounts exist — Phase 1): generate, jobs, skills, versions, files,
validate, integrations, export, install, api-keys, audit. Full schema at `http://localhost:8000/docs`.

## 6. Python SDK (Implemented) — `packages/sdk-python`

Stdlib only, Python ≥ 3.8.

```bash
pip install -e packages/sdk-python
```

```python
import os
from agent_builder import SkillClient, SkillError

client = SkillClient(api_key=os.environ["AAB_API_KEY"])  # base_url defaults to http://localhost:8000
print(client.list())
result = client.run("react-performance-analyzer", project_path="./my-project", task="Analyze performance issues")
print(result["status"], result["output"])
```

`project_path` reads text sources (skips `node_modules`, `.git`, build dirs; ≤200 KB/file, ≤500 files) into
`input["files"]`; `task` sets `input["task"]`. Errors raise `SkillError(status, message, detail)`.

Verified against the real running API + Ollama (instruction Skill, 7 s). TypeScript SDK: **planned**.

## 7. Known limitations

- **Model quality.** With `llama3.2:3b`, 0 of 8 real code-Skill generations reached `verified` (syntax errors,
  invented libraries, inconsistent schemas — all correctly rejected). Instruction Skills worked. A stronger model
  (e.g. a 7B+ coder model via `LLM_MODEL`) is required for a convincing code demo; not yet measured.
- Code Skills: Python stdlib only; no external dependencies.
- Generated tests are written by the same model as the code: `verified` means "consistent with its own tests in
  isolation", not "correct". Human review is still required.
- `verified` is **not** a guarantee against adversarial content: hostile generated tests can be trivial or
  (via obfuscated calls that evade the static policy) terminate the runner with a forged result. The security
  guarantee of the sandbox is containment (no network, no host access), not result integrity.
- Sandbox requires the API to run on a host with Docker. In the Compose container it reports `unavailable`.
- Host-mode and container-mode API use different storage dirs; use one mode per database.
- No user accounts yet: Studio is local-only; API keys are global, not per project.
- Rate limiter is per process.
- Input validation checks required keys and top-level types only.
- Background jobs run in-process (FastAPI BackgroundTasks); a restart loses running jobs (they stay `running`).
