# Phase 1 analysis: Skill Compiler reliability

Date: 2026-11-06 · Branch `feature/phase1-compiler-reliability` · Data: the three benchmark files in this folder.
All numbers below come from those files or from the benchmark run databases. Nothing is estimated.

## 1. Results

| Run | Compiler commit | Model | Independent samples | verified | validated | validation_failed | Unit tests passed | Eval cases passed | Median s | Avg repairs |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline `20261105-121419` | `43e661e` (old hash) | llama3.2:3b | 5 (fixed seed) | 0 | 0 | 15 | 0/0 | 0/0 | 25 | 0.6 |
| baseline | | qwen2.5-coder | 5 (fixed seed) | 0 | 12 | 3 | 12/48 | 5/36 | 147 | 2.4 |
| A `20261105-131812` (27/30, interrupted) | `75eb00f` | llama3.2:3b | 15 | 0 | 12 | 3 | 6/39 | 0/44 | 88 | 3.0 |
| A | | qwen2.5-coder | 12 | 0 | 11 | 1 | 16/38 | 4/33 | 186 | 3.0 |
| **B `20261106-075956`** (30/30, sleep prevented) | `f50f3d1` | llama3.2:3b | 15 | **0** | 12 | 2 (+1 job error) | 1/44 | 0/47 | 61 | 1.6 |
| **B** | | qwen2.5-coder | 15 | **0** | 11 | 4 | 17/35 | 5/33 | 91 | 0.8 |

With n = 15 independent samples per model in B, 0 verified gives a 95% Wilson upper bound of 0.20. The data cannot
claim that either model's verified rate is above zero. It also cannot claim a difference between the models in
verified rate. The difference in unit-test pass rate (17/35 vs 1/44) is large, and it is why the default model is
now `qwen2.5-coder:latest`.

**Conclusion: the compiler now measures generated Skills honestly. With these local models, it does not produce
verified Skills.**

## 2. What Phase 1 fixed (root causes with evidence)

| # | Problem found | Evidence | Fix (commit) |
|---|---|---|---|
| 1 | Code generated inside JSON strings broke on escapes | 3/6 historical syntax errors at string/regex literals | code requested as fenced blocks (`27b63a6`) |
| 2 | Eval cases ignored the Skill's input schema | baseline: 10/15 llama failures were `files` given as a list | cases schema embeds `input_schema` (`bd645a3`) |
| 3 | Fixed seed made "3 attempts" identical | baseline qwen gave `tests 3/5, evals 1/3` three times | seed per attempt (`910c443`); CI over distinct code only (`2e7b153`) |
| 4 | Repair saw "did not contain" but not what was expected | — | repair gets the input, expected and actual of each failed case (`50e4a3d`) |
| 5 | Hallucinated stdlib APIs only failed at run time | A: `ast.ExceptType`, 9 `AttributeError`s | static `python.api` check (`22f215b`) |
| 6 | Repairs repeated identical failures | A: every run used all 3 rounds | per-round history, stop on no progress (`cae7812`, `5c9a885`); B avg repairs 3.0→0.8 (qwen) |
| 7 | Laptop sleep corrupted durations | A: one run "took" 39 818 s (Kernel-Power sleep 23:12→10:10) | suspend detection + `SetThreadExecutionState` (`ecc49e3`, `5d72e5a`) |
| 8 | Interrupted runs could not continue | A stopped at 27/30 | `complete` flag + `--resume` (refuses a different commit) (`87bb185`) |
| 9 | Repairs could special-case visible eval inputs | repair prompt contained expected outputs | one holdout case hidden from code generation and repair (`23176c8`) |
| 10 | Repair said what was wrong, not how to fix it | `laravel-bug-analyzer@0.2.0`: same `subprocess` + `phpstan` code twice | hints in repair feedback (`786924a`) |
| 11 | Expectations shaped like a single finding | B: 5/30 runs (both models) | `expect.contains` constrained to output-schema properties (`8be2a9a`); confirmed with real Ollama |

None of these changes loosened `verified`. Changes 5, 9 and 11 make it **harder** to reach.

## 3. Why generated Skills still fail (benchmark B)

- **Categories:** `test_failure` 21, `spec_error` 5 (fix #11 addresses these), `eval_failure` 2, `syntax` 1,
  `generation_error` 1.
- **Eval case failures:** 57 × "output does not contain expect.contains", 7 × `TypeError`, 5 × `JSONDecodeError`,
  5 × `ValueError`, 1 × `IndentationError`. The generated code runs but computes the wrong thing, or crashes on
  realistic inputs.
- **Weak tests are caught.** In some runs, tests passed 3/3 while the code returned `{"issues": []}` for inputs
  with obvious defects. The spec-derived eval cases caught it (B: `react-a11y`, `tests 3/3 evals 0/3`).
- **The validator is not the bottleneck.** The 5 human-written reference Skills pass the same checks (`verified`).
  Negative controls (wrong expectation, regressed code, nondeterminism, do-nothing code, trivial tests, code fitted
  to visible cases) are all rejected in tests.

## 4. Recommendations (prioritized)

1. **Measure fix #11** with a new benchmark C. It is expected to remove most `spec_error` runs. Do not claim this
   until measured.
2. **Try a stronger local code model** (7B is the size tested; a 14B+ coder model may change the picture). Needs
   user approval for the download and GPU time (6 GB VRAM limits the size).
3. **Spec-first tests:** generate unit tests from the spec and eval inputs, not from the generated code, so tests
   stop mirroring the code's bugs.
4. **Smaller tasks:** decompose multi-rule tasks (e.g. Laravel: 5 rules) into one rule per Skill. Every generated
   failure in B came from multi-rule prompts.
5. Keep reporting `validated` and `verified` separately. Never merge them in metrics.
