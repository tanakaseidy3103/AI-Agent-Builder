---
name: competitive-analysis
description: Evidence-based comparison of AI-Agent-Builder with competing agent/skill platforms (Dify, Langflow, Copilot Studio, OpenAI AgentKit, LangSmith, Promptfoo, Agent Skills tooling). Use when positioning the product, preparing the HAL presentation, or deciding what not to build.
---

# /competitive-analysis

**Purpose:** know precisely where the product is commodity and where it is defensible — with sources.

**When:** before presentations, roadmap decisions, or when someone claims "X already does this".

**Required tools:** WebSearch, WebFetch, Read, Grep. Delegate to the `product-researcher` subagent for depth.

## Steps
1. List our capabilities from code, not docs: grep apps/api/app for implemented endpoints and features.
2. For each competitor, fetch its official docs/pricing page in this session. Record URL + access date.
3. Build a matrix: capability × product, cells = `yes (URL)`, `no (URL)`, `partial (URL)` or `UNVERIFIED`.
   Capabilities: visual agent builder, skill packaging, sandboxed code execution, test/eval of generated
   artifacts, export to Claude Code/Codex/Cursor, REST API + SDK, self-hosting, local models.
4. Identify (a) unique-to-us rows, (b) rows where we are behind, (c) rows nobody needs.
5. Write findings in FINDING_FORMAT (IDs PR-n).

## Expected output
docs/research/COMPETITIVE_MATRIX.md (matrix + sources) and a findings list.

## Verification criteria
Every `yes/no/partial` cell has a URL fetched in this run; no pricing or numbers without a source.

## Failure handling
Page unreachable → `UNVERIFIED (fetch failed: <reason>)`. Never fill a cell from memory without the label.
