---
name: laravel-bug-analyzer
description: "Detects common Laravel bugs and security mistakes in PHP and Blade files: SQL built from variables, unguarded mass assignment, env() outside config, leftover dd()/dump(), POST forms without @csrf, create($request->all()). Use when reviewing a Laravel project."
---

# Laravel Bug Analyzer

Use when the user asks to review or debug a Laravel application.

1. From this Skill's directory run:

```bash
python scripts/cli.py --dir <path-to-laravel-project>
```

2. Output JSON: `findings` (file, line, rule, severity, message), `count`, `by_severity`.
3. Report `high` first (`sql-injection`, `missing-csrf`, `unvalidated-mass-assignment`), then `medium`, then `low`.
4. For each finding show the line and the Laravel-idiomatic fix (bindings `?`, `$fillable`, `config()`, `@csrf`,
   `$request->validated()`). Do not modify files unless asked.

Static pattern scan; it does not execute PHP and can miss SQL built across multiple lines.
