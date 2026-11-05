"""Isolated execution of untrusted Skill code in a throwaway Docker container.

No host mounts: the package is streamed into the container as a tar on stdin.
No network, read-only rootfs, unprivileged user, dropped capabilities, CPU/memory/PID limits,
wall-clock timeout, and an empty environment (host env vars are never forwarded).
"""
import io
import json
import subprocess
import tarfile
import time
import uuid
from dataclasses import dataclass, field

from app.config import settings

MARKER = "__AAB_RESULT__"

# Runs inside the container. Executes tests or run(); prints one marked JSON line.
RUNNER = r'''
import io, json, os, sys, traceback, unittest
sys.path.insert(0, "/tmp/w")
mode = sys.argv[1]
_write, _exit = os.write, os._exit  # bind before untrusted code can monkeypatch os
def emit(obj):
    # Result must be the LAST stdout line: write it, then _exit to skip atexit hooks and kill threads,
    # so untrusted code cannot print a forged marker afterwards.
    try:
        sys.stdout.flush()
    except Exception:
        pass
    _write(1, ("\n__AAB_RESULT__" + json.dumps(obj, default=str) + "\n").encode())
    _exit(0)
if mode == "test":
    test_dir = sys.argv[2]
    sys.path.insert(0, "/tmp/w/scripts")
    suite = unittest.defaultTestLoader.discover("/tmp/w/" + test_dir, top_level_dir="/tmp/w/" + test_dir)
    results = []
    class R(unittest.TextTestResult):
        def addSuccess(self, t): super().addSuccess(t); results.append({"name": t.id(), "status": "pass", "detail": ""})
        def addFailure(self, t, e): super().addFailure(t, e); results.append({"name": t.id(), "status": "fail", "detail": self._exc_info_to_string(e, t)[-2000:]})
        def addError(self, t, e): super().addError(t, e); results.append({"name": str(t), "status": "error", "detail": self._exc_info_to_string(e, t)[-2000:]})
        def addSkip(self, t, r): super().addSkip(t, r); results.append({"name": t.id(), "status": "skip", "detail": r})
    unittest.TextTestRunner(stream=io.StringIO(), resultclass=R).run(suite)
    emit({"tests": results})
else:
    entry = sys.argv[2]
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("skill_entry", "/tmp/w/" + entry)
        mod = importlib.util.module_from_spec(spec)
        sys.path.insert(0, "/tmp/w/" + entry.rsplit("/", 1)[0])
        spec.loader.exec_module(mod)
        with open("/tmp/w/_input.json", encoding="utf-8") as f:
            data = json.load(f)
        out = mod.run(data)
        if not isinstance(out, dict):
            raise TypeError("run() must return a dict")
        emit({"ok": True, "output": out})
    except Exception as e:
        emit({"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]})
'''

BOOTSTRAP = (
    "import sys,tarfile,runpy;"
    "tarfile.open(fileobj=sys.stdin.buffer,mode='r|').extractall('/tmp/w',filter='data');"
    "sys.argv=['r']+sys.argv[1:];runpy.run_path('/tmp/w/_runner.py',run_name='__main__')"
)


class SandboxUnavailable(RuntimeError):
    pass


@dataclass
class SandboxResult:
    ok: bool
    data: dict = field(default_factory=dict)
    error: str | None = None
    duration_ms: int = 0
    stdout_tail: str = ""
    stderr_tail: str = ""


def _tar(files: dict[str, str], extra: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for path, text in {**files, **extra}.items():
            raw = text.encode("utf-8")
            info = tarfile.TarInfo(path)
            info.size, info.mode = len(raw), 0o444
            tar.addfile(info, io.BytesIO(raw))
    return buf.getvalue()


def docker_cmd(name: str, memory_mb: int, timeout_s: int, args: list[str]) -> list[str]:
    return [
        "docker", "run", "-i", "--rm", "--name", name,
        "--network", "none",
        "--memory", f"{memory_mb}m", "--memory-swap", f"{memory_mb}m",
        "--cpus", "1", "--pids-limit", "64",
        "--read-only", "--tmpfs", "/tmp:rw,size=32m",
        "--user", "65534:65534", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "-e", "PYTHONDONTWRITEBYTECODE=1",
        settings.sandbox_image, "timeout", str(timeout_s), "python", "-I", "-c", BOOTSTRAP, *args,
    ]


def execute(files: dict[str, str], args: list[str], *, input_data: dict | None = None,
            timeout_s: int = 10, memory_mb: int = 256) -> SandboxResult:
    extra = {"_runner.py": RUNNER}
    if input_data is not None:
        extra["_input.json"] = json.dumps(input_data)
    name = f"aab-sbx-{uuid.uuid4().hex[:12]}"
    start = time.monotonic()
    try:
        proc = subprocess.run(docker_cmd(name, memory_mb, timeout_s, args), input=_tar(files, extra),
                              capture_output=True, timeout=timeout_s + 15, env=None)  # +15s container startup
    except FileNotFoundError as e:
        raise SandboxUnavailable("docker CLI not found; run the API on a host with Docker") from e
    except subprocess.TimeoutExpired:
        subprocess.run(["docker", "kill", name], capture_output=True)
        return SandboxResult(False, error=f"timeout after {timeout_s}s", duration_ms=int((time.monotonic() - start) * 1000))
    duration = int((time.monotonic() - start) * 1000)
    out = proc.stdout.decode("utf-8", "replace")
    err = proc.stderr.decode("utf-8", "replace")
    if "Cannot connect to the Docker daemon" in err or "dockerDesktopLinuxEngine" in err:
        raise SandboxUnavailable("Docker daemon is not running")
    lines = out.rstrip("\n").splitlines()
    line = lines[-1] if lines and lines[-1].startswith(MARKER) else None  # only the final line counts
    if line is None:
        reason = {124: f"timeout after {timeout_s}s", 137: "killed (memory limit)"}.get(
            proc.returncode, f"no result (exit {proc.returncode})")
        return SandboxResult(False, error=reason,
                             duration_ms=duration, stdout_tail=out[-2000:], stderr_tail=err[-2000:])
    return SandboxResult(True, json.loads(line[len(MARKER):]), duration_ms=duration,
                         stdout_tail=out[-2000:], stderr_tail=err[-2000:])


def run_tests(files: dict[str, str], test_dir: str, timeout_s: int, memory_mb: int) -> SandboxResult:
    return execute(files, ["test", test_dir], timeout_s=timeout_s, memory_mb=memory_mb)


def run_entrypoint(files: dict[str, str], entrypoint: str, data: dict, timeout_s: int, memory_mb: int) -> SandboxResult:
    return execute(files, ["run", entrypoint], input_data=data, timeout_s=timeout_s, memory_mb=memory_mb)
