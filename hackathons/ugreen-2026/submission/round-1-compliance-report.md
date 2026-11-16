# Round 1 compliance — NAS Project Memory

Checked 2026-11-16 against the official Round 1 requirements (Devpost overview page, read 2026-11-14) and the
official Uliya Skill Kit 0.7.3 (SHA-256 `cf557e5a…e1b3`). Replaces the 2026-11-12 version, which marked the ZIP as
passing although it lacked the required disclosure.

**Deadline:** the overview page stated 2026-11-15 11:45 pm PT. Whether a submission can still be made or edited must
be checked on Devpost by the participant.

## Skill package (`nas-project-memory.zip`)

| Requirement | Result | Evidence |
|---|---|---|
| ZIP ≤ 10 MB | PASS | 9,070 bytes |
| ≤ 100 files, each ≤ 1 MB | PASS | 6 files, largest 8,935 bytes |
| `SKILL.md` at the root, frontmatter with `name` and `description` only | PASS | official checker |
| References are Markdown, linked directly from `SKILL.md` | PASS | 5 references, all linked (test `test_every_reference_is_linked_from_skill_md`) |
| No scripts, binaries, separate manifests or credentials | PASS | `zip-validation.json`: only `SKILL.md` and `references/*.md`, UTF-8 text, no key patterns |
| Disclosure: third-party components and licenses, functionality developed for the Hackathon, AI tools and their uses | PASS (fixed 2026-11-16) | `references/disclosure.md`, linked from `SKILL.md`; test `test_package_declares_what_the_rules_require` |
| Official checker | PASS | `static-pass`, 0 errors, 0 warnings, on the source and on the extracted ZIP |

## Proposal (`project-proposal.pdf`)

| Requirement | Result | Evidence |
|---|---|---|
| English, ≤ 500 words | PASS | 440 words: every rendered word on the page, headings included (`proposal-validation.json`) |
| PDF ≤ 1 MB | PASS | 61,742 bytes, 1 page |
| Answers the ten items (what, user and problem, solution, user flow, difference, NAS features per step, technical approach, built/not built/to test, two core and one edge test case, limits and dependencies) | PASS | numbered 1–10 in the PDF |
| Accuracy | reviewed | the single write (`save-text`, approval) is stated; AI-Agent-Builder is described as an earlier, separate project and its use for Uliya as future work; no claim of device execution |

## Not covered by Round 1 and still open

- Execution on a UGREEN NAS (device access only for finalists). Procedure: `../tests/test-plan.md`.
- Upload to SkillHub, if the participant wants to publish it.
- Submitting both files on Devpost: done by the participant.
