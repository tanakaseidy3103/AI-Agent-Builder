# Performance and API request discipline

Measured, not estimated. Probes live in `apps/web/e2e/requests.spec.ts` (mocked API, deterministic) and run with the
normal Playwright suite, so a regression fails CI-style instead of going unnoticed.

## Polling and cache durations

| Data | Query key | Who refreshes it | Interval / freshness |
|---|---|---|---|
| A generation job | `["job", id]` | only the conversation turn that owns the job (`useJob(id, true)`) | 1 s while `draft`/`generating`; stops when `completed`/`failed` |
| Agent events of a run | `["events", runId]` | only that run's activity stream (`useRunEvents(job, true)`) | 1 s while the job is live; one final fetch when it settles; then never |
| Everything else (agents, jobs, evaluations, office agents, skills) | e.g. `["skills"]` | any screen | cached 30 s (`staleTime`), refreshed once when a job settles (invalidation by the owner only) |
| Installed models | `["models"]` | Studio, sidebar, Settings | cached for the session; **Integrations** refreshes on open because "loaded now / GPU share" changes |
| Health | `["health"]` | sidebar | once per session |

Polling also pauses while the browser tab is hidden (TanStack Query default `refetchIntervalInBackground: false`).
Other components (Studio, Agent Office stage, agent panel, robot) read the same cache without timers of their own.

## Measurements

| Probe | Before | After |
|---|---|---|
| Event polls during a 7.5 s live window | 11 (≈1.5/s: four observers each with its own 1 s timer + four final refetches) | **7** (1/s, −36%) |
| Job polls in the same window | 7 | 7 |
| Requests after the job ends (4 s) | 0 | 0 |
| Navigating all 8 pages twice: requests per list | 1 each | 1 each (models: 3 = 1 + one refresh per Integrations visit, by design) |

## Model performance (real, from Ollama)

Every Ollama reply carries its own token counts and durations. The pipeline records them per call and stores a summary
in the validation report (`report.llm`): calls, prompt/output tokens, model seconds, load seconds and output
tokens/second. The Studio shows it in the Validation tab. `GET /studio/models` adds `runtime` from Ollama `/api/ps`
(loaded models, size, share in GPU memory, "CPU" when 0%). Nothing is downloaded and the default model is unchanged.
No model is claimed faster than another without a benchmark (`apps/api/scripts/benchmark_generation.py`).

Real run through the UI (2026-11-09, `qwen2.5-coder:latest`, "Python code review" sample, code Skill, 1 repair round):

| Measure | Value |
|---|---|
| Model calls | 5 (spec, eval cases, code, tests, 1 repair) |
| Prompt / output tokens | 2,761 / 1,650 |
| Model time / of which loading | 97.3 s / 6.9 s |
| Output speed | 18.9 tokens/s |
| Placement (`/api/ps`) | 5.4 GB, 79 % in GPU memory, the rest on CPU |
| Wall time of the whole run (UI test) | 1.8 min |
| Result | `python-code-analysis@0.6.0` validated, not verified (unit tests and eval cases failed) |

One run on one machine: a measurement, not a benchmark.

## What was deliberately not changed

- Validation, sandbox tests and evaluation cases still run in full; the repair loop keeps its bound and no-progress stop.
- Events are re-fetched as a whole list (max 500) rather than incrementally: a run produces ~30 events (a few KB);
  incremental `after=` fetching would add state for no measurable gain at this size.
- Pages are not lazy-loaded: the whole app is 405.6 KB (120.4 KB gzip; it was 391 KB / 116 KB before the highlighter,
  robot and project steps were added) and the largest page adds only a few KB; splitting would add requests on navigation.
- No editor dependency: syntax highlighting is a ~50-line per-line tokenizer (`workspace/highlight.ts`) instead of an
  editor package that would add hundreds of KB.
