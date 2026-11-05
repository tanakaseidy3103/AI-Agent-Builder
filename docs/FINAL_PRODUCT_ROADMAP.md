# Final product roadmap: Phase 0 audit

Audit date: 2026-11-05 · HEAD `3163dc2` (branch `main`, only branch, never pushed) · application code not modified during this audit.
Sources: running code and tests, `docs/benchmarks/20261105-121419.*`, `docs/evidence/*`, and three completed specialist audits
(AI platform, product, architecture). The QA and security specialist audits **did not finish** (their session ended);
their areas are covered below only by my own checks.

## 1. Implemented and verified (evidence exists)

| Capability | Evidence |
|---|---|
| Skill package format (SKILL.md + manifest.json), path/size limits | `tests/test_validation.py` (31 tests) |
| 10-stage generation pipeline, persisted per job, honest LLM errors | `tests/test_pipeline.py` (16) |
| Objective status: `validation_failed` / `validated` / `verified` | `app/skills/evaluation.py`; negative controls in `tests/test_evaluation.py` |
| Docker sandbox: no network, read-only, uid 65534, caps dropped, limits, timeout, no host env, forged-result defense | `tests/test_sandbox.py` (6, real Docker) |
| 5 human-written reference Skills, all `verified` in the real sandbox | `test_reference_skill_is_verified_in_sandbox[*]` |
| Bounded repair loop with real failure feedback; tests frozen during repair | `test_repair_cannot_replace_failing_assertions_with_trivial_tests` |
| Export ZIP + non-overwriting install commands (paths from official docs) | `test_install_roots_follow_official_docs`, bash command run against temp `$HOME` |
| **Real Claude Code install and use** of an exported Skill | `docs/evidence/e2e-claude-code-20261105-114823.json`, `…-121758.json` (passed) |
| **Real Codex install and use** of an exported Skill | `docs/evidence/e2e-codex-20261105-121728.json` (passed, `--root C:\Users\Public`) |
| `/v1` API: hashed API keys, rate limit, input/output schema checks, per-key run isolation, audit | `tests/test_api.py` (28) |
| Python SDK (stdlib, Python ≥3.8) against the real API | `packages/sdk-python/tests` (6) + manual run against the real API |
| Persisted agent events (pipeline stage transitions) + WebSocket endpoint | `test_events_mirror_real_stages` (no HTTP/WS test, see §4) |
| Migrations 0001–0003 on an existing database with data | upgrade/downgrade/upgrade + `alembic check` clean |

## 2. Implemented but not verified, or partial

| Capability | Gap |
|---|---|
| **Generating code Skills with a real LLM** | **0 / 29 benchmark runs reached `verified`** (see §3). The product promise "prompt → verified Skill" is not demonstrated with generated code. |
| Plan-review endpoint (`POST /studio/skills/plan`) | no UI, no HTTP test |
| Evaluations endpoint (`/studio/evaluations`), agents/events endpoints, WebSocket | no UI, no HTTP/WS test |
| Studio UI | Vitest with mocked fetch only. No browser E2E. Eval cases and criteria are not rendered. |
| Cursor export | native `.cursor/skills` layout per official docs; **not executed** (Cursor not installed) |
| PowerShell install commands | generated, never executed |
| Docker Compose API container | sandbox reports "unavailable" by design; `POST /studio/reference/seed` crashes there (repo path not in image, AR-4) |
| CI workflow | written, never run (no push) |

## 3. Generation benchmark: real results (29 of 30 runs; run 30 was still executing at audit time)

Conditions: `docs/benchmarks/20261105-121419.json` meta: commit `43e661e`, Ollama 0.40.14, options
`temperature 0.2, seed 42, num_ctx 8192, num_predict 3072`, max 3 repair rounds, sandbox image `sha256:b18b261e…`,
RTX 3050 6 GB, kind=code forced, 5 tasks (easy: project-docs; medium: python-analyzer, api-test-plan;
hard: react-a11y, laravel-bugs). Model digests: llama3.2:3b `a80c4f17acd5`, qwen2.5-coder:latest `dae161e27b0e`.

| Model | Runs | verified | validated | validation_failed | median s | dominant failure |
|---|---|---|---|---|---|---|
| llama3.2:3b | 15 | 0 | 0 | 15 | 25 | eval cases violate the input schema (10), Python syntax errors (4) |
| qwen2.5-coder:latest | 14 | 0 | 11 | 3 | 147 | code passes static checks but **detects nothing**; own tests and spec-derived expectations fail |

What the data shows (inspected in the run database):
- **qwen2.5-coder:** generation works and validation catches the real defect. Example: `run()` returns `{"issues": []}`
  for a file containing `except:`. Its own test expects a finding, and so does the spec-derived `expect`. Three repair
  rounds did not fix the code. This is a **model capability failure correctly detected**, not a validator bug.
- **llama3.2:3b:** fails earlier. Its eval cases put `files` as a list where the schema needs an object, or contain a
  single case. The case-generation schema sent to Ollama is generic (`input: object`), not the Skill's actual
  `input_schema`, so structured decoding cannot prevent this. **Fixable in our code.**
- **Methodology flaw (mine):** `seed=42` is fixed and prompts are identical, so the 3 attempts per task produced
  **identical outputs** (for example qwen project-docs `tests 3/5, evals 1/3` three times). The effective sample is
  **1 independent run per task per model, i.e. n=5 per model, not 15**. The Wilson intervals in the `.md` overstate
  certainty and must be recomputed with n=5. Fix: seed = attempt index.
- No run rewrote tests during repair (`tests_rewritten_in_repair = 0`), so the freeze rule was never the blocker.

The earlier "0/8" figure came from the obsolete code-in-JSON pipeline and is superseded.

## 4. Known bugs

| ID | Bug | Severity |
|---|---|---|
| B1 | Benchmark attempts are not independent (fixed seed) | high: invalidates the stated sample size |
| B2 | Case-generation schema ignores the Skill `input_schema`, so llama cases are invalid | high |
| B3 | `POST /studio/reference/seed` raises IndexError inside the Docker image (AR-4) | medium |
| B4 | Package directory is written before the DB commit; a failed commit leaves an orphan dir (AR-6) | low |
| B5 | `static_validation` duration includes sandbox time (both stages start before `full_validation`) (AR-7) | low |
| B6 | Docs drift: ADR 0002 and `docs/skills.md` still describe "one repair" and the old statuses; `evaluation.py` cites a missing `docs/SKILL_STATUS.md` (AR-7) | low |
| B7 | SKILL.md text comes from the model and can claim more than the code proves (AI-7) | medium |
| B8 | Commit `e518fe4` contains the local user name in an evidence path (fixed in `360a628`, still in local history; not pushed) | low |

## 5. Security risks

| Risk | Status |
|---|---|
| No user accounts. Studio is local-only (loopback check); API keys are global, not per user or project | open; blocks any multi-user or GitHub feature |
| Exported Skills run **unsandboxed** on the user's machine through Claude Code/Codex | inherent; documented. Our sandbox only validates before export |
| Static policy is bypassable (getattr, string imports); the sandbox is the real boundary | documented; containment tested |
| `verified` is not a guarantee against adversarial content | documented |
| Rate limiter is per process | open, labelled shortcut |
| No dependency vulnerability scan has been run (`npm audit`, `pip-audit`) | open |
| Security specialist audit not completed | open: rerun `/security-audit` |
| Any GitHub integration will add token storage, repo write access and code execution on untrusted repos | not started; needs auth first |

## 6. Missing tests

- Browser E2E of the Studio (Playwright is available via `npx` 1.64.1 but **not configured in the project**).
- HTTP/WS tests for `plan`, `evaluations`, `agents`, `events`, `events/ws` (AR-5).
- PowerShell install path, Cursor E2E.
- Hidden golden cases for generated Skills (AI platform protocol).
- Dependency audit in CI.

## 7. Competition gaps vs. the requested product

| Requested | Exists? |
|---|---|
| Create **Agents** from natural language | **No.** No Agent model or runtime. Pipeline roles (architect, coder…) are labels on stages |
| Generate, validate, repair Skills | Yes (validation and repair real; **generated code never verified so far**) |
| Export and install into external tools | Yes: Claude Code and Codex verified for real; Cursor pending |
| GitHub connect, repo analysis, isolated branch, diff, tests, approval, PR | **No** (nothing implemented) |
| 3D office driven by real events | **No 3D code.** Persisted events and WebSocket exist; no visualization |
| Professional navigation (Dashboard, Agents, Workflows, Repositories…) | **No.** Two pages: Skill Studio, API keys |
| User testing with external testers | **No** participants yet |
| Browser E2E | **No** |

## 8. Recommended implementation order

The demo claim "prompt → verified generated Skill" currently has 0 successes. Everything downstream (GitHub tasks,
3D activity, user testing) depends on it, so it comes first.

| Order | Phase | Scope | Exit criterion (objective) |
|---|---|---|---|
| 1 | **Phase 1, compiler reliability** | Fix B1 (seed per attempt) and B2 (embed the Skill `input_schema` + `minItems: 2` in the case schema). Give repairs the failing eval's expected vs actual. Rerun the benchmark with ≥3 *independent* attempts × 5 tasks × 2 models. Fix B3–B6. | New benchmark file with honest n. At least one generated code Skill `verified`, **or** a documented, evidence-backed reason why the local models cannot. |
| 2 | **Phase 2, Playwright E2E** | `apps/web/e2e/` with real frontend + backend + sandbox: generate (with a deterministic fake-LLM mode, labelled), observe polling, inspect validation, export verified, export blocked for failed, desktop + mobile viewports, traces on failure. | `npx playwright test` green locally; documented command. |
| 3 | Auth foundation (prerequisite) | Local user accounts or a single-owner token for Studio; scope API keys per owner. | Isolation tests between two owners. |
| 4 | **Phase 3, GitHub** (narrow) | GitHub App / fine-grained token, read a repo, run *analysis* Skills in an isolated clone, show findings; proposed diffs + PR only after approval, never to the default branch. | Real run against a test repo the user owns; PR created only after an explicit approval click; audit log entries. |
| 5 | Phase 4, product UX | Navigation for the things that actually exist (Skills, Executions, Activity, Evaluations, Settings). **No "Agents" or "Workflows" pages until they exist in the backend.** | Accessibility checks in Playwright. |
| 6 | Phase 5, activity view | 2D accessible activity view on the existing event stream first; 3D only if time remains, driven by the same events. | Reconnect test; every rendered event has a persisted id. |
| 7 | Phase 6, user testing | 3+ real testers following a written protocol. | `docs/USER_TESTING.md` with real measurements only. |
| 8 | Phase 7, final docs and demo | Demo shows only completed steps. | Release-readiness checklist GO. |

**Do not build (from the audits):** a multi-agent runtime before single-Skill generation works; an LLM-as-judge for
`verified`; more repair rounds; a visual workflow canvas (commodity: Dify, Langflow, Copilot Studio); the one-click
install companion app.

## 9. What I need from you before Phase 1

- Approval to start Phase 1 as scoped above. It changes compiler code and reruns the benchmark (~1.5 h of local GPU time).
- Optional: approval to try one additional local code model if both current models stay at 0 verified. This is a
  multi-GB download.
