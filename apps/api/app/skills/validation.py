"""Static validation of an untrusted Skill package. Deterministic; never executes code."""
import ast
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import PurePosixPath
from typing import Literal

from pydantic import ValidationError

from app.skills.package import (
    KNOWN_PERMISSIONS,
    Manifest,
    check_limits,
    parse_frontmatter,
    safe_relpath,
)

KNOWN_TARGETS = {"claude-code", "codex", "cursor"}
# Not granted by the sandbox; declaring them makes the Skill unverifiable in the MVP.
UNGRANTED_PERMISSIONS = {"network", "filesystem-write"}
FORBIDDEN_MODULES = {
    "subprocess", "socket", "ctypes", "multiprocessing", "urllib", "http", "ftplib",
    "smtplib", "ssl", "requests", "pty", "signal", "resource", "importlib", "webbrowser",
}
FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "breakpoint", "input"}
FORBIDDEN_OS_ATTRS = {"system", "popen", "fork", "kill", "execv", "execve", "execl", "spawnl", "spawnv", "remove", "unlink", "rmdir", "removedirs", "environ", "getenv", "putenv"}
PIP_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*([<>=!~]=?[A-Za-z0-9.*]+)?$")


@dataclass
class Check:
    id: str
    status: Literal["pass", "fail", "warn"]
    message: str


def _imports(tree: ast.AST) -> set[str]:
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            out.add(node.module.split(".")[0])
    return out


def _forbidden_usage(tree: ast.AST) -> list[str]:
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_CALLS:
            found.append(f"{node.func.id}()")
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "os" and node.attr in FORBIDDEN_OS_ATTRS:
            found.append(f"os.{node.attr}")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "open":
            mode = node.args[1] if len(node.args) > 1 else next((k.value for k in node.keywords if k.arg == "mode"), None)
            if isinstance(mode, ast.Constant) and isinstance(mode.value, str) and set(mode.value) & set("wax+"):
                found.append("open() for writing")
    return found


def _schema_ok(schema: object) -> bool:
    if not isinstance(schema, dict) or schema.get("type") != "object":
        return False
    props = schema.get("properties", {})
    req = schema.get("required", [])
    return isinstance(props, dict) and isinstance(req, list) and all(r in props for r in req)


def validate_package(files: dict[str, str]) -> tuple[list[Check], Manifest | None]:
    checks: list[Check] = []
    add = lambda i, s, m: checks.append(Check(i, s, m))  # noqa: E731

    # structure
    bad = []
    for p in files:
        try:
            safe_relpath(p)
        except ValueError as e:
            bad.append(str(e))
    try:
        check_limits(files)
    except ValueError as e:
        bad.append(str(e))
    add("structure.paths", "fail" if bad else "pass", "; ".join(bad) or f"{len(files)} files, all paths safe")
    missing = [f for f in ("SKILL.md", "manifest.json") if f not in files]
    add("structure.required", "fail" if missing else "pass", f"missing: {missing}" if missing else "SKILL.md and manifest.json present")
    if missing:
        return checks, None

    # manifest
    try:
        manifest = Manifest.model_validate(json.loads(files["manifest.json"]))
        add("manifest.schema", "pass", f"{manifest.id}@{manifest.version} ({manifest.kind})")
    except (json.JSONDecodeError, ValidationError) as e:
        add("manifest.schema", "fail", str(e)[:500])
        return checks, None

    fm = parse_frontmatter(files["SKILL.md"])
    if not fm.get("name") or not fm.get("description"):
        add("skill_md.frontmatter", "fail", "SKILL.md needs frontmatter with name and description")
    elif fm["name"] != manifest.id:
        add("skill_md.frontmatter", "fail", f"frontmatter name {fm['name']!r} != manifest id {manifest.id!r}")
    else:
        add("skill_md.frontmatter", "pass", "name and description present")

    ok_schemas = _schema_ok(manifest.input_schema) and _schema_ok(manifest.output_schema)
    add("manifest.io_schemas", "pass" if ok_schemas else "fail",
        "input/output schemas are objects" if ok_schemas else "schemas must be {type: object} with required ⊆ properties")

    unknown = set(manifest.permissions) - KNOWN_PERMISSIONS
    ungranted = set(manifest.permissions) & UNGRANTED_PERMISSIONS
    if unknown:
        add("manifest.permissions", "fail", f"unknown permissions: {sorted(unknown)}")
    elif ungranted:
        add("manifest.permissions", "fail", f"not grantable in sandbox: {sorted(ungranted)}")
    else:
        add("manifest.permissions", "pass", f"{manifest.permissions}")

    if manifest.dependencies:
        invalid = [d for d in manifest.dependencies if not PIP_NAME_RE.match(d)]
        msg = f"invalid specifiers: {invalid}" if invalid else "external dependencies are not installable in the offline sandbox (MVP supports stdlib only)"
        add("manifest.dependencies", "fail", f"{manifest.dependencies}: {msg}")
    else:
        add("manifest.dependencies", "pass", "no external dependencies")

    bad_targets = set(manifest.compatibility) - KNOWN_TARGETS
    add("manifest.compatibility", "fail" if bad_targets else "pass",
        f"unknown targets: {sorted(bad_targets)}" if bad_targets else f"{manifest.compatibility}")

    # python sources
    py_files = sorted(p for p in files if p.endswith(".py"))
    local_modules = {PurePosixPath(p).stem for p in py_files} | {"scripts", "tests"}
    stdlib = set(sys.stdlib_module_names)
    trees = {}
    for p in py_files:
        try:
            trees[p] = ast.parse(files[p], filename=p)
            add(f"python.syntax:{p}", "pass", "parses")
        except SyntaxError as e:
            add(f"python.syntax:{p}", "fail", f"line {e.lineno}: {e.msg}")
    for p, tree in trees.items():
        imports = _imports(tree)
        forbidden = sorted(imports & FORBIDDEN_MODULES)
        external = sorted(imports - stdlib - local_modules)
        usage = sorted(set(_forbidden_usage(tree)))
        problems = ([f"forbidden modules {forbidden}"] if forbidden else []) + \
                   ([f"undeclared non-stdlib imports {external}"] if external else []) + \
                   ([f"forbidden calls {usage}"] if usage else [])
        add(f"python.policy:{p}", "fail" if problems else "pass", "; ".join(problems) or "stdlib only, no forbidden calls")

    # kind-specific
    if manifest.kind == "code":
        ex = manifest.execution
        if ex is None or ex.entrypoint not in files:
            add("code.entrypoint", "fail", f"entrypoint {ex.entrypoint if ex else '(none)'} not in package")
        else:
            tree = trees.get(ex.entrypoint)
            has_run = tree is not None and any(isinstance(n, ast.FunctionDef) and n.name == "run" for n in tree.body)
            add("code.entrypoint", "pass" if has_run else "fail",
                f"{ex.entrypoint} defines run(data)" if has_run else f"{ex.entrypoint} must define top-level run(data: dict) -> dict")
        test_dir = manifest.tests.path if manifest.tests else "tests"
        test_files = [p for p in py_files if p.startswith(f"{test_dir}/") and PurePosixPath(p).name.startswith("test")]
        add("code.tests", "pass" if test_files else "fail",
            f"{len(test_files)} test file(s)" if test_files else "code Skills need tests/test_*.py to be verifiable")
    elif py_files:
        add("instructions.no_code", "warn", f"instruction-only Skill contains Python files: {py_files}")

    return checks, manifest


def summarize(checks: list[Check]) -> dict:
    return {
        "passed": sum(c.status == "pass" for c in checks),
        "failed": sum(c.status == "fail" for c in checks),
        "warnings": sum(c.status == "warn" for c in checks),
        "checks": [asdict(c) for c in checks],
    }
