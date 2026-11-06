# Testing

Last full run: 2026-11-06, branch `feature/phase1-compiler-reliability`, Windows 11, Docker 29, Ollama 0.40.14,
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
```

Use `.venv/Scripts/python.exe` directly; `uv run` intermittently stalled on this machine. If Docker is not running,
the real-sandbox tests are **skipped, not passed**. Check that the summary shows no "skipped".

## Results (latest)

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
