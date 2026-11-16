# Testing

Latest results: 2026-11-16 (below). Previous full run: 2026-11-06, branch `feature/phase1-compiler-reliability`, Docker 29, Ollama 0.40.14,
RTX 3050 6 GB. Every number below was produced by the commands in this file.

## Commands

```bash
docker compose up -d db                                      # Postgres on 127.0.0.1:5433 (needed by e2e and the API)
cd apps/api && .venv/Scripts/python.exe -m pytest -q         # backend (Docker needed for the real sandbox tests)
.venv/Scripts/python.exe -m alembic check                    # models vs migrations
cd ../.. && npm test && npm run build                        # web + contracts, tsc + production build
cd packages/sdk-python && PYTHONPATH=. ../../apps/api/.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider tests
cd apps/web && npx playwright test                           # browser tests, desktop + mobile (reuses :5173 / :8000)
RUN_REAL_GENERATION=1 npx playwright test real-generation --project=desktop   # opt-in, minutes, real Ollama
npm run e2e:demo                                             # public Demo Mode build (needs ports 4173 and 8100 free)
cd apps/api && .venv/Scripts/python.exe -u scripts/e2e_real_ollama.py   # real model + sandbox + independent oracle
```

Use `.venv/Scripts/python.exe` directly; `uv run` intermittently stalled on this machine. If Docker is not running,
the real-sandbox tests are **skipped, not passed**. Check that the summary shows no "skipped".

## Results 2026-11-16 (latest)

Windows 11, Docker 29.9.2, Ollama 0.40.16. On this machine a Windows Application Control policy blocks the
virtualenv launcher (`apps/api/.venv/Scripts/python.exe`) and the binary PostgreSQL driver, so Python suites ran
with the uv base interpreter and the locked dependencies on `PYTHONPATH` (installed outside the repository with
`UV_PROJECT_ENVIRONMENT=%LOCALAPPDATA%/aab-venv-api uv sync --frozen`):
`PYTHONPATH=<that env>/Lib/site-packages <uv python 3.12> -m pytest`. The code under test is unchanged.

| Suite | Command | Result |
|---|---|---|
| Backend (real Docker sandbox) | `python -m pytest -q` in `apps/api` | **330 passed**, 0 failed, 0 skipped |
| UGREEN Skill package | `python -m pytest hackathons/ugreen-2026/tests` | **29 passed** (official checker, ZIP, specification, required disclosure) |
| Python SDK | `PYTHONPATH=. python -m pytest tests -q` in `packages/sdk-python` | **6 passed** |
| Frontend unit | `npx vitest run` | **90 passed** |
| Type check + production build | `npm run build` | OK (137 KB gzip main JS) |
| Playwright local, desktop + mobile (mocked LLM, real API and sandbox) | `npx playwright test` | **69 passed, 1 failed, 2 did not run, 36 skipped**. The failure is environmental: `mock-workflow.spec.ts` step 5 runs the installed Skill with `apps/api/.venv/Scripts/python.exe`, which Windows blocks (`spawnSync … UNKNOWN`); the 2 "did not run" are the following steps of that serial test. It passed on 2026-11-14 |
| Playwright Demo Mode, desktop + mobile | `npm run e2e:demo` (same config, harness started with the base interpreter) | **16 passed**, 2 skipped (opt-in UX tour) |
| UGREEN official checker | `node <uliya-skill-kit>/scripts/check-skill.mjs hackathons/ugreen-2026/skill/nas-project-memory` | `static-pass`, 0 errors, 0 warnings |

## Results 2026-11-14, second round

After resolving the `api-test-planner` change (kept as version 1.1.0, see the README), seeding the demo examples
before the harness serves, retrying a locked folder rename on Windows, and sanitizing demo stage details and events.

| Suite | Result |
|---|---|
| Backend pytest | **315 passed**, 0 failed, 0 skipped |
| Frontend Vitest | 87 passed (11 files); `tsc` + production build OK |
| Playwright local (desktop + mobile; mocked LLM, real API and sandbox, started from an empty database) | **72 passed, 0 failed, 36 skipped** (opt-in real-model and evidence specs; 2 `real.spec.ts` checks that need a `validation_failed` Skill in the database) |
| Playwright demo, all specs incl. `demo.e2e.ts` (desktop + mobile) | **16 passed, 0 failed, 2 skipped** (UX tour, opt-in), on ports 8101/4174 (`DEMO_API_PORT`/`DEMO_WEB_PORT`) because 8100 was in use by a process outside these sessions |
| Production image (`apps/api/Dockerfile`) | built; runs as uid 10001, no `.env` inside, `/app` read-only for it, container `healthy` |
| Remote model proxy (`deploy/ollama-proxy.Caddyfile.example`) | in front of this machine's Ollama: no key / wrong key → 401, other API paths → 404, the app with `OLLAMA_API_KEY` listed models and got a chat answer |

## Results 2026-11-14, first round

Windows 11, Docker 29.9.2, Ollama 0.40.16 (`qwen2.5-coder:latest`, CPU), branch `audit/security-hardening`
(uncommitted work). Every number was produced by the commands above on that day.

| Suite | Result |
|---|---|
| Backend pytest | **307 passed, 2 failed**, 0 skipped. Both failures: the reference Skill `api-test-planner`, whose `scripts/main.py` has an uncommitted change made outside these sessions (adds a `no-auth` case for unsecured operations). With it, the Skill's own test `delete-items-id:no-auth` and 1 of 2 eval cases fail, so it is `validated`, not `verified`. The HEAD version passes 5/5 |
| Frontend Vitest | 87 passed (11 files) |
| Python SDK | 6 passed |
| `tsc` + production build | OK: 136 KB gzip main JS, 12 KB gzip lazy Skill Flow chunk, 9 KB gzip CSS |
| `alembic check` | no new upgrade operations |
| Playwright local (desktop + mobile; mocked LLM, real API and sandbox) | **71 passed, 2 failed, 35 skipped**. Failures: `real.spec.ts` "a verified reference Skill" on both projects, same cause as the backend failures (`api-test-planner` is `validated`). Skipped: opt-in real-model and evidence specs |
| Playwright demo, `skill-flow.e2e.ts` + UX tour (desktop + mobile) | **5 passed, 1 failed**, run on ports 8101/4174 because port 8100 was in use by a process outside these sessions. Failure: desktop "example Skill" timed out waiting for the examples, which the demo seeds in the background after start; on this loaded machine seeding took over 120 s. The same test passed on mobile |
| Playwright demo, `demo.e2e.ts` | **not run on the current code** (hard-codes port 8100, which was in use). Its last run, earlier on 2026-11-14 and before the backend quality fixes, passed 18/18 |
| Real generation with Ollama (`scripts/e2e_real_ollama.py`) | 4 runs, see [evidence](evidence/E2E_REAL_OLLAMA_2026-11-14.md): CSV headers `verified` but **wrong** on 2 of 6 oracle cases (false positive); TODO/FIXME in `data["files"]` `verified` and correct (oracle 3/3); after prompt fixes, two CSV runs honestly `validated` (own tests caught the bugs), still wrong on 2 of 6 oracle cases |

## Results 2026-11-06 (previous)

| Suite | Result |
|---|---|
| Backend pytest | **139 passed**, 0 skipped |
| Web unit (Vitest, mocked backend) | 7 passed |
| Contracts | 1 passed |
| Python SDK | 6 passed |
| Production build (`tsc` + `vite build`) | OK (≈95 KB gzip JS) |
| `alembic check` | no new upgrade operations |
| Playwright desktop + mobile | **22 passed**, 1 skipped (opt-in real generation) |
| Playwright real generation (opt-in, run once) | passed in 1.1 min: real Ollama + sandbox, honest `validated` outcome (evidence: `docs/evidence/screenshots/real-generation-outcome-llama.png`) |

## What each layer proves

| Layer | Mocks | Proves |
|---|---|---|
| `tests/test_validation.py`, `test_evaluation.py` | none (real Docker for sandbox cases) | static policy, schema checks, objective `verified`, negative controls |
| `tests/test_pipeline.py` | fake LLM, fake sandbox | pipeline order, repair loop, holdout secrecy, frozen tests, no-progress stop, regression for the PHPStan failure |
| `tests/test_sandbox.py` | none | network/env/FS isolation, timeout, forged-result defence |
| `tests/test_api.py` | fake LLM | routes, export rules, API keys, rate limit, Host allowlist |
| `tests/test_benchmark.py` | — | independent seeds, dedupe, Wilson CI, sleep prevention, suspend detection, resume |
| Vitest `AgentStudio.test.tsx` | intercepted fetch | chat flow, robots from events, validation explanations, Japanese UI |
| Playwright `ui-mocked.spec.ts` | intercepted `/api` | browser states, keyboard, overflow, console errors, mobile layout |
| Playwright `real.spec.ts` | **none** | verified reference Skill evidence + real ZIP, server-side export block (409), API key lifecycle, accessibility basics |
| Playwright `real-generation.spec.ts` | **none** | a real generation drives the Agent Office from persisted events and ends with an honest status |

## External E2E (real coding agents)

`apps/api/scripts/e2e_external.py --target claude-code|codex [--root DIR]` exports `python-code-analyzer`, installs it
into a throwaway project, runs the real CLI headless and passes only if the tool loaded the Skill, ran its script and
reported the planted defects. Evidence: `docs/evidence/e2e-*.json`. Claude Code and Codex passed; Cursor is not
installed here (not tested).

## Not tested

- PowerShell install commands (bash commands are tested).
- Multi-user isolation (no user accounts exist).
- CI on GitHub Actions (workflow exists; results not reviewed in this phase).
