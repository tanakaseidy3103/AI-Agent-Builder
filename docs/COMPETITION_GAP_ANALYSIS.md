# Competition gap analysis

Audit date: 2026-11-05 · Baseline commit `f73c564` · Everything below was checked by running code, not by reading file names.

## Baseline test run

| Suite | Result |
|---|---|
| API (pytest, incl. 6 real Docker sandbox tests) | 76 passed |
| Python SDK | 6 passed |
| Web (Vitest) | 5 passed |
| Contracts | 1 passed |
| Playwright / browser E2E | does not exist |

Environment: Docker 29, Ollama with `llama3.2:3b`, `qwen2.5-coder:latest`, `qwen3.5:latest`; Claude Code 2.1.138 and Codex CLI 0.163.0 installed; Cursor **not** installed; `gh` authenticated.

## What works (verified)

- Canonical package format, path/size limits, manifest schema.
- 9-stage generation pipeline persisted per job; honest LLM errors.
- Static validation (AST, import policy, forbidden calls).
- Docker sandbox: no network, read-only FS, uid 65534, CPU/memory/PID limits, timeout, no host env (tested).
- Export ZIPs for claude-code/codex/cursor; bash install command tested against a temp `$HOME`.
- `/v1` API with hashed API keys, rate limit, execution logs, audit events.
- Python SDK, tested against the real API + Ollama (instruction Skill).
- Skill Studio UI showing real pipeline state.

## Partially implemented

| Area | Gap |
|---|---|
| Code Skill generation | 0/8 real generations reached `verified` with `llama3.2:3b` (see root cause). |
| Status model | `generated/validated/verified` only; no `draft`/`generating`; `generated` is misleading (means "failed validation"). |
| Meaning of `verified` | "≥1 generated test passed" — tests can be trivial; no check that output matches `output_schema`; no determinism check; no human-authored expectations. |
| Repair loop | One repair per artifact, static errors only; sandbox test failures never fed back. |
| Evaluation | No test cases with expected outputs, no per-case logs, no model version recorded, no cross-version comparison. |
| External install | ZIP layout tested; **no test proves Claude Code or Codex actually discovers and uses the Skill**. |
| Input validation (`/v1`) | top-level keys/types only; output never validated. |
| Creation UX | One prompt → pipeline. No plan review, no permission review before generation. |

## Does not exist (despite being in the brief)

- **3D office**: `unity/` contains only a README. No Unity project, no WebGL build, no event stream to any visualization.
- **GitHub integration**: no repo connection, analysis, branch workspace or PR flow.
- **Agents / teams**: no Agent model, runtime or delegation. The only "agents" are the pipeline stages.
- **User accounts / per-user isolation**: Studio is single-user, local-only.
- **Microfish Skill**: not present anywhere on this machine (see `MICROFISH_EVALUATION.md`).
- TypeScript SDK, Playwright E2E.

## Root cause of the 0/8 code generations (measured on stored artifacts)

| Artifact | Failure |
|---|---|
| 3 of 6 syntax errors | code truncated/broken exactly at a string or regex literal (`re.compile(r'`, `split('`): the model had to embed source code **inside a JSON string**, and escapes (`\n`, quotes, backslashes) broke the literal. |
| 1 | JavaScript `import {…} from 'react-dev-utils'` in a Python file |
| 1 | invalid signature (`def __init__(self, data: Dict)` without `:`) |
| 2 parsed but failed | output schema declared as `array` (contract requires object) |
| 1 | test file syntax error (same JSON-escaping pattern) |

Conclusion: the dominant cause is the **output format** (code-in-JSON), then model size. Both are addressable without weakening validation.

## Architecture problems

1. Code is requested as a JSON field → fragile escaping (fix: plain fenced code blocks, parsed deterministically).
2. Validation status and job status are two vocabularies that don't match the product language.
3. `verified` criteria live implicitly in `full_validation`; not documented as objective rules.
4. Host-mode vs container-mode storage directories diverge.
5. Background jobs are in-process; a restart leaves jobs `running` forever.

## Security problems

| Issue | Severity | Status at audit |
|---|---|---|
| Generated code could forge sandbox results via `atexit` | High | fixed in `ef9d9e9` (regression test) |
| `verified` not a guarantee against adversarial content | Medium | documented |
| No user authentication; API keys are global | High for multi-user | open (local-only guard) |
| Rate limiter per process | Low | open |
| No dependency vulnerability scan | Medium | open |
| Secrets in logs | — | none found; no test asserts it |

## UX problems

- Beginners must understand "kind" before generating; no plan preview.
- No explanation of *how to fix* a failed check.
- No evaluation dashboard; numbers only inside one version's report.
- Export page can't show that the Skill was actually used successfully anywhere.

## Missing tests

- Real external-tool E2E (Claude Code / Codex discovering and invoking the Skill).
- Output-schema conformance, determinism.
- Version comparison.
- Browser E2E of the Studio.
- Secret redaction in audit/logs.
- Generation benchmark with real models (reproducible script + stored results).

## Priorities

| P | Item |
|---|---|
| P0 | Code as fenced text, multi-round repair with sandbox feedback, objective `verified` (schema + determinism + assertions + eval cases), new status model, reproducible benchmark with real models |
| P0 | Reference Skills with human-written expected outputs, evaluated in the sandbox |
| P1 | Real Claude Code / Codex E2E proving discovery and use |
| P1 | Minimal GitHub flow: analyze a repo, run a Skill in an isolated clone/branch, show diff — no push |
| P2 | Real event stream + office view driven only by persisted events; evaluation dashboard; plan-review UX |
| P3 | Security tests, dependency audit, docs, demo script |
