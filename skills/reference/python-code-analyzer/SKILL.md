---
name: python-code-analyzer
description: "Statically analyzes Python source files for common defects (bare except, mutable default arguments, missing docstrings on public functions, overly long functions, unused imports). Use when reviewing Python code quality."
---

# Python Code Analyzer

Use this Skill when the user asks to review, audit or find bugs/smells in Python code.

1. Run the analyzer on the project (or a sub-folder) from this Skill's directory:

```bash
python scripts/cli.py --dir <path-to-project>
```

2. The output is JSON: `findings` (file, line, rule, message), `count`, and `parse_errors` for files that do not parse.
3. Report findings grouped by file, most severe first (`bare-except`, `mutable-default` before style rules).
4. For each finding, propose the concrete fix. Do not edit files unless the user asks.

Rules: `bare-except`, `mutable-default`, `missing-docstring` (public functions/classes), `long-function` (> 50 lines),
`unused-import`. The analysis is static (Python `ast`); it never runs the user's code.
