---
name: project-documentation-generator
description: "Generates a factual README draft from a project's files: languages, detected frameworks, run/test scripts, top-level structure and test locations. Use when a repository lacks documentation or onboarding notes."
---

# Project Documentation Generator

Use when the user wants a README, onboarding guide or project overview.

1. From this Skill's directory run:

```bash
python scripts/cli.py --dir <path-to-project>
```

2. The JSON output contains `markdown` (a README draft) plus the facts it was built from
   (`languages`, `frameworks`, `scripts`, `test_locations`).
3. Show the draft to the user. Everything in it is derived from files; add a short human-written "What it does"
   paragraph yourself only after reading the code, and mark anything you inferred.
4. Write README.md only if the user confirms, and never overwrite an existing README without asking.
