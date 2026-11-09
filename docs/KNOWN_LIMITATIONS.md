# Known limitations

Updated 2026-11-09. Each item is backed by a test, a benchmark file or a direct observation.

## Product

- **Generated code Skills do not reach `verified` with the local models tested.** Benchmark C (`20261106-090709`):
  0/42 (21 × qwen2.5-coder:latest + 21 × llama3.2:3b). 33/42 reach `validated` (all static checks pass).
  Human-written reference Skills pass `verified` on the same stack. See `docs/benchmarks/PHASE1_ANALYSIS.md`.
- **"Agents" are pipeline roles**, not autonomous agents. The Agent Office shows the five real roles (Planner,
  Developer, Reviewer, Tester, Builder). Researcher and Security reviewer are shown as planned; they do not exist.
- No GitHub integration, no hosted deployment, no visual workflow editor.
- No file attachments or cancellation in the chat (the backend supports neither).
- Code Skills: Python standard library only; no external packages, programs or network.

## Platform

- **Single local user**: no accounts, no tenant isolation, global API keys. The Studio is protected only by a
  loopback check and a Host allowlist.
- Background generation runs in the API process; restarting the API abandons running jobs.
- The sandbox needs the API to run on a host with Docker. In the Compose API container it reports "unavailable".
- Rate limiting is per process.

## UX / localization

- Backend how-to-fix hints and check messages are English, also inside the Japanese UI.
- The robots are SVG illustrations, not a 3D scene (chosen to avoid a heavy dependency and to stay usable with
  reduced motion).

## Evidence quality

- Benchmark sample size: 15 independent runs per model. A 0/15 result has a 95% upper bound of 0.20.
- Benchmark A is incomplete (27/30) and its one long duration includes a laptop sleep.
- The external Codex E2E needed a project directory readable by Codex's Windows sandbox user (`--root C:\Users\Public`).
- MiroFish was requested for a multi-agent review. It is not installed or integrated on this machine. No MiroFish
  results exist.
