---
name: architecture-review
description: Focused architecture review of AI-Agent-Builder (module boundaries, DB/migrations, API contracts, concurrency, frontend structure) with file:line evidence. Use before large refactors, after adding a module, or when performance/maintainability problems appear.
---

# /architecture-review

**Purpose:** catch coupling, data-consistency and scalability problems early, with the smallest fix per issue.

**When:** new module or table, changes to pipeline/sandbox/API layers, or "is this design OK?".

**Required tools:** Read, Grep, Glob, Bash (read-only). Delegate to the `software-architect` subagent.

## Steps
1. Map modules and imports: `grep -rn "^from app" apps/api/app` → dependency list; flag cycles and layer violations
   (API importing sandbox internals, models importing skills, etc.).
2. DB: read models.py + every migration; check indexes on FK/filter columns, nullable/defaults, data that is
   duplicated between DB and disk storage, and that `alembic check` is clean
   (`cd apps/api && .venv/Scripts/python.exe -m alembic check`).
3. API: list routes (`grep -n "@router\." apps/api/app/api/*.py`); check auth dependency on each, error shape,
   unbounded list endpoints, synchronous long work inside requests.
4. Concurrency: background jobs, rate limiter, event stream, sandbox calls — state the single-process assumptions.
5. Frontend: `npm run build` size output; API typing in apps/web/src/api.ts vs backend responses.
6. Produce findings (FINDING_FORMAT, IDs AR-n) with a minimal fix and acceptance test each.

## Expected output
docs/reviews/ARCHITECTURE_REVIEW.md

## Verification criteria
Each finding cites file:line; each proposed fix names the test or command that proves it.

## Failure handling
If a command fails (DB down), record the error and continue with static review; mark affected findings
"evidence partial".
