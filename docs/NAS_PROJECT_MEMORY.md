# NAS Project Memory: local SIMULATION harness

Status (2026-11-16): **SIMULATION only. No UGREEN NAS has been used.** Nothing in this repository connects to a
UGREEN device or to Uliya.

The submitted Uliya Skill ([hackathons/ugreen-2026/skill/nas-project-memory/](../hackathons/ugreen-2026/skill/nas-project-memory/))
is Markdown that a Uliya runtime on the NAS follows; the platform experts (`file-agent`, `knowledge-agent`,
`document-agent`) do the file work. The Skill Kit 0.7.3 documents no API for calling those experts from outside the
device, so AI-Agent-Builder cannot drive a NAS. This harness instead reproduces the Skill's *read* workflow on a local
folder, deterministically, so its rules can be tested and the answer format can be inspected before the device day.

## What is implemented

| Part | File | What it does |
|---|---|---|
| Authorized folder | [scope.py](../apps/api/app/nas/scope.py) | one root, read-only; refuses `..`, absolute paths, drive letters, NUL, symlinks and junctions leading out; skips hidden files; 2 MB per file; PDF/Office files are listed as *not readable locally* instead of being parsed |
| Expert adapters | [adapters.py](../apps/api/app/nas/adapters.py) | `LocalSimulationAdapter`: serves four documented read actions (`ug-filesystem ls/find/cat`, `ug-knowledge collect-evidence`) with the catalog's result envelope and states; every other action, including all writes, returns `failed`. `UliyaAdapter`: refuses with `IntegrationUnavailable` (see above) |
| Evidence | [evidence.py](../apps/api/app/nas/evidence.py) | keyword passages with file and line; text addressed to an AI (for example "ignore your previous instructions") becomes a warning |
| Analysis | [analysis.py](../apps/api/app/nas/analysis.py) | rules for Markdown/plain-text notes: decisions, tasks (owner, due date, done), risks, requirements; document date from the file name or first line; conflicts on the same topic; duplicates across files |
| Workflow | [workflow.py](../apps/api/app/nas/workflow.py) | Planner (question → intents) → Researcher (find + cat through the adapter) → Analyst → Reviewer, each timed |
| Reviewer | [citations.py](../apps/api/app/nas/citations.py) | every confirmed claim must quote text that exists in a file inside the folder; failing claims are removed and listed |
| API | [project_memory.py](../apps/api/app/api/project_memory.py) | `GET /studio/project-memory/folders`, `POST /studio/project-memory/ask` |
| CLI | [project_memory_sim.py](../apps/api/scripts/project_memory_sim.py) | prints the answer for a folder and question |

No model is called. Answers are reproducible and the Reviewer's check is exact; the price is that the rules only
understand simple project-note layouts. What they cannot establish is reported as unknown.

## Answer structure

`confirmed` (quoted, `path:line`), `inferences` (with `basis`, e.g. "later document date"), `unknowns` (never filled
in), `conflicts` (all statements in date order; `current` only when one document is strictly later, otherwise
*unresolved*), `duplicates`, `warnings`, `unreadable`, `review` (claims checked, claims rejected), `trace` (time per role)
and `mode: "SIMULATION"`.

## Security model

- The allowlist is server configuration (`PROJECT_MEMORY_FOLDERS=id=path;...`). A request names a folder **id**; it
  can never pass a path, and the response never echoes configured paths. Empty allowlist: the routes return 404.
- Loopback clients only, regardless of `STUDIO_LOCAL_ONLY`; cross-site browser requests are refused. The public Demo
  Mode process does not include these routes.
- The adapter is bound to one folder when it is created; no parameter, action or agent can change it.
- No write, move, delete, upload or execute path exists. Document text is data: it is never executed, and instruction-
  like text is reported, not followed.

## Run it

```bash
cd apps/api
python scripts/project_memory_sim.py                 # Apollo fixture, the Round 2 question
python scripts/project_memory_sim.py --folder PATH --question "What are the risks?" --json
```

API (Studio running on port 8000, `PROJECT_MEMORY_FOLDERS` set in `apps/api/.env`):

```bash
curl http://127.0.0.1:8000/studio/project-memory/folders
curl -X POST http://127.0.0.1:8000/studio/project-memory/ask -H "content-type: application/json" \
     -d '{"folder_id": "apollo", "question": "Who owns the pending tasks?"}'
```

Measured on the Apollo fixture (5 documents, Windows laptop): about 15 ms end to end; researcher ~10 ms, reviewer ~4 ms.

## Tests

[test_nas_harness.py](../apps/api/tests/test_nas_harness.py) and [test_nas_workflow.py](../apps/api/tests/test_nas_workflow.py):
scope and traversal, junction escape (Windows), empty folder, unreadable formats, write and unknown actions refused,
scope not widened by parameters, envelope and states, workflow stops on a non-completed state, conflicts, owners and
deadlines, duplicates, injected text, out-of-scope secret, exact line citations, reviewer dropping a stale claim, API
allowlist, loopback and cross-site checks. All use local fixtures: **mocked environment, not NAS validation.**
One test is real against UGREEN material: when the official Skill Kit is available it checks that every action the
local adapter serves exists in the official catalog 2.0.0 with the same expert, effect `read`, approval `none`, and
only catalog parameters.

## Not implemented

- Any connection to a UGREEN NAS or Uliya. The device test (Round 2, assigned remote-access day) is the only way to
  validate the Skill on real hardware; procedure: [hackathons/ugreen-2026/tests/test-plan.md](../hackathons/ugreen-2026/tests/test-plan.md).
- `document-agent` actions (`qa`, `extract`, `reconcile`): their behaviour is the platform's; the local rules are not
  a substitute.
- The optional approved note (`ug-knowledge save-text`): no write exists in the harness.
- A Studio UI page, and generating Uliya Skills with the Agent Builder pipeline (its Skills contain Python, which the
  Uliya format does not allow).
