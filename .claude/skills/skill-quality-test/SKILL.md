---
name: skill-quality-test
description: Real quality test of one AI Skill (generated, reference, or any SKILL.md directory) — runs its unit tests and eval cases in the Docker sandbox, plus five realistic scenarios (basic, multi-step, complex, ambiguous, invalid input), and scores it with evidence. Use before exporting, publishing or demoing a Skill.
---

# /skill-quality-test <skill-dir-or-slug>

**Purpose:** decide with evidence whether a Skill is useful and reliable — never because its output "looks good".

**When:** before export/demo, after regenerating a Skill, or when asked "is this Skill good?".

**Required tools:** Bash, Read, Write (report only). API running on 127.0.0.1:8000 for slugs.

## Steps
1. **Locate & read** SKILL.md, manifest.json, scripts/, tests/, evals/. If not found, stop: report "not found"
   with every location searched. Do not modify the Skill during the test.
2. **Objective gate:** run full validation
   `cd apps/api && .venv/Scripts/python.exe -c "from app.skills.evaluation import full_validation; ..."`
   or `POST /studio/versions/{id}/validate`. Record criteria, tests x/y, evals x/y, duration verbatim.
3. **Five scenarios** (realistic inputs matching input_schema, written before running):
   basic · multi-step · complex/precision · ambiguous (should it ask or state assumptions?) · invalid/incomplete input.
   Execute each through the real entrypoint in the sandbox (`sandbox.run_entrypoint`) or `/v1/skills/{slug}/run`.
   Save input + raw output.
4. **Judge each scenario** against a pre-written expected result: pass / partial / fail, with the reason.
5. **Baseline comparison** (when possible): same task without the Skill (plain prompt or manual check) — note
   time and correctness difference.
6. **Score 0–10** each: accuracy, instruction compliance, output quality, reliability, error handling, ease of use,
   reusability. Each score cites the scenario evidence that justifies it.
7. **Verdict:** APROVADA / APROVADA COM RESSALVAS / REPROVADA (or NOT EVALUATED if it could not run).

## Expected output
docs/skill-tests/<slug>-<date>.md with inputs, outputs, verdict, three top improvements.

## Verification criteria
Every scenario has a saved raw output; no score without a referenced scenario; validation numbers verbatim.

## Failure handling
Sandbox/API down → verdict NOT EVALUATED with the exact error. Never simulate a run.
