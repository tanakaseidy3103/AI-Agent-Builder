"""Install a stored Skill into the user's own project: read-only analysis -> exact plan -> apply only with approval.

Only creates new files under <project>/<tool skills dir>/<slug>/; never modifies or overwrites existing files and never
runs project commands. git is called with fixed arguments (no shell) to create an isolated branch when possible.
"""
import hashlib
import json
import re
import subprocess
from pathlib import Path

PROJECT_DIRS = {"claude-code": ".claude/skills", "codex": ".agents/skills", "cursor": ".cursor/skills"}
LANGUAGES = {"package.json": "JavaScript/TypeScript", "pyproject.toml": "Python", "requirements.txt": "Python",
             "composer.json": "PHP", "go.mod": "Go", "Cargo.toml": "Rust", "pom.xml": "Java", "build.gradle": "Java/Kotlin",
             "Gemfile": "Ruby", "pubspec.yaml": "Dart"}
FRAMEWORKS = {"react": "React", "next": "Next.js", "vue": "Vue", "express": "Express", "laravel/framework": "Laravel",
              "django": "Django", "fastapi": "FastAPI", "flask": "Flask"}


class ProjectError(ValueError):
    """Shown to the user as-is."""


def resolve_project(path: str) -> Path:
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise ProjectError("use the absolute path of the project folder")
    p = p.resolve()
    if not p.is_dir():
        raise ProjectError(f"folder not found: {p}")
    if p == p.parent or p == Path.home().resolve():
        raise ProjectError("choose a project folder, not a drive root or your home folder")
    return p


def _git(root: Path, *args: str) -> str | None:
    try:
        r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def analyze(root: Path) -> dict:
    """Read-only: marker files at the project root and git state. Reads a few small manifest files, nothing else."""
    names = {c.name for c in root.iterdir()}
    langs = sorted({lang for marker, lang in LANGUAGES.items() if marker in names})
    text = "\n"
    for f in ("package.json", "composer.json", "pyproject.toml", "requirements.txt"):
        if f in names and (root / f).stat().st_size < 200_000:
            text += (root / f).read_text(encoding="utf-8", errors="replace").lower() + "\n"
    # a dependency name as a JSON key, a quoted requirement ("django>=4") or a requirements.txt line
    frameworks = sorted({name for dep, name in FRAMEWORKS.items() if re.search(rf'["\n]{re.escape(dep)}["<>=~!\[ ;\n]', text)})
    inside = _git(root, "rev-parse", "--is-inside-work-tree") == "true"
    git = None
    if inside:
        status = _git(root, "status", "--porcelain")
        git = {"branch": _git(root, "rev-parse", "--abbrev-ref", "HEAD"), "head": _git(root, "rev-parse", "HEAD"),
               "dirty": bool(status) if status is not None else True}
    return {"root": str(root), "languages": langs, "frameworks": frameworks, "git": git}


def plan(root: Path, target: str, slug: str, version: str, files: dict[str, str]) -> dict:
    if target not in PROJECT_DIRS:
        raise ProjectError(f"{target!r} has no project-level Skills folder")
    dest = root / PROJECT_DIRS[target] / slug
    if not dest.resolve().is_relative_to(root):
        raise ProjectError(f"{PROJECT_DIRS[target]} points outside the project (symlink); refusing to write there")
    rel = dest.relative_to(root).as_posix()
    entries = [{"path": f"{rel}/{p}", "bytes": len(t.encode())} for p, t in sorted(files.items())]
    info = analyze(root)
    conflicts = [e["path"] for e in entries if (root / e["path"]).exists()]
    blockers = ([f"{rel} already exists; remove or rename it first (nothing is overwritten)"] if dest.exists() else []) + \
               (["the git working tree has uncommitted changes; commit or stash them first"] if info["git"] and info["git"]["dirty"] else [])
    branch = f"aab/{slug}-{version}" if info["git"] else None
    digest = hashlib.sha256(json.dumps([str(root), target, slug, version, info["git"] and info["git"]["head"],
                                        sorted((p, hashlib.sha256(t.encode()).hexdigest()) for p, t in files.items())]).encode())
    return {"analysis": info, "target": target, "dest": rel, "files": entries, "conflicts": conflicts, "blockers": blockers,
            "branch": branch, "token": digest.hexdigest()[:32]}


def apply(root: Path, target: str, slug: str, version: str, files: dict[str, str], token: str) -> dict:
    p = plan(root, target, slug, version, files)
    if token != p["token"]:
        raise ProjectError("the project or the Skill changed since the plan was shown; review the new plan")
    if p["blockers"]:
        raise ProjectError("; ".join(p["blockers"]))
    original = p["analysis"]["git"]["branch"] if p["branch"] else None
    if p["branch"] and _git(root, "switch", "-c", p["branch"]) is None:
        raise ProjectError(f"could not create branch {p['branch']} (does it already exist?)")
    created = []
    try:
        for rel_path, text in sorted(files.items()):
            target_file = root / p["dest"] / rel_path
            target_file.parent.mkdir(parents=True, exist_ok=True)
            with open(target_file, "x", encoding="utf-8", newline="") as fh:  # "x": fail instead of overwriting
                fh.write(text)
            created.append(f"{p['dest']}/{rel_path}")
    except OSError as e:
        for c in reversed(created):  # undo only what this call created, so a failed apply leaves the project as it was
            (root / c).unlink(missing_ok=True)
        if original:
            _git(root, "switch", original)
            _git(root, "branch", "-D", p["branch"])
        raise ProjectError(f"nothing was installed: {e}") from e
    bash = f'rm -r "{p["dest"]}"' + (f" && git switch {original} && git branch -D {p['branch']}" if original else "")
    ps = f'Remove-Item -Recurse "{p["dest"]}"' + (f"; git switch {original}; git branch -D {p['branch']}" if original else "")
    return {"created": created, "branch": p["branch"], "original_branch": original, "root": str(root),
            "rollback": {"bash": f'cd "{root}" && {bash}', "powershell": f'Set-Location "{root}"; {ps}'}}
