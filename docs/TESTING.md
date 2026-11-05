# Testing

Last full run: 2026-11-05, commit `3163dc2`+, Windows 11, Docker 29.9, Ollama 0.40.14, RTX 3050 6 GB.
Every number below was produced by a command in this file; nothing is estimated.

## How to run

```bash
docker compose up -d db                                    # Postgres on 127.0.0.1:5433
cd apps/api
.venv/Scripts/python.exe -m pytest -q                      # backend (needs Docker for the real sandbox tests)
cd ../.. && npm test && npm run build                      # web + contracts, production build
cd packages/sdk-python && PYTHONPATH=. ../../apps/api/.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider tests
```

Use `.venv/Scripts/python.exe` directly. On this machine `uv run` intermittently stalled for minutes.
If Docker is not running, the 15 real-sandbox tests are **skipped, not passed**. Check that the summary shows no "skipped".

## Results (latest run)

| Suite | Result |
|---|---|
| Backend (pytest) | **103 passed**, 0 skipped (Docker running) |
| Web (Vitest) | 5 passed |
| Contracts (Vitest) | 1 passed |
| Python SDK | 6 passed |
| Production build (`tsc` + `vite build`) | OK |
| `alembic check` against existing Postgres | "No new upgrade operations detected" |

## What the backend tests cover

| File | Tests | Covers |
|---|---|---|
| test_validation.py | 31 | path traversal, limits, manifest/frontmatter, syntax, import/call policy, permissions, dependencies |
| test_api.py | 28 | Studio and /v1 routes, export layouts and install roots, API keys, rate limit, input validation, run isolation per key, audit, sandbox outage keeps status |
| test_pipeline.py | 16 | pipeline with a deterministic fake LLM: stages, events, repair loop, frozen tests, unrepairable failures, approved plan, unexpected exceptions |
| test_evaluation.py | 14 | schema validator, judging; **real sandbox**: all 5 reference Skills verified, plus negative controls (wrong expectation, regressed code, nondeterminism, do-nothing Skill) |
| test_sandbox.py | 6 | **real Docker**: no network, timeout, no host env, read-only FS, uid 65534, forged-result attack, tar traversal |
| test_llm.py | 6 | Ollama errors: unreachable, timeout, truncation (`done_reason=length`), malformed response, bounded options |
| test_contracts.py / test_health.py | 2 | shared AgentEvent contract, health |

The pipeline tests use a fake LLM (deterministic) and, where marked, a fake sandbox. Real-model behaviour is
measured only by the benchmark below, never by unit tests.

## Negative controls (prove `verified` can be refused)

| Test | Mutation | Result |
|---|---|---|
| `test_wrong_expectation_is_caught` | eval expects count 99 | `validated`; actual output (6) recorded |
| `test_regressed_code_is_caught_by_tests_and_evals` | img-alt rule disabled | tests and evals fail |
| `test_nondeterministic_code_is_caught` | random value in output | "non-deterministic" |
| `test_do_nothing_skill_is_not_verified` | `run` returns nothing; 3 vacuous tests | own tests 3/3 pass, spec-derived `expect` fails → `validated` |
| `test_trivial_tests_are_rejected_statically` | tests without assertions | `validation_failed` |
| `test_repair_cannot_replace_failing_assertions_with_trivial_tests` | repair returns `assertTrue(True)` tests | tests stay frozen, not verified |
| `test_generated_code_cannot_forge_test_results` | atexit prints fake "all pass" | real failure reported |

## External E2E (real tools, real Skill)

`apps/api/scripts/e2e_external.py --target claude-code|codex [--root DIR]` exports `python-code-analyzer` from the
running API, installs it into a throwaway project (never into `~/.claude` or `~/.codex`), runs the real CLI
headless, and passes only if the tool **loaded the Skill**, **ran its script**, and **reported the 3 planted defects**.

| Evidence file | Tool | Result | Notes |
|---|---|---|---|
| e2e-claude-code-20261105-114823.json | Claude Code 2.1.138 | passed | `Skill` tool call `python-code-analyzer`, then `scripts/cli.py` |
| e2e-claude-code-20261105-121758.json | Claude Code 2.1.138 | passed | re-run on current code |
| e2e-codex-20261105-115717.json | Codex CLI 0.163.0 | **failed (environment)** | Windows sandbox `CreateProcessWithLogonW failed: 267` — project under `%TEMP%`, unreadable for Codex's sandbox user; old `.codex/skills` path |
| e2e-codex-20261105-121624.json | Codex CLI 0.163.0 | **failed (our detector bug)** | Codex did read SKILL.md and ran the script; detector missed escaped separators |
| e2e-codex-20261105-121728.json | Codex CLI 0.163.0 | passed | `--root C:\Users\Public`, `.agents/skills`, `--sandbox read-only` |
| — | Cursor | **not tested** | Cursor is not installed on this machine |

Each run consumes the user's Claude Code / Codex subscription; they are not part of CI.

## Generation benchmark

Raw data: `docs/benchmarks/20261105-121419.json` (+ `.md`). Analysis, including the fixed-seed flaw that makes the
3 attempts per task non-independent: `docs/FINAL_PRODUCT_ROADMAP.md` §3. Result so far: **0 generated code Skills verified**.
Command: `.venv/Scripts/python.exe -u scripts/benchmark_generation.py --models llama3.2:3b qwen2.5-coder:latest --attempts 3`.

## Not tested

- Browser end-to-end (Playwright) of the Studio UI.
- PowerShell install commands (bash commands are tested).
- Multi-user isolation (no user accounts exist).
- CI on GitHub (never pushed).
