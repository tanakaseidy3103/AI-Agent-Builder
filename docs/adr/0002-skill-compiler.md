# ADR 0002 — Skill Compiler: package format, validation and isolation

Date: 2026-11-05 · Status: accepted

## Decisions

1. **SKILL.md + manifest.json** as the canonical package. SKILL.md frontmatter follows the Agent Skills convention
   (Claude Code, Codex), so the canonical package is directly installable there; manifest.json carries what tools
   ignore (schemas, permissions, execution, tests).
2. **Three statuses** (`validation_failed → validated → verified`; renamed from `generated` in migration 0003). LLM output is never trusted by default; only sandboxed
   tests earn `verified`.
3. **Docker sandbox without mounts**, driven by the host `docker` CLI. No Docker socket inside the API container
   (that would grant root on the host). Consequence: full pipeline requires running the API on the host.
4. **Python stdlib only** for generated code in the MVP. The sandbox is offline, so dependencies cannot be installed;
   declaring one fails validation rather than pretending.
5. **Deterministic templates** for everything that does not need a model (README, cli.py, docs, frontmatter).
   The model writes only the spec, `scripts/main.py` and tests. A bounded repair loop (default 3 rounds) with frozen tests; see docs/skills.md §2.
6. **Files on disk, metadata in Postgres.** Versions are immutable directories keyed by version id.
7. **Export = ZIP + non-overwriting commands.** A future companion app may automate installation; the API never
   claims something was installed.
8. **Studio local-only** until user authentication (Phase 1); public `/v1` is API-key protected.
