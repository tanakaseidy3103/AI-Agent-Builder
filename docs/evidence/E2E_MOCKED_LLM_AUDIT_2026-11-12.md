# Browser audit with a MOCKED LLM — 2026-11-12

Playwright (Chromium) against the real frontend and the real API. **No Ollama, no real model call.** The only
thing replaced is the model: `ScriptedProvider` in `apps/api/scripts/e2e_mock_server.py` returns fixed, hand-written
replies and is shown everywhere as `fake:scripted (MOCKED LLM)`. Everything else is real: the pipeline, static
validation, the Docker sandbox, packaging, ZIP export, the project installer, and running the installed Skill with
Python in a separate project.

Labels: **PASS**, **FAIL**, **BLOCKED**, **NOT IMPLEMENTED**.

## How to reproduce

```powershell
# terminal 1: API with mocked LLM, isolated data under <repo>/test-results/e2e-mock/ (wiped on start)
cd apps/api; .venv\Scripts\python.exe scripts\e2e_mock_server.py
# terminal 2: Vite
npm run dev:web
# terminal 3
cd apps/web; npx playwright test mock-workflow --project=desktop      # the workflow below
cd apps/web; npx playwright test                                       # whole suite (real-LLM specs skip themselves)
```

Data isolation: SQLite and storage in `test-results/e2e-mock/`. The Studio's Postgres data, `~/.claude` and
`~/.agents` were not touched. Ollama was stopped during the whole run (`tasklist | grep ollama` → 0).

## Results

Final full run (`npx playwright test`, both projects): **60 passed, 0 failed, 36 skipped**. Backend `pytest`:
**217 passed**. Frontend `vitest`: **31 passed**. `tsc --noEmit`: clean.

### Objectives

| # | Objective | Result | Evidence |
|---|---|---|---|
| 1 | Open the application | **PASS** | 8 routes load by direct URL and after reload, at 4 viewports |
| 2 | Describe a capability in natural language | **PASS** | the prompt below, typed into Agent Studio |
| 3 | Generate a Skill through the pipeline (MOCKED LLM) | **PASS** | job completed, all 10 stages `passed`, version `verified` |
| 4 | View the Skill and its source files | **PASS** | all 8 files opened in the code viewer; content matches the API |
| 5 | Copy the generated code | **PASS** | `Copy file` and `Copy all files` equal the stored files (see note on CRLF) |
| 6 | Download as ZIP | **PASS** | UI download; 8 entries, byte-identical, no temp files, no credentials |
| 7 | Install into a separate project | **PASS** | through the UI's "Implement in my project", on its own git branch |
| 8 | Execute the installed Skill in that project | **PASS** | `python .claude/skills/python-bug-finder/scripts/cli.py --dir app` found all 4 planted bugs |
| 9 | Installed version behaves as expected | **PASS** | its 5 unit tests pass from the installed copy; output matches the planted bugs line by line |
| — | GitHub integration | **NOT IMPLEMENTED** | the app shows copyable `git`/`gh` commands only; it never contacts GitHub (verified: no request leaves localhost) |
| — | Real LLM generation | **BLOCKED (by request)** | not run in this audit; see "Real LLM runs" below |

Prompt used: *"Create a Python Skill that analyzes Python source files, identifies potential bugs, and produces useful
improvement suggestions."*

### Pipeline stages (MOCKED LLM)

Observed live from `GET /studio/jobs/{id}` while the UI ran, in this order:
`analyze → specify → plan → generate_files → static_validation → test_generation → sandbox_tests → evaluate → report → package`.
All 10 ended `passed`. Report: static 22 passed / 0 failed; sandbox `ran` (Docker, no network, 256 MB); unit tests 5/5;
eval cases 3/3 (one is the holdout); status **verified**. At no time did the UI show more than one role working.
The UI's outcome sentence matched the stored status (`python-bug-finder@0.1.0 is verified`).

What this does **not** prove: that a real model writes code this good. The replies are hand-written. With the real
local model the same flow reached `validated`, not `verified` (see below).

### Install and execution in a separate project

`test-results/external-project/`: a git repo with `pyproject.toml`, `README.md`, `app/clean.py` and `app/buggy.py`
containing four deliberate bugs.

| Check | Result |
|---|---|
| Plan shown before writing: language detected (Python), target branch `aab/python-bug-finder-0.1.0` | PASS |
| Files written to `.claude/skills/python-bug-finder/`, byte-identical to the stored package | PASS |
| `manifest.json` version = `0.1.0` | PASS |
| Unrelated files unchanged (SHA-256 of every file before/after) | PASS |
| Git: new branch checked out, `git status` = `?? .claude/` only, nothing committed | PASS |
| Installation history: audit log entry `skill.installed_in_project` with root and file count | PASS |
| Conflict: a second plan says "already exists; remove or rename it first" and disables Approve | PASS |
| Execution: `cli.py --dir app` → `mutable-default` L1, `bare-except` L4, `none-comparison` L8, `unreachable-code` L11, each with a suggestion; `clean.py` → nothing | PASS |
| Installed unit tests: `python -m unittest discover -s tests` with `scripts/` on the path | PASS |

Output: `test-results/external-project-run.json`.

### Visual audit

8 routes (Overview, Studio, Agents, Code, Projects, Evaluations, Integrations, Settings) × 4 viewports
(1920×1080, 1366×768, 768×1024, 390×844), once with an empty database and once with data: **64 page screenshots**
plus 6 workflow screenshots in `test-results/screenshots/`.

After the fixes below: no horizontal page scroll, no visible target under 24 px, one visible `h1` per page,
**no console errors, no failed requests** in either pass.

Interaction coverage (other specs, same run):
- 40 visible buttons clicked one by one across all routes, each with an observable effect (destructive and
  generation-starting buttons excluded).
- Named controls and labelled fields on every route.
- The 5 Code Workspace tabs opened by deep link and after reload.
- Unknown routes and ids handled.
- Keyboard-only navigation.
- Plan review approve/reject.
- API keys create/revoke.
- Request counting.
- Japanese UI.
- The events WebSocket: the Studio origin is accepted; a foreign origin gets a 403.

## Problems found and fixed in this audit

| Problem | Fix | Evidence |
|---|---|---|
| **Concurrent seeding returned HTTP 500** (`UNIQUE constraint failed: skills.slug`). Found when parallel Playwright workers imported the reference Skills at the same time | `reference.seed` treats the unique-constraint collision as "already seeded" and returns the stored version (`apps/api/app/skills/reference.py`) | `tests/test_reference_seed.py` reproduces the race deterministically: it fails with that exact error before the fix and passes after |
| Empty state repeated its title and pointed to a "Create page" that does not exist | Copy now points to Agent Studio (EN + JA) | screenshots `empty-*-agents.png`, `empty-*-code.png` |
| 3 links smaller than 24 px (WCAG 2.5.8): "Manage API keys", agent name on My Agents, evaluation rows on Overview | `min-h-6` on those links | layout notes went from 12 entries to none |

Fixed earlier in this audit series (still covered by this run):
- **Unknown version link.** It showed "Loading…" through three retries of a 404; the error now appears in 18 ms.
- **Office stations.** They were clickable before any run but did nothing.
- **Security fixes.** See `docs/SECURITY.md`.

## Not covered or skipped

| Item | Status | Why |
|---|---|---|
| Real LLM generation (`audit-real-flow`, `real-generation`, `real-workflow`) | **BLOCKED (by request)** | no Ollama in this audit. Earlier on 2026-11-11 one real flow (`audit-real-flow`) passed end to end. qwen2.5-coder reached `validated`, not `verified`: its tests passed a list where the schema says object. `real-workflow` timed out on this CPU-only laptop and the Refine flow was never reached |
| `real.spec` "a Skill that failed validation cannot be exported" | skipped | needs a `validation_failed` Skill in the database; the mocked run produces a verified one. Covered with mocked API data in `ui-mocked.spec` and in `test_api.py` |
| `journeys` "returning user refines a validated Skill" | skipped | needs a `validated` Skill; same reason |
| Running the installed Skill **through Claude Code / Codex / Cursor** | **BLOCKED** | those consumers call a real LLM. The Skill's own documented invocation (`scripts/cli.py`) was run instead |
| Cursor | not tested | not installed here |
| 36 skips in total | — | 22 are mobile-project duplicates of specs that set every viewport explicitly; 4 are the doc-screenshot refresh; the rest are listed above |

## Notes

- **Clipboard line endings.** On Windows the system clipboard stores copied text with CRLF. The copied file differs
  from the original only in `\n` → `\r\n`, which is the OS's conversion. The app passes the file text unchanged to
  `navigator.clipboard.writeText`.
- **Versions.** Running the workflow twice against the same database produces `python-bug-finder@0.2.0`. That is
  intended: versions are never overwritten.

## UX recommendations (not implemented)

1. **Tell broken tests apart from broken code.** In the real-model run all unit tests ended in `error` because the
   *tests* passed a list where the schema says object. The UI said "its unit tests failed", which points the user at
   the code. Show `error` and `fail` separately. When every test errors on input handling, say that the generated
   tests may not match the input schema.
2. **Code Workspace tabs on phones.** At 390 px the tab strip is cut off ("Exp…") with no hint that it scrolls.
   Add a fade or arrow, or wrap the tabs.
3. **Reference Skills are labelled "Generated"** in the evidence ladder although they are human-written
   (`origin: reference`). Label that step by origin.
4. **Status explanation is generic.** "...(instruction-only, or sandbox tests/evaluation cases failed)" is shown
   even when the kind and the failing criterion are known. Say which one applies.
5. **Phones: live progress lives on the Result pane.** A user who stays on Build sees only "Request received" until
   the end. Consider a one-line progress summary on the Build pane.
6. **"GitHub" wording.** The section says "Publish to GitHub (from your machine)" and is accurate, but the Studio
   hero mentions GitHub next to download and install. Make sure nothing suggests the app publishes by itself.
7. **Remove `ActivityStream`.** It is no longer rendered (`apps/web/src/workspace/Office.tsx`) and is dead code.

## Files added or changed for this audit

- `apps/api/scripts/e2e_mock_server.py`: mocked-LLM API launcher (test tooling only).
- `apps/web/e2e/mock-workflow.spec.ts`: the workflow above.
- `apps/web/e2e/audit.spec.ts`, `apps/web/e2e/zip.ts`, `apps/web/e2e/audit-real-flow.spec.ts`: broader audit specs.
- `apps/api/app/skills/reference.py` and `apps/api/tests/test_reference_seed.py`: the seed race fix and its test.
- `apps/web/src/i18n.tsx`, `pages/Agents.tsx`, `pages/Integrations.tsx`, `pages/Overview.tsx`: copy and target size.
