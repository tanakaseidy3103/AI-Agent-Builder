# 90-Second Demo Plan — AI Agent Builder
## HAL Nagoya 就職作品 / AI Hackathon Presentation

Audience: Japanese engineering faculty, recruiters, peers who have never seen the product.
Goal: show the full value loop — describe → generate → validate → repair → export — in 90 seconds.

---

## Setup before the presentation (5 minutes prior)

1. Start the backend: `cd apps/api && uvicorn app.main:app --reload`
2. Start the frontend: `cd apps/web && npm run dev`
3. Open http://localhost:5173 in the browser. Switch language to 日本語 if the audience is Japanese.
4. Verify Ollama is running: `ollama list` should show `qwen2.5-coder:latest`.
5. If you want a live generation: start one before the demo so it finishes during the walkthrough.
   Alternatively, use a pre-generated `validated` agent (the demo is not a live generation race).
6. Keep one pre-generated `validated` Skill open in a second tab (the validation tab with failures visible).

---

## 90-Second Script

| Time | What to show | What to say |
|---|---|---|
| 0–5 s | Home / Overview page | "AI Agent Builder: describe an agent in natural language, get a reusable, tested component that works in Claude Code, Codex, or Cursor." |
| 5–8 s | Switch to Studio, point at the 3-step banner | "Three steps: describe it, the AI builds and tests it, then export it anywhere." |
| 8–15 s | Type (or show pre-typed) a prompt: "Create an agent that reads Python files, finds lines with `TODO` or `FIXME` comments, and reports them with file and line number." Click Generate. | "I describe it once in plain language. The pipeline starts: Planner, Developer, Reviewer, Tester, Builder — each is a real stage." |
| 15–22 s | Point at the Agent Office pipeline tiles animating (or a screenshot if live) | "10 real stages, each persisted. If the API restarts during generation, the job state survives." |
| 22–28 s | Show the Validation tab — point at static checks ✅ and one failed criterion | "Deterministic AST checks: forbidden imports, hallucinated stdlib APIs, hardcoded secrets. Zero LLM-judge in the verdict." |
| 28–38 s | Show repair round (or the repair history in the report) | "If tests fail, the platform feeds the exact traceback back to the model — input, expected, actual — and repairs it. It stops when there's no progress, so it never loops forever." |
| 38–45 s | Show `validated` badge (or `verified` if one exists) | "`validated` = every static check passed. `verified` = tests and spec-derived eval cases also passed in an isolated Docker container. No network, read-only filesystem, no host environment." |
| 45–55 s | Click Export tab, show the three big buttons: View Code, Download ZIP, Add to Project | "One click exports a ZIP. The same package installs in Claude Code, Codex, or Cursor with a generated install command." |
| 55–65 s | Show the terminal: `claude skill install ./my-skill.zip` or the Codex E2E JSON in `docs/evidence/` | "I tested this end to end. The exported Skill ran the TODO finder on a real project outside this platform." |
| 65–75 s | Show the Skills page (Agents page) with several entries | "Every generated agent is versioned, stored, and re-runnable. The public `/v1` API lets external apps call any validated Skill." |
| 75–90 s | Switch to mobile (or show screenshot `final-mobile-ja-studio.png`) | "Bilingual interface — English and Japanese. Works on mobile. All 184 backend tests and 30 frontend tests pass on this branch right now." |

---

## If Ollama is too slow (fallback)

Replace live generation with:
1. Open a pre-generated `validated` Skill (already in the database).
2. Skip to the Validation tab at second 15.
3. Show the benchmark table in `docs/benchmarks/20261106-090709.md` as evidence the pipeline ran 42 real jobs.

Do not fake a `verified` result. If asked about the 0/42 verified rate, answer honestly:
> "With 7-billion-parameter local models, the code generation quality isn't high enough to pass all unit tests
> and eval cases simultaneously. The platform measures it correctly and reports it honestly. A 14B+ model or a
> cloud API would likely change the numbers — but I didn't want to claim success I haven't measured."

---

## Recovery from common failures

| Problem | Recovery |
|---|---|
| Ollama timeout | Show benchmark evidence screenshots instead of live generation |
| Docker not running | Explain sandbox needs Docker; show `validated` result (sandbox not required for `validated`) |
| Frontend 404 | `npm run dev` from `apps/web/`; check port 5173 |
| Generation stuck | The pipeline has a wall-clock timeout; it will fail cleanly and show the error stage |

---

## Usability test script (for 3 real participants, to run separately before the event)

**Task 1 (5 min):** Without any help, open the app and describe an agent that counts the number of functions in a Python file. Click the generate button. What do you see?
- Record: Did they find the input? Did they understand the pipeline stages?

**Task 2 (3 min):** An agent was generated but shows some red checks. Can you tell what failed?
- Record: Did they find the Validation tab? Did they understand the status badge?

**Task 3 (3 min):** Download the agent. Can you find the install command for Claude Code?
- Record: Did they find the Export tab? Did they find the copy button?

Note: These tests have NOT been run with real participants as of 2026-11-09. Run them before submission.
