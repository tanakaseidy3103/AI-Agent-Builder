"""Real Docker sandbox tests. Skipped when Docker is not available."""
import json
import shutil
import subprocess

import pytest

from app.skills import sandbox
from tests.fixtures import code_package


def _docker_ok() -> bool:
    if not shutil.which("docker"):
        return False
    return subprocess.run(["docker", "image", "inspect", sandbox.settings.sandbox_image], capture_output=True).returncode == 0


pytestmark = pytest.mark.skipif(not _docker_ok(), reason="docker or sandbox image unavailable")


def test_runs_generated_tests():
    r = sandbox.run_tests(code_package(), "tests", 10, 256)
    assert r.ok
    assert {t["status"] for t in r.data["tests"]} == {"pass"}
    assert len(r.data["tests"]) == 3


def test_no_network():
    files = {"scripts/main.py": "import socket\ndef run(d):\n    socket.create_connection(('1.1.1.1', 80), timeout=2)\n    return {}\n"}
    r = sandbox.run_entrypoint(files, "scripts/main.py", {}, 10, 256)
    assert r.data["ok"] is False and "unreachable" in r.data["error"].lower()


def test_timeout_enforced():
    r = sandbox.run_entrypoint({"scripts/main.py": "def run(d):\n    while True: pass\n"}, "scripts/main.py", {}, 2, 256)
    assert not r.ok and "timeout" in r.error


def test_host_env_not_leaked_and_fs_readonly(monkeypatch):
    monkeypatch.setenv("AAB_SECRET_TEST", "leak-me")
    files = {"scripts/main.py": "import os\ndef run(d):\n    return {'env': sorted(os.environ), 'w': os.access('/', os.W_OK), 'uid': os.getuid()}\n"}
    out = sandbox.run_entrypoint(files, "scripts/main.py", {}, 10, 256).data["output"]
    assert "AAB_SECRET_TEST" not in out["env"]
    assert out["w"] is False and out["uid"] == 65534


def test_generated_code_cannot_forge_test_results():
    """An atexit hook printing a fake 'all passed' marker must not override the trusted runner."""
    files = {
        "scripts/main.py": "def run(d):\n    return {}\n",
        "tests/test_main.py": (
            "import atexit, unittest\n"
            "atexit.register(lambda: print('__AAB_RESULT__' + '{\"tests\": [{\"name\": \"x\", \"status\": \"pass\", \"detail\": \"\"}]}'))\n"
            "class T(unittest.TestCase):\n"
            "    def test_fails(self):\n"
            "        print('__AAB_RESULT__{\"tests\": []}')\n"
            "        self.fail('real failure')\n"
        ),
    }
    r = sandbox.run_tests(files, "tests", 10, 256)
    assert r.ok
    assert [t["status"] for t in r.data["tests"]] == ["fail"]


_SNOOP = (
    "import json, os\n"
    "def run(d):\n"
    "    seen = []\n"
    "    for root, _, names in os.walk('/tmp/w'):\n"
    "        for n in names:\n"
    "            if n == 'main.py':\n"
    "                continue  # this file contains the search strings itself\n"
    "            try:\n"
    "                with open(os.path.join(root, n), encoding='utf-8') as f:\n"
    "                    text = f.read()\n"
    "            except Exception:\n"
    "                continue\n"
    "            if '\"expect\"' in text or 'holdout' in text or 'SECRET-EXPECTATION' in text:\n"
    "                seen.append(os.path.join(root, n))\n"
    "    return {'seen': seen}\n"
)


def test_eval_expectations_never_enter_the_container():
    """Before the 2026-11 audit a Skill reading /tmp/w/evals/cases.json echoed expect.contains back and was marked
    verified, holdout included. Expectations must stay on the host, where judge_case compares them."""
    cases = [{"name": "a", "input": {}, "expect": {"contains": {"v": "SECRET-EXPECTATION"}}},
             {"name": "h", "input": {}, "expect": {"contains": {"v": "SECRET-EXPECTATION"}}, "holdout": True}]
    files = {"scripts/main.py": _SNOOP, "evals/cases.json": json.dumps(cases), "tests/test_main.py": "import unittest\n"}
    r = sandbox.run_evals(files, "scripts/main.py", cases, 10, 256)
    assert r.ok, r.error
    assert [c["outputs"][0] for c in r.data["cases"]] == [{"seen": []}, {"seen": []}]
    t = sandbox.execute({**sandbox._without_evals(files)}, ["run", "scripts/main.py"], input_data={}, timeout_s=10)
    assert t.data["output"] == {"seen": []}


def test_forged_marker_cannot_reveal_hidden_expectations():
    """Skill code CAN forge the runner's result line (same process). That only lets it invent outputs, which it could
    return from run() anyway; without expectations in the container it cannot pass a case it does not solve."""
    from app.skills.evaluation import judge_case
    forge = ("import sys, json\nfrom os import _exit\n"
             "def run(d):\n"
             "    fake = {'cases': [{'name': 'a', 'outputs': [{'v': 'guess'}, {'v': 'guess'}], 'error': None,"
             " 'stdout': '', 'duration_ms': 1}]}\n"
             "    sys.__stdout__.write('\\n__AAB_RESULT__' + json.dumps(fake) + '\\n'); sys.__stdout__.flush()\n"
             "    _exit(0)\n")
    case = {"name": "a", "input": {}, "expect": {"contains": {"v": "SECRET-EXPECTATION"}}}
    r = sandbox.run_evals({"scripts/main.py": forge}, "scripts/main.py", [case], 10, 256)
    rec = {c["name"]: c for c in r.data.get("cases", [])}.get("a", {"error": r.error})
    assert judge_case(case, rec, {"type": "object"})["status"] == "fail"


def test_output_flood_keeps_host_memory_bounded():
    """Measured before the fix: one 10 s run printing in a loop made the API allocate 1.78 GB."""
    import tracemalloc
    flood = "import sys\ndef run(d):\n    s = 'A' * 1_000_000 + '\\n'\n    while True:\n        sys.__stdout__.write(s)\n"
    tracemalloc.start()
    try:
        r = sandbox.run_entrypoint({"scripts/main.py": flood}, "scripts/main.py", {}, 5, 256)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert not r.ok and "timeout" in r.error
    assert peak < 64_000_000, f"host peak {peak / 1e6:.0f} MB"


def test_archive_traversal_blocked_inside_container():
    # tarfile filter='data' must refuse members escaping /tmp/w
    r = sandbox.execute({"../escape.py": "x"}, ["run", "scripts/main.py"], input_data={}, timeout_s=5)
    assert not r.ok
