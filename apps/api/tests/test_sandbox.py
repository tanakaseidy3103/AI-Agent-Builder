"""Real Docker sandbox tests. Skipped when Docker is not available."""
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


def test_archive_traversal_blocked_inside_container():
    # tarfile filter='data' must refuse members escaping /tmp/w
    r = sandbox.execute({"../escape.py": "x"}, ["run", "scripts/main.py"], input_data={}, timeout_s=5)
    assert not r.ok
