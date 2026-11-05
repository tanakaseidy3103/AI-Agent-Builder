---
name: release-readiness
description: Go/no-go checklist for a demo or release of AI-Agent-Builder — all suites, migrations, reference Skills verified, real external E2E, secrets scan, docs consistency. Use right before the HAL presentation, tagging a version, or pushing.
---

# /release-readiness

**Purpose:** a single, objective go/no-go based on commands that ran, not on memory.

**When:** before a demo, tag, push, or when asked "are we ready?".

**Required tools:** Bash, Read, Grep. Writes only docs/RELEASE_CHECK.md.

## Steps (each produces PASS/FAIL with the verbatim output line)
1. Clean tree: `git status --short` is empty (or list what is uncommitted).
2. Backend: `cd apps/api && .venv/Scripts/python.exe -m pytest -q` — 0 failed, sandbox tests not skipped.
3. Frontend: `npm test` and `npm run build`.
4. SDK: `cd packages/sdk-python && PYTHONPATH=. ../../apps/api/.venv/Scripts/python.exe -m pytest -q tests`.
5. DB: `.venv/Scripts/python.exe -m alembic check` → "No new upgrade operations detected".
6. Reference Skills: `POST /studio/reference/seed` → all `verified`.
7. External E2E: `.venv/Scripts/python.exe scripts/e2e_external.py --target claude-code` → `passed: true`
   (uses the user's Claude Code subscription; ask before running if not already approved).
8. Secrets: no `.env`, keys or tokens in `git ls-files` / `git log -p`; evidence files contain no home paths.
9. Docs: README "what works" table matches the results above; KNOWN_LIMITATIONS lists every FAIL.
10. Decision: GO only if 1–8 PASS; otherwise NO-GO with the blocking items.

## Expected output
docs/RELEASE_CHECK.md with the table and the decision.

## Verification criteria
Every PASS has its output line; no step skipped silently (a skipped step is FAIL with reason).

## Failure handling
Do not fix anything inside this Skill; report NO-GO and the failing step. Fixes happen in a separate task.
