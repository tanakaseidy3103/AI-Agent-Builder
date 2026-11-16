"""Real API for browser E2E tests with a MOCKED LLM. No Ollama, no network model calls.

    .venv/Scripts/python.exe scripts/e2e_mock_server.py            # serves http://127.0.0.1:8000

Everything except the model is real: FastAPI routes, the 10-stage pipeline, static validation, the Docker sandbox
(unit tests + eval cases), packaging, export and project install. The model is replaced by ScriptedProvider, which
answers each pipeline question (spec / eval cases / code / tests / repair) with a fixed, hand-written reply chosen by
the question's system prompt, so the result does not depend on call order. Its name, "fake:scripted (MOCKED LLM)",
is what the UI and the stored report show as the model.

Data is isolated: a fresh SQLite DB and storage dir under <repo>/test-results/e2e-mock/ (deleted on start).
The Studio's Postgres data and the user's ~/.claude, ~/.agents are never touched.
"""
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# A fresh folder per start: deleting the previous one in place failed on Windows when a sync client (OneDrive) held a
# handle on it (2026-11-14), which stopped the harness. Older runs are removed best-effort.
RUNS = ROOT / "test-results" / "e2e-mock"
RUNS.mkdir(parents=True, exist_ok=True)
for old in RUNS.iterdir():
    shutil.rmtree(old, ignore_errors=True)
DATA = RUNS / f"run-{os.getpid()}"
DATA.mkdir()
# must be set before `app` is imported: the engine and settings are created at import time
os.environ["DATABASE_URL"] = f"sqlite:///{(DATA / 'db.sqlite').as_posix()}"
os.environ["STORAGE_DIR"] = str(DATA / "storage")
os.environ["LLM_MODEL"] = "fake:scripted"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402

from app import llm, models  # noqa: E402,F401
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.skills import pipeline  # noqa: E402

NAME = "fake:scripted (MOCKED LLM)"

SPEC = {
    "name": "Python Bug Finder",
    "description": "Analyzes Python source files, identifies potential bugs and suggests improvements. "
                   "Use when reviewing Python code for common defects.",
    "kind": "code",
    "instructions": "1. Collect the Python files of the project as {path: source}.\n"
                    "2. Run the analyzer and read `findings` (file, line, rule, message, suggestion).\n"
                    "3. Report findings grouped by file, most severe first, with the suggested fix.",
    "tools": ["Read", "Bash"],
    "permissions": ["compute", "read-input-files"],
    "external_services": [],
    "input_schema": {"type": "object", "properties": {"files": {"type": "object", "additionalProperties": {"type": "string"}}},
                     "required": ["files"]},
    "output_schema": {"type": "object", "properties": {
        "findings": {"type": "array", "items": {"type": "object", "properties": {
            "file": {"type": "string"}, "line": {"type": "integer"}, "rule": {"type": "string"},
            "message": {"type": "string"}, "suggestion": {"type": "string"}},
            "required": ["file", "line", "rule", "message", "suggestion"]}},
        "count": {"type": "integer"},
        "parse_errors": {"type": "array", "items": {"type": "string"}}},
        "required": ["findings", "count", "parse_errors"]},
}

CODE = '''import ast

RULES = {
    "bare-except": ("bare `except:` also catches KeyboardInterrupt and SystemExit",
                    "catch the specific exception, e.g. `except ValueError:`"),
    "mutable-default": ("mutable default argument is shared between calls",
                        "use `None` as the default and create the list/dict inside the function"),
    "none-comparison": ("comparison to None with == or !=",
                        "use `is None` / `is not None`"),
    "unreachable-code": ("statement after return/raise never runs",
                         "remove it or move it before the return"),
}


def _finding(path, node, rule):
    message, suggestion = RULES[rule]
    return {"file": path, "line": getattr(node, "lineno", 1), "rule": rule, "message": message, "suggestion": suggestion}


def _check(path, tree):
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            out.append(_finding(path, node, "bare-except"))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for default in node.args.defaults + [d for d in node.args.kw_defaults if d is not None]:
                if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                    out.append(_finding(path, default, "mutable-default"))
        elif isinstance(node, ast.Compare):
            for op, right in zip(node.ops, node.comparators):
                if isinstance(op, (ast.Eq, ast.NotEq)) and isinstance(right, ast.Constant) and right.value is None:
                    out.append(_finding(path, node, "none-comparison"))
        if isinstance(getattr(node, "body", None), list):
            body = node.body
            for i, stmt in enumerate(body[:-1]):
                if isinstance(stmt, (ast.Return, ast.Raise)):
                    out.append(_finding(path, body[i + 1], "unreachable-code"))
                    break
    return out


def run(data: dict) -> dict:
    findings, parse_errors = [], []
    for path, source in sorted(data.get("files", {}).items()):
        if not path.endswith(".py"):
            continue
        try:
            tree = ast.parse(source, filename=path)
        except SyntaxError as e:
            parse_errors.append(f"{path}: line {e.lineno}: {e.msg}")
            continue
        findings.extend(_check(path, tree))
    findings.sort(key=lambda f: (f["file"], f["line"], f["rule"]))
    return {"findings": findings, "count": len(findings), "parse_errors": parse_errors}
'''

TESTS = '''import unittest

from main import run


class TestPythonBugFinder(unittest.TestCase):
    def test_bare_except_is_reported_with_line_and_suggestion(self):
        out = run({"files": {"a.py": "try:\\n    x = 1\\nexcept:\\n    pass\\n"}})
        self.assertEqual(out["count"], 1)
        self.assertEqual(out["findings"][0]["rule"], "bare-except")
        self.assertEqual(out["findings"][0]["line"], 3)
        self.assertTrue(out["findings"][0]["suggestion"])

    def test_mutable_default_and_none_comparison(self):
        src = "def f(items=[]):\\n    if items == None:\\n        return 0\\n    return len(items)\\n"
        rules = sorted(f["rule"] for f in run({"files": {"b.py": src}})["findings"])
        self.assertEqual(rules, ["mutable-default", "none-comparison"])

    def test_clean_file_has_no_findings(self):
        out = run({"files": {"ok.py": "def f(x=None):\\n    return x is None\\n"}})
        self.assertEqual(out, {"findings": [], "count": 0, "parse_errors": []})

    def test_syntax_error_is_reported_not_raised(self):
        out = run({"files": {"bad.py": "def (:\\n"}})
        self.assertEqual(out["count"], 0)
        self.assertEqual(len(out["parse_errors"]), 1)

    def test_non_python_files_are_ignored(self):
        self.assertEqual(run({"files": {"README.md": "except:"}})["count"], 0)
'''

CASES = {"cases": [
    {"name": "bare-except", "input": {"files": {"app.py": "try:\n    run()\nexcept:\n    pass\n"}},
     "expect": {"contains": {"count": 1, "findings": [{"file": "app.py", "line": 3, "rule": "bare-except"}]}}},
    {"name": "clean", "input": {"files": {"ok.py": "def add(a, b):\n    return a + b\n"}},
     "expect": {"contains": {"count": 0, "parse_errors": []}}},
    {"name": "unreachable-after-return", "input": {"files": {"m.py": "def f():\n    return 1\n    print('never')\n"}},
     "expect": {"contains": {"count": 1, "findings": [{"file": "m.py", "line": 3, "rule": "unreachable-code"}]}}},
]}


def fenced(code: str) -> str:
    return f"```python\n{code}```\n"


class ScriptedProvider:
    """Deterministic stand-in for the model. Answers by the pipeline step asking, never by call order."""

    name = NAME

    def __init__(self):
        self.usage: list[dict] = []

    def complete_json(self, system: str, user: str, schema: dict) -> dict:
        if system == pipeline.SPEC_SYSTEM:
            return dict(SPEC)
        if system == pipeline.CASES_SYSTEM:
            return CASES
        raise llm.LLMError(f"{NAME}: no scripted JSON reply for this question")

    def complete(self, system: str, user: str) -> str:
        if system == pipeline.CODE_SYSTEM:
            return fenced(CODE)
        if system == pipeline.TESTS_SYSTEM:
            return fenced(TESTS)
        if system == pipeline.FIX_SYSTEM:
            return fenced(CODE) + fenced(TESTS)
        # instruction-only Skills run through /v1 use SKILL.md as the system prompt
        return f"[{NAME}] instruction-only reply for: {user[:200]}"


def main() -> None:
    Base.metadata.create_all(engine)
    app.dependency_overrides[llm.get_provider] = ScriptedProvider
    # the model picker lists what the "local runtime" has: only the scripted model, so nothing reaches Ollama
    llm.installed_models = lambda: ["fake:scripted"]
    llm.running_models = lambda: []
    print(f"MOCKED LLM API: provider={NAME} db={os.environ['DATABASE_URL']} storage={os.environ['STORAGE_DIR']}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), log_level="warning")


if __name__ == "__main__":
    main()
