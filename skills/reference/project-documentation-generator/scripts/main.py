"""Factual README generator. Entry point: run(data) -> dict."""
import json
import re

LANG = {".py": "Python", ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
        ".php": "PHP", ".go": "Go", ".rs": "Rust", ".java": "Java", ".rb": "Ruby", ".cs": "C#", ".css": "CSS", ".html": "HTML"}
JS_FRAMEWORKS = {"next": "Next.js", "react": "React", "vue": "Vue", "express": "Express", "@nestjs/core": "NestJS",
                 "vite": "Vite", "vitest": "Vitest", "jest": "Jest", "tailwindcss": "Tailwind CSS"}
PY_FRAMEWORKS = {"fastapi": "FastAPI", "django": "Django", "flask": "Flask", "pytest": "pytest", "sqlalchemy": "SQLAlchemy"}


def _ext(path):
    m = re.search(r"(\.[A-Za-z0-9]+)$", path)
    return m.group(1).lower() if m else ""


def _facts(files):
    langs, frameworks, scripts, tests = {}, [], {}, set()
    for path in sorted(files):
        lang = LANG.get(_ext(path))
        if lang:
            langs[lang] = langs.get(lang, 0) + 1
        parts = path.split("/")
        name = parts[-1]
        if any(p in ("tests", "test", "__tests__", "spec") for p in parts[:-1]) or re.match(r"(test_.*\.py|.*\.(test|spec)\.[jt]sx?)$", name):
            tests.add("/".join(parts[:-1]) or ".")
    pkg = files.get("package.json")
    if pkg:
        try:
            p = json.loads(pkg)
            deps = {**p.get("dependencies", {}), **p.get("devDependencies", {})}
            frameworks += [v for k, v in JS_FRAMEWORKS.items() if k in deps]
            scripts.update({f"npm run {k}": v for k, v in sorted(p.get("scripts", {}).items())})
        except (ValueError, AttributeError):
            pass
    py_manifest = (files.get("requirements.txt", "") + "\n" + files.get("pyproject.toml", "")).lower()
    frameworks += [v for k, v in PY_FRAMEWORKS.items() if re.search(r"(^|[\s\"'])" + re.escape(k) + r"\b", py_manifest)]
    composer = files.get("composer.json")
    if composer and "laravel/framework" in composer:
        frameworks.append("Laravel")
    if "Dockerfile" in files or "docker-compose.yml" in files or "compose.yaml" in files:
        frameworks.append("Docker")
    return dict(sorted(langs.items(), key=lambda kv: (-kv[1], kv[0]))), frameworks, scripts, sorted(tests)


def run(data: dict) -> dict:
    files = data.get("files", {})
    name = data.get("project_name") or "Project"
    langs, frameworks, scripts, tests = _facts(files)
    top = sorted({p.split("/")[0] + ("/" if "/" in p else "") for p in files})
    md = [f"# {name}", "", "> Draft generated from the repository files. Review before publishing.", ""]
    md += ["## Tech stack", ""]
    md += [f"- {lang} ({n} file{'s' if n != 1 else ''})" for lang, n in langs.items()] or ["- (no source files detected)"]
    md += [f"- {fw}" for fw in frameworks]
    md += ["", "## Getting started", ""]
    if scripts:
        md += ["| Command | Runs |", "|---|---|"] + [f"| `{k}` | `{v}` |" for k, v in scripts.items()]
    else:
        md.append("No scripts detected. Document how to install and run the project here.")
    md += ["", "## Project structure", "", "```"] + top + ["```", "", "## Tests", ""]
    md += [f"- `{t}`" for t in tests] or ["No tests detected."]
    return {"markdown": "\n".join(md) + "\n", "languages": langs, "frameworks": frameworks, "scripts": scripts, "test_locations": tests}
