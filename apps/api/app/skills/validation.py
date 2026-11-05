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
FORBIDDEN_OS_ATTRS = {"_exit", "write", "dup2", "system", "popen", "fork", "kill", "execv", "execve", "execl", "spawnl", "spawnv", "remove", "unlink", "rmdir", "removedirs", "environ", "getenv", "putenv"}
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
        methods = [m for p in test_files if p in trees for m in _test_methods(trees[p])]
        empty = [name for name, n_asserts in methods if n_asserts == 0]
        if not test_files:
            add("code.tests", "fail", "code Skills need tests/test_*.py to be verifiable")
        elif len(methods) < MIN_TESTS or empty:
            add("code.tests", "fail", f"{len(methods)} test method(s); need ≥{MIN_TESTS}, each with an assertion"
                + (f"; without assertions: {empty}" if empty else ""))
        else:
            add("code.tests", "pass", f"{len(methods)} test methods with assertions")
        _check_evals(files, manifest, add)
    elif py_files:
        add("instructions.no_code", "warn", f"instruction-only Skill contains Python files: {py_files}")

    return checks, manifest


MIN_TESTS = 3
MIN_EVAL_CASES = 2
EVALS_PATH = "evals/cases.json"


def _test_methods(tree: ast.AST) -> list[tuple[str, int]]:
    out = []
    for cls in (n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)):
        for fn in (n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name.startswith("test")):
            n = sum(1 for x in ast.walk(fn) if isinstance(x, ast.Assert) or (
                isinstance(x, ast.Call) and isinstance(x.func, ast.Attribute) and x.func.attr.startswith(("assert", "fail"))))
            out.append((fn.name, n))
    return out


def load_cases(files: dict[str, str]) -> list[dict]:
    data = json.loads(files[EVALS_PATH])
    if not isinstance(data, list):
        raise ValueError("evals/cases.json must be a JSON list")
    return data


def _check_evals(files: dict[str, str], manifest: Manifest, add) -> None:
    from app.skills.jsonschema_lite import validate as schema_validate
    if EVALS_PATH not in files:
        add("code.evals", "fail", f"code Skills need {EVALS_PATH} with ≥{MIN_EVAL_CASES} cases")
        return
    try:
        cases = load_cases(files)
    except (json.JSONDecodeError, ValueError) as e:
        add("code.evals", "fail", f"invalid {EVALS_PATH}: {e}")
        return
    problems = []
    for i, c in enumerate(cases):
        if not isinstance(c, dict) or not isinstance(c.get("name"), str) or not isinstance(c.get("input"), dict):
            problems.append(f"case {i}: needs name (string) and input (object)")
            continue
        problems += [f"{c['name']}: {e}" for e in schema_validate(manifest.input_schema, c["input"])]
        exp = c.get("expect")
        if exp is None and manifest.origin == "generated":
            # without an expectation a case only proves "runs", not "correct" (AI-1)
            problems.append(f"{c['name']}: generated cases need expect.contains derived from the spec")
        if exp is not None and not (isinstance(exp, dict) and set(exp) <= {"equals", "contains"} and exp):
            problems.append(f"{c['name']}: expect must be {{equals|contains: ...}}")
        elif isinstance(exp, dict):
            # an expectation shaped unlike output_schema can never be met by correct code
            props = set(manifest.output_schema.get("properties", {}))
            for mode in ("equals", "contains"):
                got = exp.get(mode)
                stray = sorted(set(got) - props) if props and isinstance(got, dict) else []
                if stray:
                    problems.append(f"{c['name']}: expect.{mode} keys {stray} are not in output_schema properties {sorted(props)}")
    if len(cases) < MIN_EVAL_CASES:
        problems.append(f"{len(cases)} case(s); need ≥{MIN_EVAL_CASES}")
    add("code.evals", "fail" if problems else "pass", "; ".join(problems)[:500] or f"{len(cases)} eval cases")


# How to fix each check family. Shown in the report next to failures.
HINTS = {
    "structure.paths": "Use relative paths inside scripts/, tests/, evals/, docs/ or examples/ with allowed extensions.",
    "structure.required": "Every package needs SKILL.md and manifest.json.",
    "manifest.schema": "Fix manifest.json fields (slug id, semver version, kind instructions|code).",
    "skill_md.frontmatter": "SKILL.md must start with ---/name/description--- and name must equal manifest id.",
    "manifest.io_schemas": "input_schema and output_schema must be {type: object, properties: {...}} with required ⊆ properties.",
    "manifest.permissions": "Remove network/filesystem-write; the sandbox never grants them.",
    "manifest.dependencies": "Rewrite with the Python standard library; external packages cannot be installed offline.",
    "manifest.compatibility": "Use only claude-code, codex, cursor.",
    "python.syntax": "The file does not parse. Regenerate or fix the reported line.",
    "python.policy": "Remove forbidden modules/calls (subprocess, socket, eval, os.system, writes) or non-stdlib imports.",
    "code.entrypoint": "scripts/main.py must define a top-level def run(data: dict) -> dict.",
    "code.tests": f"Add tests/test_main.py with ≥{MIN_TESTS} unittest methods, each asserting something.",
    "code.evals": f"Add {EVALS_PATH}: ≥{MIN_EVAL_CASES} cases with name, input matching input_schema, optional expect.",
}


def hint_for(check_id: str) -> str | None:
    return HINTS.get(check_id.split(":")[0])


def summarize(checks: list[Check]) -> dict:
    return {
        "passed": sum(c.status == "pass" for c in checks),
        "failed": sum(c.status == "fail" for c in checks),
        "warnings": sum(c.status == "warn" for c in checks),
        "checks": [{**asdict(c), "hint": hint_for(c.id) if c.status == "fail" else None} for c in checks],
    }
