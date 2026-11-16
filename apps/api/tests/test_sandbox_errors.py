"""Real Docker sandbox: every failure is classified (2026-11-14 fix) so reports, the repair loop and the UI can tell a
defect in the Skill's code from a broken sandbox. Skipped when Docker or the sandbox image is unavailable."""
import json

import pytest

from app.skills import sandbox
from app.skills.evaluation import failure_category, full_validation
from tests.fixtures import code_package
from tests.test_sandbox import _docker_ok

pytestmark = pytest.mark.skipif(not _docker_ok(), reason="docker or sandbox image unavailable")


def test_timeout_is_classified():
    r = sandbox.run_entrypoint({"scripts/main.py": "def run(d):\n    while True: pass\n"}, "scripts/main.py", {}, 2, 256)
    assert not r.ok and r.kind == "timeout" and "timeout" in r.error


def test_memory_limit_is_classified():
    code = "def run(d):\n    x = []\n    while True:\n        x.append(bytearray(10_000_000))\n"
    r = sandbox.run_entrypoint({"scripts/main.py": code}, "scripts/main.py", {}, 20, 64)
    assert not r.ok and r.kind == "memory" and "memory" in r.error


def test_sys_exit_in_run_is_reported_as_that_case_error_not_a_lost_run():
    """Before: SystemExit escaped `except Exception`, the runner died without a result and the whole run looked like
    an infrastructure fault ("no result (exit 3)")."""
    files = {"scripts/main.py": "import sys\ndef run(d):\n    if d.get('bad'):\n        sys.exit(3)\n    return {'ok': 1}\n"}
    r = sandbox.run_evals(files, "scripts/main.py", [{"name": "good", "input": {}}, {"name": "bad", "input": {"bad": 1}}], 10, 256)
    assert r.ok
    cases = {c["name"]: c for c in r.data["cases"]}
    assert cases["good"]["error"] is None and cases["good"]["outputs"] == [{"ok": 1}, {"ok": 1}]
    assert cases["bad"]["error"].startswith("SystemExit")
    single = sandbox.run_entrypoint(files, "scripts/main.py", {"bad": 1}, 10, 256)
    assert single.ok and single.data["ok"] is False and single.data["error"].startswith("SystemExit")


def test_sys_exit_at_import_is_a_load_error():
    r = sandbox.run_evals({"scripts/main.py": "import sys\nsys.exit(0)\n"}, "scripts/main.py", [{"name": "a", "input": {}}], 10, 256)
    assert r.ok and r.data["load_error"].startswith("SystemExit")


def test_test_errors_are_named_like_passes_and_failures():
    """Errors used str(test) ('test_x (test_main.T.test_x)'); passes/failures used test.id(). One format lets every result
    be tied to its definition (Skill Flow, reports)."""
    files = code_package()
    files["tests/test_main.py"] = (
        "import unittest\nfrom main import run\n\n\nclass T(unittest.TestCase):\n"
        "    def test_ok(self):\n        self.assertEqual(run({'files': {}})['count'], 0)\n"
        "    def test_fail(self):\n        self.assertEqual(run({'files': {}})['count'], 1)\n"
        "    def test_error(self):\n        raise KeyError('boom')\n")
    r = sandbox.run_tests(files, "tests", 10, 256)
    got = {t["name"]: t["status"] for t in r.data["tests"]}
    assert got == {"test_main.T.test_ok": "pass", "test_main.T.test_fail": "fail", "test_main.T.test_error": "error"}
    assert "KeyError: 'boom'" in next(t["detail"] for t in r.data["tests"] if t["status"] == "error")


def test_missing_sandbox_image_is_an_infrastructure_fault(monkeypatch):
    """docker run exits 125 for a missing image. That used to come back as the Skill's error ("no result (exit 125)") and
    the repair loop asked the model to fix code for it. Now: SandboxUnavailable, so the loop stops."""
    monkeypatch.setattr(sandbox.settings, "sandbox_image", "aab-no-such-image-for-tests:0")
    with pytest.raises(sandbox.SandboxUnavailable, match=r"docker run failed \(exit 125\)"):
        sandbox.run_entrypoint({"scripts/main.py": "def run(d):\n    return {}\n"}, "scripts/main.py", {}, 5, 128)


def test_full_validation_records_the_kind_and_never_verifies_a_timeout():
    files = code_package()
    files["scripts/main.py"] = "def run(data: dict) -> dict:\n    while True:\n        pass\n"
    status, report = full_validation(files)
    assert status == "validated"  # static checks pass; behaviour not proven
    assert report["sandbox"]["status"] == "error" and report["sandbox"]["kind"] == "timeout"
    assert failure_category(report) == "execution_limit"
    assert not any(c["passed"] for c in report["criteria"][1:])


def test_full_validation_when_docker_is_unavailable_is_validated_not_verified(monkeypatch):
    monkeypatch.setattr(sandbox.settings, "sandbox_image", "aab-no-such-image-for-tests:0")
    status, report = full_validation(code_package())
    assert status == "validated"
    assert report["sandbox"] == {**report["sandbox"], "status": "unavailable", "kind": "infrastructure"}
    assert failure_category(report) == "infra"
    assert json.dumps(report)  # serialisable for storage
