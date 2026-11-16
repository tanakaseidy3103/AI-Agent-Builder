# Real end-to-end generation with a local model — 2026-11-14

No mocks: Ollama 0.40.16 with `qwen2.5-coder:latest` (7.6B, Q4_K, CPU), the real pipeline, the real Docker sandbox
(`python:3.12-slim`). Script: `apps/api/scripts/e2e_real_ollama.py` (throwaway SQLite + storage, Studio data untouched).
Raw data: [`e2e-real-ollama-20261114-120825.json`](e2e-real-ollama-20261114-120825.json) (A, B) and
[`e2e-real-ollama-20261114-121621.json`](e2e-real-ollama-20261114-121621.json) (C1, C2).

After generation, an **independent oracle** runs hand-written inputs with known answers on the generated code in the
sandbox. It is how false positives are found: the pipeline's tests and eval cases are written by the same model.

## Results

| Run | Prompt / code at that time | Skill | Status | Unit tests | Eval cases | Repairs | Time | Oracle |
|---|---|---|---|---|---|---|---|---|
| A | CSV headers; quality fixes 1 (checks, contract, prompts) | validate-csv-header@0.1.0 | **verified** | 4/4 | 3/3 | 0 | 230 s | **fail 4/6** |
| B | TODO/FIXME in `data["files"]`; quality fixes 1 | find-todo-and-fixme-comments@0.1.0 | **verified** | 4/4 | 3/3 | 0 | 182 s | **pass 3/3** |
| C1 | CSV headers; + fixes 2 (stdlib parsers, format edge cases) | validate-csv-header@0.1.0 | validated | 3/6 | 2/3 | 1 | 392 s | fail 4/6 |
| C2 | same as C1 | validate-csv-header@0.2.0 | validated | 4/6 | 2/3 | 1 | 1090 s | fail 4/6 |

Oracle for A: 4/5 when it ran; 4/6 with the extended oracle used for C1/C2 ("header only" case added after A).

## What the runs show

- **A is a false positive of `verified`.** Its own 4 tests and 3 eval cases (holdout included) passed, but the code
  splits the header on `,` (quoted headers `"id","name"` not recognised) and treats a header-only CSV as having no
  header. The model's tests did not cover either case.
- **B is a real success:** verified, and correct on every judged oracle case (file and line of each TODO/FIXME,
  empty input, clean file).
- **C1/C2 (after asking for format edge cases):** the model's own tests now include an empty CSV and quoted headers,
  so the same kind of bug is caught and the status is honestly `validated`, not `verified`. The code itself did not
  improve (still no `csv` module) and one repair round did not fix it.
- No CSV Skill reached a correct `verified` state in these runs. `verified` means "passed its own tests and eval
  cases, holdout included, in the sandbox"; it does not prove correctness for inputs nobody tested.

## Measurements

| | A | B | C1 | C2 |
|---|---|---|---|---|
| model calls | 4 | 4 | 5 | 5 |
| tokens generated | 1255 | 1122 | 2215 | 2119 |
| model seconds (Ollama `total_duration`) | 220 | 172 | 379 | 1077 |
| generated tokens per model second (tokens ÷ `total_duration`) | 5.7 | 6.5 | 5.8 | 2.0 |

Correction made while writing this report: the script reused one `OllamaProvider` for every run, and the provider
accumulates per-call usage, so the stored `report.llm` of B includes A, and that of C2 includes C1 (B recorded
8 calls / 392 s, C2 10 calls / 1456 s). The values above for B and C2 are the recorded totals minus the previous run's
(the per-run token and duration totals are exact differences of cumulative counters). Status,
tests, evals and the oracle are per run and were not affected. The script now creates one provider per run; the
Studio and the demo already create one per job.

C2's throughput was about a third of the others'. The cause was not measured during that run; the likely one is
machine load: the repository lives in a OneDrive folder, and OneDrive had used more CPU time in this session than any
other process (953 CPU-seconds by 21:45), while builds and tests kept creating files for it to sync. The model
occupies ~5.5 GB of RAM when loaded and is unloaded by Ollama after idling.
