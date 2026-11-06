"""Shared sample packages and fake LLM responses.

Fake LLM call order for a code Skill (see pipeline._pipeline):
  1 complete_json  spec          2 complete  code (fenced)
  3 complete_json  eval cases    4 complete  tests (fenced)
  5+ complete      repair (two fenced blocks)
"""
import json

from app.skills.package import Manifest, manifest_json, render_skill_md

CODE_SCRIPT = '''import re


def run(data: dict) -> dict:
    findings = []
    for path, src in sorted(data.get("files", {}).items()):
        if re.search(r"onClick=\\{\\(\\) =>", src):
            findings.append({"file": path, "issue": "inline arrow handler re-created every render"})
    return {"findings": findings, "count": len(findings)}
'''

CODE_TEST = '''import unittest
from main import run


class TestAnalyzer(unittest.TestCase):
    def test_detects_inline_handler(self):
        out = run({"files": {"App.tsx": "<b onClick={() => go()} />"}})
        self.assertEqual(out["count"], 1)

    def test_clean_file(self):
        self.assertEqual(run({"files": {"A.tsx": "const a = 1"}})["count"], 0)

    def test_output_shape(self):
        self.assertIn("findings", run({"files": {}}))
'''

CASES = [
    {"name": "inline", "input": {"files": {"App.tsx": "<b onClick={() => go()} />"}}, "expect": {"contains": {"count": 1}}},
    {"name": "clean", "input": {"files": {"A.tsx": "const a = 1"}}, "expect": {"equals": {"findings": [], "count": 0}}},
]


def fenced(code: str) -> str:
    return f"Here is the module:\n```python\n{code}```\n"


SPEC_CODE = {
    "name": "React Performance Analyzer",
    "description": "Analyzes React source files and flags common performance problems.",
    "kind": "code",
    "instructions": "Use this skill to scan React components for unnecessary re-renders.",
    "tools": ["Read", "Grep"],
    "permissions": ["compute", "read-input-files"],
    "input_schema": {"type": "object", "properties": {"files": {"type": "object"}}, "required": ["files"]},
    "output_schema": {"type": "object", "properties": {"findings": {"type": "array"}, "count": {"type": "integer"}},
                      "required": ["findings", "count"]},
}

# The four model replies of a successful code generation, in order.
CODE_RESPONSES = [SPEC_CODE, {"cases": CASES}, fenced(CODE_SCRIPT), fenced(CODE_TEST)]

SPEC_INSTR = {
    "name": "Commit Message Writer",
    "description": "Writes conventional commit messages from a diff summary.",
    "kind": "instructions",
    "instructions": "Read the diff. Write `type(scope): summary` under 72 chars.",
    "tools": [],
    "permissions": ["llm"],
    "input_schema": {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]},
    "output_schema": {"type": "object", "properties": {"text": {"type": "string"}}},
}


def code_package() -> dict[str, str]:
    m = Manifest(id="react-perf", name="React Perf", description="Finds React perf issues", kind="code",
                 execution={"entrypoint": "scripts/main.py"}, tests={"path": "tests"},
                 input_schema=SPEC_CODE["input_schema"], output_schema=SPEC_CODE["output_schema"])
    return {
        "SKILL.md": render_skill_md(m, "Scan components."),
        "manifest.json": manifest_json(m),
        "scripts/main.py": CODE_SCRIPT,
        "tests/test_main.py": CODE_TEST,
        "evals/cases.json": json.dumps(CASES),
    }
