---
name: project-audit
description: Coordinated read-only audit of AI-Agent-Builder by the five specialist subagents (product, architecture, AI platform, QA, security), then deduplication, prioritization and a unified roadmap. Use before a release, after a large feature, or when asked for a full team review.
---

# /project-audit — coordinated team review

**Purpose:** find what is weak, missing, good and not worth building, with evidence, and turn it into one
prioritized roadmap. **Read-only** for specialists; only this coordinator writes files.

**When:** before demos/releases, after major merges, or on request ("team review", "audit the project").

**Required tools:** Agent (subagents below), Read, Grep, Glob, Bash (read-only commands), Write (coordinator only).

## Steps

1. **Baseline (coordinator, read-only):** `git status --short`, `git log --oneline -15`, and the test summaries
   (`cd apps/api && .venv/Scripts/python.exe -m pytest -q`, `npm test`). Record verbatim. If the tree is dirty,
   note it; do not stash or commit.
2. **Run specialists in parallel**, each with the instruction "READ-ONLY audit; return your full report as the
   final message; follow .claude/team/FINDING_FORMAT.md":
   - `product-researcher`, `software-architect`, `ai-platform-engineer`, `qa-engineer`, `security-engineer`.
   They never write files, so they cannot conflict.
3. **Write each specialist report verbatim** to its file (coordinator is the single writer):
   - docs/research/PRODUCT_RESEARCH.md, docs/reviews/ARCHITECTURE_REVIEW.md, docs/reviews/AI_ENGINEERING_REVIEW.md,
     docs/reviews/QA_REVIEW.md, docs/reviews/SECURITY_REVIEW.md
4. **Verify evidence** (spot-check ≥ 1 per specialist and every P0): open the cited file:line or rerun the command.
   Drop or downgrade findings whose evidence does not hold; record that in TEAM_REVIEW.md ("rejected findings").
5. **Deduplicate:** merge findings describing the same root cause; keep all source IDs (e.g. `AR-3 + SE-1`).
6. **Prioritize:** P0 → P3 (see FINDING_FORMAT). Within a priority sort by impact ÷ effort.
7. **Write docs/TEAM_REVIEW.md** answering: what is weak, missing, already good, should not be built, would make
   it genuinely useful, should be implemented first, how each improvement is verified.
8. **Write docs/IMPROVEMENT_ROADMAP.md:** ordered items with ID(s), priority, effort, owner role, acceptance criteria.
9. **Stop and ask for approval.** Do not implement anything from the roadmap in the same run.

## Expected output
Seven Markdown files above, plus a short chat summary: counts per priority, top 5 items, rejected findings.

## Verification criteria
- Every finding has all FINDING_FORMAT fields and non-empty Evidence.
- Every number in the reports appears verbatim in a command output or file.
- External claims have URLs or are labeled UNVERIFIED.
- `git status` after the run shows only the seven docs as changes.

## Failure handling
- A specialist fails or times out → rerun once; if it fails again, write "NOT AUDITED: <reason>" in its file and
  in TEAM_REVIEW.md. Never fill in its section yourself.
- Tests cannot run (Docker/Ollama down) → record the exact error; specialists must not claim results.
- Conflicting findings → keep both, state the conflict, decide with evidence or mark "needs decision".
