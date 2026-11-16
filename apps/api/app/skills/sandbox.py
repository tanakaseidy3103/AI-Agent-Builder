"""Isolated execution of untrusted Skill code in a throwaway Docker container.

No host mounts: the package is streamed into the container as a tar on stdin.
No network, read-only rootfs, unprivileged user, dropped capabilities, CPU/memory/PID limits,
wall-clock timeout, and an empty environment (host env vars are never forwarded).
"""
import io
import json
import re
import subprocess
import tarfile
import threading
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
        def addError(self, t, e): super().addError(t, e); results.append({"name": t.id(), "status": "error", "detail": self._exc_info_to_string(e, t)[-2000:]})
        def addSkip(self, t, r): super().addSkip(t, r); results.append({"name": t.id(), "status": "skip", "detail": r})
    unittest.TextTestRunner(stream=io.StringIO(), resultclass=R).run(suite)
    emit({"tests": results})

def load(entry):
    import importlib.util
    spec = importlib.util.spec_from_file_location("skill_entry", "/tmp/w/" + entry)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, "/tmp/w/" + entry.rsplit("/", 1)[0])
    spec.loader.exec_module(mod)
    return mod

if mode == "eval":
    import contextlib, copy, time
    entry = sys.argv[2]
    with open("/tmp/w/_cases.json", encoding="utf-8") as f:
        cases = json.load(f)
    try:
        mod = load(entry)
    except BaseException as e:  # incl. SystemExit from module-level code: report it, never die without a result
        emit({"load_error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]})
    out = []
    for case in cases:
        rec = {"name": case.get("name"), "outputs": [], "error": None, "stdout": "", "duration_ms": 0}
        buf = io.StringIO()
        t0 = time.perf_counter()
        try:
            with contextlib.redirect_stdout(buf):
                for _ in range(2):  # twice: determinism check happens on the host
                    rec["outputs"].append(json.loads(json.dumps(mod.run(copy.deepcopy(case["input"])))))
        except BaseException as e:  # SystemExit/KeyboardInterrupt from run() are that case's error, not a lost run
            rec["error"] = f"{type(e).__name__}: {e}"
            rec["trace"] = traceback.format_exc()[-1500:]
        rec["duration_ms"] = int((time.perf_counter() - t0) * 1000)
        rec["stdout"] = buf.getvalue()[-1000:]
        out.append(rec)
    emit({"cases": out})
else:
    entry = sys.argv[2]
    try:
        mod = load(entry)
        with open("/tmp/w/_input.json", encoding="utf-8") as f:
            data = json.load(f)
        out = mod.run(data)
        if not isinstance(out, dict):
            raise TypeError("run() must return a dict")
        emit({"ok": True, "output": out})
    except BaseException as e:
        emit({"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]})
'''

BOOTSTRAP = (
    "import sys,tarfile,runpy;"
    "tarfile.open(fileobj=sys.stdin.buffer,mode='r|').extractall('/tmp/w',filter='data');"
    "sys.argv=['r']+sys.argv[1:];runpy.run_path('/tmp/w/_runner.py',run_name='__main__')"
)


class SandboxUnavailable(RuntimeError):
    pass


# Why a run produced no result. Lets reports, the repair loop and the UI tell a defect in the Skill's code
# (timeout, memory) apart from a broken result channel. Infrastructure faults raise SandboxUnavailable instead.
ErrorKind = str  # "timeout" | "memory" | "no_result" | "malformed_result"


@dataclass
class SandboxResult:
    ok: bool
    data: dict = field(default_factory=dict)
    error: str | None = None
    kind: ErrorKind | None = None
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
        "--log-driver", "none",  # output is streamed to us; never also persist a flood into the Docker VM's log files
        "--network", "none",
        "--memory", f"{memory_mb}m", "--memory-swap", f"{memory_mb}m",
        "--cpus", "1", "--pids-limit", "64",
        "--read-only", "--tmpfs", "/tmp:rw,size=32m",
        "--user", "65534:65534", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "-e", "PYTHONDONTWRITEBYTECODE=1", "-e", "PYTHONHASHSEED=0",  # stable set/dict order across runs
        settings.sandbox_image, "timeout", str(timeout_s), "python", "-I", "-c", BOOTSTRAP, *args,
    ]


# Host-side caps on captured output. Untrusted code can print gigabytes within its time limit (measured: 1.78 GB of
# host memory for one 10 s run before this cap); only the tail matters because the result is the last stdout line.
MAX_STDOUT_BYTES = 8_000_000
MAX_STDERR_BYTES = 64_000


def _drain(stream, limit: int, sink: list) -> None:
    """Read a pipe to EOF keeping only its last `limit` bytes, so memory stays bounded whatever the child writes."""
    buf, total = bytearray(), 0
    for chunk in iter(lambda: stream.read(65536), b""):
        total += len(chunk)
        buf += chunk
        if len(buf) > limit:
            del buf[: len(buf) - limit]
    sink.append((bytes(buf), total))


def _feed(stream, data: bytes) -> None:
    try:
        stream.write(data)
    except (BrokenPipeError, OSError):
        pass  # the container exited before reading everything; its exit status tells the story
    finally:
        try:
            stream.close()
        except OSError:
            pass


def execute(files: dict[str, str], args: list[str], *, input_data: dict | None = None,
            timeout_s: int = 10, memory_mb: int = 256) -> SandboxResult:
    extra = {"_runner.py": RUNNER}
    if input_data is not None:
        extra["_input.json"] = json.dumps(input_data)
    name = f"aab-sbx-{uuid.uuid4().hex[:12]}"
    start = time.monotonic()
    try:
        proc = subprocess.Popen(docker_cmd(name, memory_mb, timeout_s, args), stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=None)
    except FileNotFoundError as e:
        raise SandboxUnavailable("docker CLI not found; run the API on a host with Docker") from e
    outs: list = []
    errs: list = []
    threads = [threading.Thread(target=_feed, args=(proc.stdin, _tar(files, extra)), daemon=True),
               threading.Thread(target=_drain, args=(proc.stdout, MAX_STDOUT_BYTES, outs), daemon=True),
               threading.Thread(target=_drain, args=(proc.stderr, MAX_STDERR_BYTES, errs), daemon=True)]
    for t in threads:
        t.start()
    try:
        proc.wait(timeout=timeout_s + 15)  # +15s container startup
    except subprocess.TimeoutExpired:
        subprocess.run(["docker", "kill", name], capture_output=True)
        proc.kill()
        proc.wait()
        for t in threads:
            t.join(5)
        return SandboxResult(False, error=f"timeout after {timeout_s}s", kind="timeout",
                             duration_ms=int((time.monotonic() - start) * 1000))
    for t in threads:
        t.join(5)
    duration = int((time.monotonic() - start) * 1000)
    raw_out, out_total = outs[0] if outs else (b"", 0)
    raw_err = errs[0][0] if errs else b""
    out = raw_out.decode("utf-8", "replace")
    err = raw_err.decode("utf-8", "replace")
    if "Cannot connect to the Docker daemon" in err or "dockerDesktopLinuxEngine" in err:
        raise SandboxUnavailable("Docker daemon is not running")
    if line_is_missing(out) and proc.returncode in DOCKER_RUN_FAILED and DOCKER_ERROR.search(err):
        # docker itself failed (missing image, daemon error, bad runtime): not the Skill's fault, and no rewrite of
        # its code can fix it. Reported as unavailable so the repair loop stops and the status is never `verified`.
        raise SandboxUnavailable(f"docker run failed (exit {proc.returncode}): {err.strip()[-300:]}")
    lines = out.rstrip("\n").splitlines()
    line = lines[-1] if lines and lines[-1].startswith(MARKER) else None  # only the final line counts
    if line is None:
        reason = {124: f"timeout after {timeout_s}s", 137: "killed (memory limit)"}.get(
            proc.returncode, f"no result (exit {proc.returncode})")
        kind = {124: "timeout", 137: "memory"}.get(proc.returncode, "no_result")
        if out_total > MAX_STDOUT_BYTES:
            reason += f"; output truncated ({out_total} bytes written, last {MAX_STDOUT_BYTES} kept)"
        return SandboxResult(False, error=reason, kind=kind,
                             duration_ms=duration, stdout_tail=out[-2000:], stderr_tail=err[-2000:])
    try:
        data = json.loads(line[len(MARKER):])
    except json.JSONDecodeError:
        return SandboxResult(False, error="malformed result line", kind="malformed_result", duration_ms=duration,
                             stdout_tail=out[-2000:], stderr_tail=err[-2000:])
    return SandboxResult(True, data, duration_ms=duration, stdout_tail=out[-2000:], stderr_tail=err[-2000:])


# `docker run` exits 125 when the daemon or image fails, 126/127 when the container command cannot run. The marker check
# plus docker's own error text keep a Skill that calls sys.exit(125) from being mistaken for an infrastructure fault.
DOCKER_RUN_FAILED = {125, 126, 127}
DOCKER_ERROR = re.compile(r"(^|\n)docker: |Error response from daemon|Unable to find image|pull access denied|"
                          r"OCI runtime (create|exec) failed|executable file not found")


def line_is_missing(out: str) -> bool:
    lines = out.rstrip("\n").splitlines()
    return not (lines and lines[-1].startswith(MARKER))


def _without_evals(files: dict[str, str]) -> dict[str, str]:
    """Eval expectations stay on the host. Inside the container, Skill code could read evals/cases.json and echo
    expect.contains back, holdout included; a probe Skill doing exactly that was marked `verified` before this."""
    return {p: t for p, t in files.items() if not p.startswith("evals/")}


def run_tests(files: dict[str, str], test_dir: str, timeout_s: int, memory_mb: int) -> SandboxResult:
    return execute(_without_evals(files), ["test", test_dir], timeout_s=timeout_s, memory_mb=memory_mb)


def run_evals(files: dict[str, str], entrypoint: str, cases: list[dict], timeout_s: int, memory_mb: int) -> SandboxResult:
    # only what run() needs: names to match results back and inputs. Expectations and the holdout flag never enter.
    inputs = [{"name": c.get("name"), "input": c.get("input")} for c in cases]
    extra_files = {**_without_evals(files), "_cases.json": json.dumps(inputs)}
    return execute(extra_files, ["eval", entrypoint], timeout_s=timeout_s, memory_mb=memory_mb)


def run_entrypoint(files: dict[str, str], entrypoint: str, data: dict, timeout_s: int, memory_mb: int) -> SandboxResult:
    return execute(files, ["run", entrypoint], input_data=data, timeout_s=timeout_s, memory_mb=memory_mb)
