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
| `20261105-131812` | Phase 1, part A (`75eb00f`) | **Incomplete: 27/30.** The process ended with the Claude Code session. One run's duration (39 818 s) includes a laptop sleep. Kept as recorded. |
| `20261106-075956` | Phase 1, part B (`f50f3d1`) | **Complete 30/30**, sleep prevented, no suspend detected. 0/30 verified. Analysis: `PHASE1_ANALYSIS.md`. |

## Running

```bash
cd apps/api
.venv/Scripts/python.exe -u scripts/benchmark_generation.py --models llama3.2:3b qwen2.5-coder:latest --attempts 3
# continue an interrupted run (same code commit only):
.venv/Scripts/python.exe -u scripts/benchmark_generation.py --models llama3.2:3b qwen2.5-coder:latest --attempts 3 --resume <stamp>
```

Each row records: model, task, difficulty, attempt, seed, LLM and validation seconds, total seconds, `timing_valid` /
`host_suspended_s`, repair rounds and per-round history, tests, eval cases, status, `failure_category`,
`first_failure`, `code_sha`. `meta.complete` stays `false` until the last run is written.

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
