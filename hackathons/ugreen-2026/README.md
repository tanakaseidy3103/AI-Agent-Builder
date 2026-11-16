# UGREEN Hackathon 2026 on AI NAS — NAS Project Memory

A Uliya Skill that answers questions about a project from the documents stored on a UGREEN AI NAS. Every claim cites
its source. Confirmed, inferred and unknown information are kept apart, and conflicting or outdated decisions are
reported with both sources.

This folder is **separate from AI Agent Builder**: the Skill follows the Uliya standard, which is Markdown-only and
delegates to registered NAS experts. AI Agent Builder's own Skill format (code, tests, eval cases, sandbox) is not
changed by it.

## Contents

| Path | What |
|---|---|
| `skill/nas-project-memory/` | the Skill source: `SKILL.md` + `references/` (answer format, untrusted documents, question patterns, setup and testing, disclosure) |
| `submission/nas-project-memory.zip` | the Skill package to upload (built, never edited by hand) |
| `submission/project-proposal.pdf` | the proposal (built from `project-proposal.html`) |
| `submission/zip-validation.json`, `proposal-validation.json` | the last validation results |
| `research/compatibility-report.md` | what the official kit and catalog support, with sources; inconsistencies found |
| `tests/test-plan.md` | test levels, results, and the device test procedure |
| `tests/test_skill_package.py` | 29 automated tests (official checker, ZIP, specification, required disclosure) |
| `tests/fixtures/` | sample project documents with planted conflicts, gaps, duplicates, injection, out-of-scope file |
| `scripts/build_submission.py` | builds and validates the ZIP (Python standard library) |
| `scripts/build_proposal.mjs` | renders the proposal PDF and checks words and size |

## Reproduce

The official kit is **not** included in this repository. Download `uliya-skill-kit-0.7.3-en.zip` from the starter kit
(https://ai.ugreen.com/pages/hackathon-starter-kit) and either put it in `~/Downloads/uliya/` or set `ULIYA_KIT_ZIP`.
The scripts verify its SHA-256 (`cf557e5a…e1b3`) before use. Node.js is required for the official checker.

```text
# from the repository root
apps/api/.venv/Scripts/python.exe hackathons/ugreen-2026/scripts/build_submission.py   # ZIP + validation
node hackathons/ugreen-2026/scripts/build_proposal.mjs                                  # PDF + validation
apps/api/.venv/Scripts/python.exe -m pytest hackathons/ugreen-2026/tests -v              # 29 tests
```

## Submission checklist (2026-11-16)

| Item | Status |
|---|---|
| Skill passes the official checker (`static-pass`, 0 errors, 0 warnings) | done |
| ZIP validated from an extracted copy (structure, limits, no scripts or credentials) | done: 6 files, 9,070 bytes |
| Required disclosure (third-party components and licenses, work done for the Hackathon, AI tools) | done: `references/disclosure.md` |
| Install, removal and testing notes (Technical Quality criterion) | done: `references/setup-and-testing.md` |
| Proposal answers the ten official items | done: numbered 1–10 |
| Proposal PDF: English, ≤ 500 words, ≤ 1 MB | done: 440 words, 61.7 KB, 1 page |
| Deadline (stated 2026-11-15 11:45 pm PT) and Devpost submission | **the participant must check on Devpost** whether submitting or editing is still possible |
| Upload to SkillHub | not done; needs the participant's account |
| Test on a UGREEN NAS | blocked until the final round (device access only for finalists) |
| Repository licence | to decide: the repository has no LICENSE file |

Details: [`submission/round-1-compliance-report.md`](submission/round-1-compliance-report.md).
