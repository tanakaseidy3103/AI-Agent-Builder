# Finding format (shared by every specialist)

Every finding MUST use exactly this block. Findings without evidence are rejected by the aggregator.

```markdown
### [P0|P1|P2|P3] <short title>
- **ID**: <ROLE>-<n>   (PR=product, AR=architecture, AI=ai-platform, QA=qa, SE=security)
- **Problem**: what is wrong or missing, one or two sentences.
- **Evidence**: file:line, command + real output, or URL (for external facts). Never "probably".
- **User impact**: who is affected and how.
- **Technical impact**: what breaks, degrades or becomes costly.
- **Severity**: critical | high | medium | low
- **Effort**: S (< 0.5 day) | M (0.5–2 days) | L (> 2 days)
- **Proposed solution**: concrete change, smallest that works.
- **Acceptance criteria**: an objective check (test name, command, metric threshold) that proves it is fixed.
```

Priorities:
- **P0** critical functionality or security failure
- **P1** core product reliability
- **P2** user experience and differentiation
- **P3** optional enhancement

Rules:
- Read-only during audits: do not edit, create, delete, commit, install, push, or start long-running services.
  Running existing tests and read-only commands (`git log`, `pytest`, `npm test`, `grep`) is allowed.
- Report command output verbatim when it is evidence; never paraphrase a number.
- External facts (competitors, tool formats) need a URL fetched in this session, or must be labeled
  `UNVERIFIED (from memory)`.
- Also list **what is already good** (with evidence) and **what should NOT be built** (with reasoning).
