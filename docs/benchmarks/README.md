# Generation benchmarks

Each file pair `<stamp>.json` / `<stamp>.md` is one run of `apps/api/scripts/benchmark_generation.py`:
real Ollama models + the real Docker sandbox, kind=code forced, 5 tasks (easy: project-docs; medium: python-analyzer,
api-test-plan; hard: react-a11y, laravel-bugs). Files are never edited after a run; a new run gets a new stamp.
These numbers describe **LLM-generated** Skills only. The human-written reference Skills are evaluated separately.

## Methodology

- **One row = one full pipeline run**: spec → code → tests → eval cases → bounded repair loop → sandbox → evaluation.
- **Status comes only from the validator** (`app/skills/evaluation.py`). The model never sets it.
- **Independent samples.** Since Phase 1, attempt *i* uses `seed = 42 + i`, recorded per row as `seed`. Rows whose
  generated `scripts/main.py` + `tests/test_main.py` are byte-identical for the same model and task (`code_sha`)
  count as **one** observation. Rates and 95% Wilson intervals use only those independent samples.
- **Recorded conditions** (`meta`): git commit, Ollama version, model digests, sampling options, repair budget,
  sandbox image id, GPU, host.

## Runs

| File | Compiler | Notes |
|---|---|---|
| `20261105-121419` | before Phase 1 | **Baseline, kept as-is.** `seed=42` for every attempt, so the 3 attempts per task produced identical outputs. The effective sample is 1 per task per model (n=5 per model), not 15. Its `.md` Wilson intervals assume n=15 and overstate certainty. Result: 0/30 verified. |
| (next) | after Phase 1 | per-attempt seeds; eval-case schema embeds the Skill input schema; repair gets input/expected/actual of failed evals |

## Commit hashes in old files

The local history was rewritten once (2026-11-05, before the first push) to fix the commit author identity. Trees,
messages and dates are unchanged, but hashes changed. Old hashes cited in earlier files map as follows:

| Old | New | Commit |
|---|---|---|
| `43e661e` | `bb17f5a` | fix(compiler): bounded Ollama output… (baseline `meta.git_commit`) |
| `3163dc2` | `fa831ee` | fix(installer): Codex/Cursor paths; real Codex E2E |
| `0b84065` | `27b63a6` | feat(compiler): objective verified status… |
| `e518fe4` | `81e4805` | test(e2e): real Claude Code E2E |
| `360a628` | `01a5f31` | fix(e2e): redact home path |
