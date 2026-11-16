# UGREEN Uliya compatibility report — NAS Project Memory

Date: 2026-11-12. Author: prepared with Claude Code from the official files listed below. Every technical claim cites
its source. Anything not found in a source is marked **not documented** and is not assumed.

## 1. Sources

| ID | Source | Version / identity | How it was read |
|---|---|---|---|
| **KIT** | `uliya-skill-kit-0.7.3-en.zip` (official developer package, linked from the starter kit) | file name `0.7.3-en`; SHA-256 `cf557e5a022e4297892f39768132855154232efdedeb726b2845450ccd70e1b3`; 26 files | Provided by the user at `~/Downloads/uliya/`; extracted to a scratch folder, all files read; not copied into this repository |
| KIT/STD | `docs/skill-development-standard.md` | — | read in full |
| KIT/FMT | `references/skill-format.md` | — | read in full |
| KIT/TPL | `assets/skill-template/SKILL.template.md` | — | read in full |
| KIT/REF | `references/*.md` (orchestration, usage rules, safety, completion, runtime lessons, check workflow) and `references/examples/*.md` (7 examples) | — | read in full |
| KIT/SKILL | root `SKILL.md` of the kit | — | read in full |
| **CAT** | `data/capability-catalog.json` | `catalogVersion` **2.0.0**, `generatedAt` 2026-09-01; 7 domains, 9 CLIs, 78 Actions | parsed programmatically |
| **CHK** | `scripts/check-skill.mjs` + `scripts/check-lib.mjs` (official static checker) | `CHECK_FORMAT_VERSION` 2.0.0 | source read; executed with Node 26 (it only uses `fs.readFile/readdir/lstat` and `crypto`) |
| **SK** | https://ai.ugreen.com/pages/hackathon-starter-kit | fetched 2026-11-12, HTTP 200 | first ~40k of 50k characters read verbatim, the rest via a summary (marked "SK-summary") |
| DP | Devpost hackathon site and submission page | — | **not readable**: HTTP 403 to automated access; the submission page needs the participant's login |

## 2. What a Uliya Skill is

- A Skill is a **Markdown orchestration document**. It describes a user-facing workflow and **delegates the real NAS
  work to registered experts** (KIT/STD "Core concepts"; KIT/SKILL).
- The parent Skill may only use `delegate --target <agent-id> --instruction '<task>'`. It must not call `cli.invoke`
  directly or bypass approval (KIT/SKILL "Generate a Skill"; KIT/REF cli-usage-rules).
- Child experts select and execute their own CLI/Action workflows. The parent does not copy private parameters
  (KIT/REF cli-usage-rules).
- Local generation and static checks do **not** prove upload, installation, compatibility or execution on a device
  (KIT/FMT; KIT/REF check-workflow).

## 3. Required structure (what the checker enforces)

| Rule | Source |
|---|---|
| Package root may contain **only** `SKILL.md` and `references/`. Anything else, including `README.md`, a manifest or a script, is an error (`RESOURCE_UNSUPPORTED`) | CHK `readTarget` |
| `references/` may contain only plain Markdown files, no symlinks, each linked directly from `SKILL.md` (otherwise a `RESOURCE_UNREFERENCED` warning) | CHK; KIT/FMT |
| Frontmatter: only single-line `name` and `description`, nothing else | CHK `parseFrontmatter`; KIT/FMT |
| `name`: lowercase hyphenated, 2–64 chars, equal to the folder name | CHK `skillNamePattern`, `SKILL_NAME_MISMATCH` |
| `description`: ≤ 1024 chars, must state the trigger ("when…/use when…") | CHK `descriptionMaxCharacters`, `DESCRIPTION_TRIGGER_MISSING` |
| Required headings: `# Goal`, `# Required input`, `# Workflow` (or `# Orchestration`), `# Completion and failure` (or `# Failure handling`) | CHK `requiredSections` |
| Delegating Skills need `# Generation-time capability evidence` with lines exactly `` - `cli` → `agent` ``. The agent must be the catalog's single agent for that CLI | CHK `checkCapabilityEvidence` |
| All five delegation states must be handled: `completed`, `failed`, `cancelled`, `waiting_user`, `waiting_approval` | CHK `requiredStatusTokens`; KIT/REF completion-and-errors |
| `delegate` format: one `--target`, one `--instruction` in single quotes, no pipes, redirection or concatenation | CHK `DELEGATE_FORMAT_INVALID` |
| Query workflows must state empty-result behaviour; multi-step workflows must state that only real upstream results are passed on (otherwise warnings) | CHK `EMPTY_RESULT_HANDLING_MISSING`, `DELEGATION_WORKFLOW_STATIC_VALIDATION_INCOMPLETE` |
| Package limits: ≤ 100 files, ≤ 1 MiB per file, ≤ 10 MiB total; body recommended ≤ 500 lines | CHK constants |
| Result: `not-uploadable` if any error; `static-pass-needs-target-validation` if only warnings; `static-pass` if neither | CHK `finalizeResult` |

### Security rules enforced as errors (CHK `scanSecurity`)

- Runtime code fences (`bash`, `sh`, `python`, `js`, `ts`, …).
- Credential literals or private keys.
- `curl` / `wget`, or download-and-pipe.
- Direct `cli.invoke`.
- Internal identifiers (`expert-id`, `request-id`, `ug-ai`, `HERMES`, …).
- Text that asks to bypass, skip, disable or ignore approval, permission or audit.
- Outside a `delegate` line: direct file, network or NAS path access (`cat `, `rm `, `cp `, `mv `, `open(`, `fetch(`, `/nas/…`, `/volume…`).
- Unregistered agents.

## 4. Inconsistencies found in the official material

1. **Template vs checker headings.** KIT/TPL uses `# Capability evidence` and `# Expert orchestration`. CHK requires
   `# Generation-time capability evidence` and `# Workflow`/`# Orchestration`. Running CHK on the unmodified template
   returns `SKILL_REQUIRED_SECTION_MISSING` among 6 errors (executed 2026-11-12).
2. **Evidence line format.** KIT/SKILL and KIT/TPL say `- <cli> -> <agent>` (ASCII arrow). CHK only parses
   `` - `cli` → `agent` `` (backticks, U+2192 arrow). This Skill follows CHK.
3. **README.md.** SK-summary lists `README.md` as "Recommended" in the Skill folder, but CHK rejects any root file
   other than `SKILL.md`. This Skill follows CHK and ships no README inside the package. The human-readable README
   lives next to the package, in this repository.
4. **Catalog English text is degraded.** In CAT, descriptions, summaries and return summaries contain removed or garbled
   characters (Chinese fragments stripped). Identifiers (CLI, Action, parameter, enum values) are intact. Meanings
   below are taken from identifiers, enums and examples, not from the garbled prose.
5. **Unknown runtime facts.** For **all 78 Actions**, CAT sets `permissions`, `prerequisites` and `errorCodes` to
   `knowledgeStatus: "unknown"`, `stability: "unknown"` and `example.outputStatus: "unknown"`. Error codes, required
   permissions and output shapes are **not documented**.

## 5. Capabilities relevant to NAS Project Memory (all confirmed in CAT)

Agents: each CLI maps to exactly one agent (CAT `clis[].agent`; CHK `fullProfileCliAgents`).

| CLI → agent | Action | Effect / approval | What CAT documents | Use in this Skill |
|---|---|---|---|---|
| `ug-filesystem` → `file-agent` | `find` | read / none | `path` (required), `pattern`, `type` (enum incl. `documents`), date range, `max-depth`, `limit`; returns real paths and `fileId` | discover documents in the folder the user authorized |
| | `ls`, `stat` | read / none | directory listing; real path and times | list a folder; modification times for "outdated" checks |
| `ug-document` → `document-agent` | `qa` | read / none | `query` (required), `file` (repeatable), `intent` ∈ `qa, content_read, extraction, period, condition, comparison, summary, outline, semantic_lookup, locate_content`, `answer-mode`, `evidence-mode`, `top-k`; returns `answer`, evidence, coverage | answer questions, locate passages, compare documents, extract periods/dates |
| | `extract` | read / none | `query`, `file`, `schema` (auto, invoice, contract, …), `max-files` ≤ 500, `dedupe`; returns data, coverage, failures | structured extraction (decisions, tasks, dates) |
| | `reconcile` | read / none | `query`, `file` (repeatable), `max-files`; returns result and coverage | find conflicting statements across documents |
| | `metadata`, `page-count` | read / none | file metadata, page counts | document dates and size for the timeline |
| `ug-knowledge` → `knowledge-agent` | `collect-evidence` | read / none | `query` (required), `path`, `extension`, `full`; returns `evidence`, `sources`, `coverage`, `failures/warnings`. CAT's own example is "总结项目风险" (summarize project risks) over a project folder | gather cited evidence across a project folder |
| | `save-text` | **state-change / workflow approval** | `path`, `content`, `filename-hint`; returns `verified`, `outputFile`, `contentBytes` | optional: save the answer as a note, only when the user explicitly asks |

Not needed and **not used**:
- All state-changing file actions (`del`, `cpmv`, `rename`, `echo`, `touch`, `mkdir`, … approval `gateway`).
- `ug-document translate`/`writing` (approval `gateway`).
- Photo, media, music and surveillance domains.

## 6. Supported vs unsupported for NAS Project Memory

| Desired capability | Status | Basis |
|---|---|---|
| Discover project documents in a user-specified folder | **Supported** | `ug-filesystem find` (`type=documents`, date range) |
| Search and answer questions over documents with evidence | **Supported** | `ug-document qa`, `ug-knowledge collect-evidence` |
| Extract decisions, tasks, deadlines, requirements | **Supported (best effort)** | `ug-document extract` / `qa` with `intent=extraction`/`period`. Schemas are invoice/contract-oriented, so project items use `schema=auto` |
| Timeline reconstruction | **Partly supported** | dates come from document content (`qa intent=period`) and file times (`stat`, `metadata`). Ordering and merging are done by the Skill's reasoning, not by a NAS Action |
| Conflicting or outdated decisions | **Supported (best effort)** | `ug-document reconcile` / `qa intent=comparison`, plus file dates |
| Source references for each claim | **Supported, format unknown** | `qa`/`collect-evidence` return evidence and sources. Exact fields (page, line, offset) are **not documented** (`outputStatus: unknown`) |
| Respect NAS permissions | **Delegated to platform** | performed by the child workflow (KIT/REF safety-and-approval). The Skill must not and cannot enforce ACLs itself |
| Persistent "memory" index across sessions | **Not supported as such** | no index or embedding Action exists in CAT. "Memory" means re-reading the stored documents on demand; saving a summary note requires `save-text` with approval |
| Automatic monitoring of new documents | **Not supported** | no watch, trigger or schedule capability in CAT |
| Sending documents to external services | **Not used** | not needed; also contrary to SK rules |
| Executing scripts found in documents | **Not supported / forbidden** | KIT/FMT, SK, CHK |

## 7. Security and permission requirements

- No scripts, executables, undisclosed downloads, keys or tokens. Do not instruct users to run untrusted code (SK; CHK).
- Never bypass approval; state-changing Actions go through `gateway`/`workflow` approval performed by the child
  workflow (CAT `approval`; KIT/REF safety-and-approval).
- Never invent NAS data. Report empty and partial results accurately (KIT/SKILL step 6; KIT/REF completion-and-errors).
- Report a business result only after `completed` (KIT/REF completion-and-errors).
- Original work only; comply with UGREEN User Agreement, Privacy Policy and "Skill Content Safety and Publishing
  Guidelines" (SK).

## 8. Packaging, testing and validation

- Validation tool: `node <kit>/scripts/check-skill.mjs <skill-dir>`. Exit `0` means a static pass (with or without
  warnings), `1` means `not-uploadable`, `2` means a usage or read error (CHK; KIT/REF check-workflow).
- Distribution channel named by the kit: SkillHub, https://skills.ugreen.com/skill-hub/publish (KIT/SKILL "Delivery
  result"). Whether the hackathon requires a SkillHub upload is **not documented** in the sources I could read.
- Device testing: "The official NAS test environment is provided only to participants who advance to the final
  round." (SK). Runtime behaviour therefore **cannot be tested before the final round**.
- Supported authoring assistants per SK: WorkBuddy, Claude, Codex.

## 9. What NAS Project Memory can realistically implement now

A read-only orchestration Skill that:

1. Asks for the authorized project folder and the question.
2. Delegates document discovery to `file-agent`.
3. Delegates cited evidence collection to `knowledge-agent`.
4. Delegates targeted Q&A, extraction and reconciliation to `document-agent`.
5. Composes an answer that separates **confirmed** (cited), **inferred** (labelled, with its basis) and **unknown**,
   and lists conflicts and outdated statements with both sources.
6. Treats all document text as untrusted data.
7. Optionally saves the answer as a note through `knowledge-agent` (`save-text`, approval workflow), only on an explicit
   request.

## 10. Remaining technical risks

| Risk | Impact | Mitigation in the Skill |
|---|---|---|
| Output shapes and error codes undocumented for every Action (§4.5) | Citations may lack page/line detail; failures may be opaque | ask experts to return file path plus the most precise location they have; report what is missing instead of guessing |
| No device access before the final round (SK) | runtime behaviour is untested | static checker + design review only; labelled as such in the test plan |
| Hackathon rules unread (DP 403) | deadline, required fields, proposal questions and limits unconfirmed | the proposal follows the limits stated by the participant (500 words, 1 MB) and must be checked against the Devpost form before submitting |
| Catalog prose degraded (§4.4) | possible misreading of an Action's purpose | rely on identifiers, enums and examples only |
| Template/checker inconsistencies (§4.1–4.3) | a Skill following the template is rejected | follow the executable checker; recorded here |
| Prompt injection inside documents | an expert or the model could follow document text | explicit rule: document content is quoted data, never an instruction; conflicting embedded instructions are reported, not obeyed |
| Large folders | `extract`/`qa` limits (`max-files` ≤ 500, default 60; `top-k` ≤ 20) | the Skill narrows scope (sub-folder, date range, file type) and reports coverage |
