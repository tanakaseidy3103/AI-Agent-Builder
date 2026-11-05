"""Objective evaluation: real sandbox runs on reference Skills and on deliberately broken variants."""
import json
import shutil
import subprocess

import pytest

from app.skills import sandbox
from app.skills.evaluation import full_validation, judge_case
from app.skills.jsonschema_lite import contains, validate
from app.skills.reference import REFERENCE_DIR, load_reference

REFS = sorted(p.name for p in REFERENCE_DIR.iterdir() if p.is_dir())


def _docker_ok() -> bool:
    return bool(shutil.which("docker")) and subprocess.run(
        ["docker", "image", "inspect", sandbox.settings.sandbox_image], capture_output=True).returncode == 0


docker = pytest.mark.skipif(not _docker_ok(), reason="docker or sandbox image unavailable")


# --- pure logic -------------------------------------------------------------

def test_schema_validator():
    schema = {"type": "object", "required": ["a"], "properties": {"a": {"type": "integer"}, "b": {"type": "array", "items": {"type": "string"}}}}
    assert validate(schema, {"a": 1, "b": ["x"]}) == []
    assert validate(schema, {"a": True}) == ["$.a: expected integer, got bool"]
    assert validate(schema, {"b": [1]}) == ["$: missing required 'a'", "$.b[0]: expected string, got int"]
    assert validate({"type": "object", "additionalProperties": False}, {"x": 1}) == ["$: unexpected property 'x'"]


def test_contains_subset_semantics():
    assert contains({"a": [{"x": 1}]}, {"a": [{"x": 1, "y": 2}, {"x": 3}], "b": 0})
    assert not contains({"a": [{"x": 9}]}, {"a": [{"x": 1}]})
    assert not contains({"a": 1}, {"a": "1"})


def test_judge_flags_nondeterminism_schema_and_expectation():
    schema = {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"]}
    ok = judge_case({"name": "c", "input": {}, "expect": {"equals": {"n": 1}}}, {"outputs": [{"n": 1}, {"n": 1}]}, schema)
    assert ok["status"] == "pass"
    nd = judge_case({"name": "c", "input": {}}, {"outputs": [{"n": 1}, {"n": 2}]}, schema)
    assert "non-deterministic" in nd["reasons"][0]
    bad = judge_case({"name": "c", "input": {}}, {"outputs": [{"n": "x"}, {"n": "x"}]}, schema)
    assert bad["status"] == "fail" and "output schema" in bad["reasons"][0]
    exc = judge_case({"name": "c", "input": {}}, {"error": "KeyError: 'files'", "outputs": []}, schema)
    assert exc["reasons"] == ["raised KeyError: 'files'"]


def test_trivial_tests_are_rejected_statically():
    files = load_reference(REFERENCE_DIR / "python-code-analyzer")
    files["tests/test_main.py"] = "import unittest\nclass T(unittest.TestCase):\n    def test_a(self): pass\n    def test_b(self): pass\n    def test_c(self): pass\n"
    status, report = full_validation(files)
    assert status == "validation_failed"
    msg = next(c for c in report["static"]["checks"] if c["id"] == "code.tests")
    assert "without assertions" in msg["message"] and msg["hint"]


def test_missing_eval_cases_rejected():
    files = load_reference(REFERENCE_DIR / "python-code-analyzer")
    files["evals/cases.json"] = json.dumps([{"name": "only-one", "input": {"files": {}}}])
    assert full_validation(files)[0] == "validation_failed"
    files["evals/cases.json"] = json.dumps([{"name": "a", "input": {}}, {"name": "b", "input": {}}])  # violates input_schema
    status, report = full_validation(files)
    assert status == "validation_failed"
    assert "missing required 'files'" in next(c for c in report["static"]["checks"] if c["id"] == "code.evals")["message"]


# --- real sandbox -------------------------------------------------------------

@docker
@pytest.mark.parametrize("name", REFS)
def test_reference_skill_is_verified_in_sandbox(name):
    status, report = full_validation(load_reference(REFERENCE_DIR / name), "human (reference)")
    assert status == "verified", json.dumps(report["criteria"])
    assert report["summary"]["tests_total"] >= 3 and report["summary"]["evals_total"] >= 2


@docker
def test_wrong_expectation_is_caught():
    files = load_reference(REFERENCE_DIR / "laravel-bug-analyzer")
    cases = json.loads(files["evals/cases.json"])
    cases[0]["expect"]["contains"]["count"] = 99
    files["evals/cases.json"] = json.dumps(cases)
    status, report = full_validation(files)
    assert status == "validated"
    failed = [e for e in report["evals"] if e["status"] == "fail"]
    assert len(failed) == 1 and failed[0]["reasons"] == ["output does not contain expect.contains"]
    assert failed[0]["actual"]["count"] == 6  # the real output is recorded


@docker
def test_regressed_code_is_caught_by_tests_and_evals():
    files = load_reference(REFERENCE_DIR / "react-accessibility-analyzer")
    files["scripts/main.py"] = files["scripts/main.py"].replace('return "img-alt"', 'return None and "img-alt"')
    status, report = full_validation(files)
    assert status == "validated"
    assert any(t["status"] != "pass" for t in report["tests"])
    assert any(e["status"] == "fail" for e in report["evals"])


@docker
def test_nondeterministic_code_is_caught():
    files = load_reference(REFERENCE_DIR / "python-code-analyzer")
    files["scripts/main.py"] = files["scripts/main.py"].replace(
        'return {"findings": findings, "count": len(findings), "parse_errors": parse_errors}',
        'import random\n    return {"findings": findings, "count": len(findings) + random.randint(0, 10**9), "parse_errors": parse_errors}')
    status, report = full_validation(files)
    assert status != "verified"
    assert any("non-deterministic" in r for e in report["evals"] for r in e["reasons"])


@docker
def test_do_nothing_skill_is_not_verified():
    """AI-1: code that returns nothing, with assertion-bearing but vacuous tests, must not reach verified."""
    from tests.fixtures import code_package
    files = code_package()
    files["scripts/main.py"] = "def run(data: dict) -> dict:\n    return {'findings': [], 'count': 0}\n"
    files["tests/test_main.py"] = ("import unittest\nfrom main import run\nclass T(unittest.TestCase):\n"
                                  "    def test_a(self): self.assertIsInstance(run({'files': {}}), dict)\n"
                                  "    def test_b(self): self.assertIn('count', run({'files': {}}))\n"
                                  "    def test_c(self): self.assertEqual(run({'files': {'a': 'x'}})['count'], 0)\n")
    status, report = full_validation(files)
    assert status == "validated"
    assert report["summary"]["tests_passed"] == 3  # its own tests pass...
    assert any(e["status"] == "fail" for e in report["evals"])  # ...but the spec-derived expectation catches it
