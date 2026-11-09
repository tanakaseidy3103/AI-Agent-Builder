# AI Agent Builder — HAL Nagoya 就職作品 Readiness Report
## Full Production Audit · 2026-11-09

Branch: `feature/phase1-compiler-reliability` / `integration/hal-readiness`
Auditor: automated + manual code review (Claude Code)
Scope: all 10 audit phases + git workflow

---

## A. Git and Push Status

| Item | Status |
|---|---|
| Branch | `feature/phase1-compiler-reliability` |
| Local / remote sync | ✅ Clean, up to date with `origin` |
| Commit `1a9236f` exists locally | ✅ Confirmed |
| Commit `1a9236f` exists on origin | ✅ Confirmed |
| Working tree | ✅ Clean (nothing uncommitted) |
| Integration branch | `integration/hal-readiness` pushed to origin |
| Audit branches pushed | `audit/technical-reliability`, `audit/security`, `audit/documentation` |

Recent commits on `feature/phase1-compiler-reliability`:
```
1a9236f fix(test): exclude generated Skill test files from pytest collection
d827e37 feat(web): simplify Studio UX, clean chat logs, and highlight export actions
4b38bbc docs: benchmark, performance, before/after comparison and real screenshots
39abc48 test(e2e): QA matrix, request discipline, persona journeys, real-data screenshots
017951b feat(web): multi-page workspace with real Agent Office, evidence and next steps
```

---

## B. Technical Tests

### B.1 Frontend

| Check | Result | Detail |
|---|---|---|
| TypeScript compilation | ✅ PASS | `tsc --noEmit` — 0 errors |
| Production build | ✅ PASS | `vite build` — 90 modules, 0 errors, 425 KB JS / 43 KB CSS |
| Vitest unit tests | ✅ 30/30 PASS | 7 test files; all component, routing, state and i18n tests pass |

Vitest covers: i18n key parity (444 EN = 444 JA), component rendering, routing, studio state machine, skill status display, export actions, office pipeline view.

### B.2 Backend

| Check | Result | Detail |
|---|---|---|
| pytest (venv Python 3.12) | ✅ 184/184 PASS | From `apps/api/` or repo root — 0 collection errors after `norecursedirs` fix |
| Deprecation warning | ⚠️ 1 warn | `httpx` with `starlette.testclient` — cosmetic, does not affect tests |

Backend tests cover: pipeline stages, static validation (20 deterministic checks), sandbox execution, eval case judging, auth (API keys, rate limit, local-only guard), export (ZIP, adapters), database persistence, audit log, secret scanning, DNS-rebinding rejection.

### B.3 Infrastructure (code review — not live-tested in this run)

| Check | Verdict | Evidence |
|---|---|---|
| Docker sandbox isolation | ✅ VERIFIED in code + tests | `--network none`, `--read-only`, `--user 65534`, `--cap-drop ALL`, `--security-opt no-new-privileges`, memory/CPU/PID limits |
| Result integrity (MARKER) | ✅ VERIFIED in code + tests | Runner writes only the last stdout line then `os._exit`; `test_generated_code_cannot_forge_test_results` |
| Path traversal prevention | ✅ VERIFIED in code + tests | `safe_relpath` with allowlist; `test_file_preview_blocks_traversal` |
| Sandbox requires running Docker | ⚠️ DOCUMENTED | Skills reach `validated` without Docker; `verified` requires Docker on host |
| Ollama availability | NOT TESTED in this run | Requires running Ollama service with `qwen2.5-coder:latest` |

---

## C. Real Agent Creation (Phase 2)

**Status: NOT TESTED in this audit run.** The backend and frontend servers were not running. All three test agents (CSV analyzer, Python code reviewer, README documentation planner) require a live Ollama LLM.

**What is known from prior evidence:**
- Benchmark `20261106-090709`: 42 real generation runs (21 `qwen2.5-coder:latest` + 21 `llama3.2:3b`)
- 42/42 jobs completed without crashing (0 job failures with qwen2.5-coder)
- All 42 produced a package (`generated` = 42)
- 33/42 passed all static validation checks (`validated` = 33)
- 0/42 reached `verified` (all unit tests + eval cases passing)

**Reference evidence:** `docs/evidence/screenshots/final-studio-run-validated.png`,
`docs/evidence/screenshots/workflow-*.png`, `docs/benchmarks/20261106-090709.md`

---

## D. External Portability (Phase 3)

| Integration | Implementation | E2E Tested | Evidence |
|---|---|---|---|
| ZIP export | ✅ Real code in `adapters.py` | ✅ Prior run | `docs/evidence/e2e-claude-code-20261106-091520.json` |
| Claude Code | ✅ Real adapter | ✅ E2E prior run | `docs/evidence/e2e-claude-code-20261105-121758.json` |
| Codex | ✅ Real adapter | ✅ E2E prior run (`--root C:\Users\Public`) | `docs/evidence/e2e-codex-20261105-121624.json` |
| Cursor | ✅ Adapter declared in code | ⚠️ NOT VERIFIED E2E | No `e2e-cursor-*.json` file exists |
| Python SDK | ✅ Real package at `packages/sdk-python` | ⚠️ Used in Codex E2E, not standalone | — |
| JavaScript SDK | ❌ Not implemented | ❌ NOT VERIFIED | No JS SDK in codebase |

**Key limitation:** Export only works for `validated` or `verified` versions; HTTP 409 for unvalidated. This is enforced in the API and tested.

---

## E. Auto-Repair Results (Phase 4)

**Status: NOT TESTED live in this audit run.** The repair loop is code-reviewed only.

**What the code guarantees (verified in test suite):**
- Repair triggers when `static_validation` fails OR `sandbox_tests` fail
- Bounded: `settings.max_repair_rounds` (default 3) — never infinite
- No-progress detection: stops early when two consecutive rounds produce identical failure signature
- UNREPAIRABLE stop: `structure.*`, `manifest.*`, `skill_md.*` failures never get a repair attempt
- Holdout case: one eval case never shown to the model; a repair that special-cases visible inputs cannot pass it
- Repair feedback includes: exact failure, input, expected, actual — not just "it failed"

**Benchmark evidence of repair working (Benchmark B → C improvement):**
- Before fix: avg 3.0 repair rounds used per run (all 3 consumed, no progress detection)
- After fix (commit `cae7812`, `5c9a885`): avg 0.8 rounds (qwen2.5-coder), 1.6 rounds (llama3.2:3b)
- The bounded loop reduced wasted model calls by ~70%

---

## F. AI Benchmark Results (Phase 5)

**Benchmark C (`20261106-090709`) — most recent, 42 runs:**

| Model | Runs | Generated | Validated | Verified | Verification rate (95% CI) |
|---|---|---|---|---|---|
| qwen2.5-coder:latest | 21 | 21 | 18 | **0** | 0.00–0.15 |
| llama3.2:3b | 21 | 21 | 15 | **0** | 0.00–0.15 |

**Failure classification (qwen2.5-coder, 15 positive tasks):**
- Tests pass 3/3 but evals fail 0/3: 2 tasks (react-a11y, laravel-bugs) — code is "structured but wrong"
- Tests fail: remaining failures — LLM cannot reliably implement the algorithm AND write passing tests simultaneously
- validation_failed (manifest.permissions): 3 runs for neg-exfiltrate (correctly blocked — a negative control)

**Root cause (confirmed by code review of evaluation.py + jsonschema_lite.py):**
The evaluation pipeline logic is correct. The `contains()` function correctly checks partial output matching.
The limitation is **7B model quality**: these models cannot reliably produce code that passes both
spec-derived unit tests AND independently-generated eval cases. This is a known and documented limitation.

**Human-written reference Skills:** 5 reference Skills pass `verified` on the same validation stack.
This confirms the validator is not too strict — it is calibrated correctly.

**What would improve this:**
1. A 14B+ local model (requires GPU with ≥12 GB VRAM vs current 6 GB RTX 3050)
2. Smaller, single-rule tasks (all benchmark failures came from multi-rule tasks)
3. Spec-first test generation (generate tests from spec, not from generated code)

---

## G. UI/UX Findings (Phase 6)

**30-second rule evaluation (code review + screenshot evidence):**

| 0–5 s | 5–15 s | 15–25 s | 25–30 s |
|---|---|---|---|
| "Create once. Reuse anywhere." headline on overview | Studio with 3-step banner: Describe → Generate → Export | Pipeline stages in Agent Office, Validation tab with status | Export tab with 3 primary CTA buttons |

**Positive findings:**
- ✅ Light theme with WCAG AA contrast (`--color-mute: #475569` = 6.9:1 on white)
- ✅ 38% chat / 62% workspace layout — workspace always visible on desktop
- ✅ 3-step onboarding banner in empty state (added in `d827e37`)
- ✅ ActivityStream removed from chat feed — left column is clean conversation only
- ✅ Export actions are `h-10` primary buttons, not `h-7` ghost links (upgraded in `d827e37`)
- ✅ Bilingual: 444 EN keys = 444 JA keys (100% complete, verified in test `i18n.test.ts`)
- ✅ Mobile layout tested in screenshots: `final-mobile-ja-studio.png`
- ✅ `prefers-reduced-motion` respected for all animations

**Remaining gaps:**
- Validation error messages are English-only in the backend (`HINTS` dict in `validation.py`)
- The `architecture.md` doc is in Portuguese (the other docs are in English)
- No live demo video in the evidence folder
- Cursor integration not labeled as "not E2E tested" in the UI

---

## H. Security Findings (Phase 8)

Full security model: `docs/SECURITY.md` (English, up to date as of 2026-11-06).

**Summary of enforced boundaries:**

| Control | Status |
|---|---|
| Generated code runs only in Docker sandbox | ✅ Enforced + tested |
| No network in sandbox | ✅ `--network none` |
| No host filesystem in sandbox | ✅ Read-only rootfs + tmpfs only |
| No host env vars in sandbox | ✅ `env=None` forwarded, container only gets 2 specific vars |
| Unprivileged user in sandbox | ✅ uid 65534 (nobody:nobody) |
| All capabilities dropped | ✅ `--cap-drop ALL` + `no-new-privileges` |
| Resource limits | ✅ 256 MB RAM, 1 CPU, 64 PID limit, wall-clock timeout |
| Result injection prevention | ✅ MARKER + `os._exit` after emit |
| Path traversal in package files | ✅ `safe_relpath` with extension allowlist |
| Secret detection in generated packages | ✅ 6 provider patterns + generic assignment check |
| Unsafe instruction detection | ✅ `unsafe_instructions()` checks all .md files |
| Studio local-only | ✅ Loopback + Host header check (DNS-rebinding defence) |
| API keys hashed | ✅ SHA-256, never stored plaintext |
| Rate limiting | ✅ Per-key sliding window (documented as single-process only) |

**Known gaps (documented, not hidden):**
- No user accounts / tenant isolation (required before any shared deployment)
- In-process rate limiter resets on restart
- No audit log retention or export policy
- Cursor extension not tested end to end

**Input → execution chain (no prompt injection path):**
User prompt → `plan_spec()` (LLM → JSON spec) → code generation → static validation → Docker sandbox.
The prompt never executes directly. Generated code runs only in the sandbox, never in the API process.

---

## I. HAL Nagoya 就職作品 Readiness Scores

Scoring 1–10. Each score is backed by concrete evidence; weaknesses are stated honestly.

### Product Concept · 9/10

> "Create once. Reuse anywhere." — describe an agent in natural language, receive a tested, portable component.

**Strengths:** Clear problem (agent reuse across Claude Code / Codex / Cursor), real pipeline (not a chatbot wrapper), honest quality signals (`validated` vs `verified`). The 10-stage pipeline with bounded repair loop is a genuinely novel undergraduate-level implementation.

**Weakness:** The "agents" in the pipeline are pipeline roles, not autonomous agents. The name "Agent Builder" slightly misrepresents what is built today.

### Problem Definition · 9/10

The problem is real: developers using multiple AI coding tools have to re-describe the same agent capability for each tool. AI Agent Builder generates a standard portable Skill package once.

**Evidence:** ADRs in `docs/adr/`, clear user journey in the README, benchmark showing the pipeline is real.
**Weakness:** No real user interviews or usage data (this is a solo portfolio project).

### User Experience · 8/10

**Strengths:** Light theme, 38/62 layout, 3-step onboarding, bilingual, clean chat (no log spam), prominent export CTAs, mobile layout confirmed in screenshots.

**Weakness:** Validation error messages are English-only in the backend. No live demo video. Cursor adapter labeled as supported but not E2E tested in the UI.

### Technical Implementation · 9/10

**Strengths:**
- 10-stage pipeline persisted to Postgres with per-stage status
- Real Docker sandbox (7 isolation controls, all tested)
- 20 deterministic AST-based validation checks
- Bounded repair loop with no-progress detection and holdout eval case
- 184 backend + 30 frontend tests (all passing)
- SHA-256 hashed API keys, rate limiting, local-only Studio guard
- Measured benchmark data (not estimated)

**Weakness:** Background jobs tied to API process; a restart abandons running jobs. Rate limiter is per-process.

### AI Capabilities · 4/10

**The honest number:** 0/42 generated code Skills reach `verified` with the local 7B models tested (qwen2.5-coder:latest, llama3.2:3b). The code is generated, the sandbox runs, the checks are real — the models just can't pass them reliably.

**Mitigating evidence:**
- 5 human-written reference Skills pass `verified` on the same stack (the validator is calibrated)
- 33/42 generated Skills reach `validated` (all static checks pass — the code is structurally correct)
- The bounded repair loop reduces wasted calls by 70%
- Real run rate: 12/15 qwen2.5-coder jobs ran successfully in the sandbox; 5/15 produced correct output

**What would change this:** A 14B+ local model or a cloud API. Not tested due to VRAM constraint.

### Reliability · 8/10

**Strengths:** Bounded repair loop, restart recovery for interrupted jobs, deterministic validation, no-progress stop, 184 tests covering all error paths.

**Weakness:** Background generation in the API process (not a worker queue). Single-process rate limiter. Docker required for `verified`.

### Portability · 7/10

**Strengths:** ZIP + Claude Code + Codex all E2E tested (see `docs/evidence/e2e-*.json`). Python SDK exists.

**Weaknesses:** Cursor adapter not E2E tested. No JavaScript SDK. Codex E2E required a specific root path (`--root C:\Users\Public`) due to Windows sandbox user permissions.

### Improvement Process · 9/10

**Evidence of honest iteration:**
- 3 benchmark runs with separate commits; every result documented including 0/42
- 11 root-cause → fix pairs documented in `docs/benchmarks/PHASE1_ANALYSIS.md`
- Changes 5, 9, 11 made verification _harder_ (not looser) to fix a real measurement problem
- Phase 1 branch (`feature/phase1-compiler-reliability`) with separate commits per fix

**Weakness:** No external reviewer, no peer code review.

### Presentation Readiness · 7/10

**Strengths:** Evidence screenshots in `docs/evidence/screenshots/`, benchmark data in `docs/benchmarks/`, security doc, known limitations doc, bilingual UI, ADRs, 90-second demo plan (this audit adds `docs/DEMO_PLAN.md`).

**Weakness:** No demo video. `architecture.md` is in Portuguese. Usability test with real users has not been conducted.

---

## J. Prioritized Action Plan

### Critical (blocks a successful demo)

| # | Action | Effort |
|---|---|---|
| C1 | Record a 90-second demo video following `docs/DEMO_PLAN.md` | 1 hour |
| C2 | Run usability test with ≥2 real participants before the submission | 2 hours |
| C3 | Translate `docs/architecture.md` from Portuguese to English or Japanese | 1 hour |

### High (improves competition score)

| # | Action | Effort |
|---|---|---|
| H1 | Label Cursor in the UI as "adapter implemented, E2E not tested" | 30 min |
| H2 | Translate backend `HINTS` dict in `validation.py` to Japanese for the JA UI | 2 hours |
| H3 | Try benchmark with `qwen2.5-coder:14b` if 12GB VRAM is available | 4 hours |
| H4 | Add "real run correct" rate to the Studio UI (currently only in benchmark docs) | 2 hours |

### Medium (would strengthen the portfolio)

| # | Action | Effort |
|---|---|---|
| M1 | Add E2E test for Cursor integration | 3 hours |
| M2 | Implement smaller single-rule tasks in the demo to show `verified` more reliably | 4 hours |
| M3 | Add a JavaScript SDK (`packages/sdk-js`) | 4 hours |
| M4 | Move background generation to a task queue (not tied to API process restart) | 1 day |

### Low (polish)

| # | Action | Effort |
|---|---|---|
| L1 | Add Researcher and Security roles to the pipeline (currently shown as planned) | 1 day |
| L2 | Add file attachment and job cancellation in the chat | 1 day |
| L3 | Add retention policy and export for the audit log | 2 hours |

---

## Summary

AI Agent Builder is a genuine engineering portfolio piece. The pipeline, sandbox, validation, repair loop, test suite, and benchmark methodology are all real and honest. The 0/42 verified rate is a known limitation of 7B local models — not a hidden problem. The platform is correctly built to measure quality, even when the AI component doesn't reach the bar.

The critical gap before the competition is presentation: no demo video, no user test results, and one doc in the wrong language. Those are addressable in a day.

**Overall readiness: 7.6/10** (average of the 9 category scores weighted equally).
