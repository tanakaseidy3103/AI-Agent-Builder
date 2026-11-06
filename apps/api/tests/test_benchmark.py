"""Benchmark methodology: independent seeds and honest sample counting (scripts/benchmark_generation.py)."""
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import benchmark_generation as bench  # noqa: E402
from app.llm import OllamaProvider  # noqa: E402


def test_each_attempt_gets_a_distinct_seed_sent_to_ollama(monkeypatch):
    sent = []
    monkeypatch.setattr(httpx, "post", lambda url, json, timeout: (sent.append(json["options"]["seed"]),
                                                                    httpx.Response(200, json={"message": {"content": "x"}}))[1])
    for a in range(3):
        OllamaProvider("http://x", "m", seed=bench.attempt_seed(a)).complete("s", "u")
    assert len(set(sent)) == 3


def test_identical_outputs_count_as_one_independent_sample():
    rows = [{"model": "m", "task": "t", "code_sha": "aaa", "status": "validated"},
            {"model": "m", "task": "t", "code_sha": "aaa", "status": "validated"},  # same seed, same output
            {"model": "m", "task": "t", "code_sha": "bbb", "status": "verified"},
            {"model": "m", "task": "u", "code_sha": "aaa", "status": "validated"}]  # same code, different task
    assert len(bench.independent(rows)) == 3


def test_wilson_interval_matches_known_values():
    lo, hi = bench.wilson(0, 5)
    assert lo == 0.0 and round(hi, 3) == 0.434
    lo, hi = bench.wilson(5, 10)
    assert (round(lo, 3), round(hi, 3)) == (0.237, 0.763)


class _FakeKernel:
    def __init__(self):
        self.calls = []

    def SetThreadExecutionState(self, flags):  # noqa: N802 (Win32 name)
        self.calls.append(flags)
        return 1


def test_keep_awake_requests_and_always_restores(monkeypatch):
    import pytest
    from types import SimpleNamespace
    k = _FakeKernel()
    monkeypatch.setattr(bench.ctypes, "windll", SimpleNamespace(kernel32=k), raising=False)
    with pytest.raises(RuntimeError):
        with bench.keep_awake() as accepted:
            assert accepted is True
            raise RuntimeError("benchmark crashed")
    assert k.calls == [bench.ES_CONTINUOUS | bench.ES_SYSTEM_REQUIRED, bench.ES_CONTINUOUS]


def test_keep_awake_is_noop_without_windll(monkeypatch):
    monkeypatch.delattr(bench.ctypes, "windll", raising=False)
    with bench.keep_awake() as accepted:
        assert accepted is False


def test_suspend_watch_detects_gap_and_attributes_it_to_the_run():
    t = [1000.0]
    w = bench.SuspendWatch(tick=1.0, threshold=30.0, clock=lambda: t[0])
    for now in (1001.0, 1002.0, 40820.0, 40821.0):  # 11 h jump, like the 23:12 -> 10:10 sleep
        w.observe(now)
    assert len(w.gaps) == 1 and round(w.gaps[0][1]) == 39818
    assert w.suspended_between(1000.0, 40821.0) > 39000
    assert w.suspended_between(40820.5, 40900.0) == 0  # a later run is unaffected


def test_suspend_watch_ignores_normal_jitter():
    t = [0.0]
    w = bench.SuspendWatch(tick=1.0, threshold=30.0, clock=lambda: t[0])
    for now in (1.0, 2.5, 9.0, 12.0):  # slow ticks under load are not a suspend
        w.observe(now)
    assert w.gaps == []


def test_pending_skips_recorded_runs_in_attempt_major_order():
    done = [{"model": "ollama:m", "task": t, "attempt": 1} for _, t, _ in bench.TASKS]
    todo = list(bench.pending(["m"], 2, done))
    assert [(a, tid) for _, a, _, tid, _ in todo] == [(1, t) for _, t, _ in bench.TASKS]  # only attempt 2 left


def test_resume_refuses_a_different_code_commit(tmp_path, monkeypatch):
    import json
    import pytest
    monkeypatch.setattr(bench, "OUT", tmp_path)
    (tmp_path / "s.json").write_text(json.dumps({"meta": {"git_commit": "aaaaaaa1"}, "runs": []}), encoding="utf-8")
    with pytest.raises(SystemExit, match="refusing to resume"):
        bench.load_for_resume("s", "bbbbbbb2")
    stamp, m, rows = bench.load_for_resume("s", "aaaaaaa1")
    assert stamp == "s" and rows == [] and len(m["resumed_utc"]) == 1


def test_fit_input_adapts_to_the_models_schema():
    payload = {"a.py": "x"}
    assert bench.fit_input({"properties": {"files": {"type": "object"}}}, "files", payload) == {"files": payload}
    assert bench.fit_input({"properties": {"source": {"type": "object"}}}, "files", payload) == {"source": payload}
    assert bench.fit_input({"properties": {"text": {"type": "string"}}}, "files", payload) is None


def test_has_record_is_schema_agnostic_and_strict():
    out = {"report": {"issues": [{"path": "src/svc.py", "line": 6, "rule": "bare-except"}]}}
    assert bench.has_record(out, ["svc.py", 6])
    assert bench.has_record({"tests": [{"path": "/pets/{petId}", "expected_status": "404"}]}, ["/pets/{petId}", 404])
    assert not bench.has_record(out, ["svc.py", 7])                     # wrong line
    assert not bench.has_record({"a": "svc.py", "b": {"line": 6}}, ["svc.py", 6])  # not in the same record


def test_negative_tasks_are_marked():
    assert bench.NEGATIVE == {"neg-exfiltrate", "neg-delete-files"}
    assert all(t in bench.GOLDEN for d, t, _ in bench.TASKS if d != "negative")


def test_has_value_rejects_values_buried_in_longer_strings():
    good = {"scripts": {"lint:fix": "eslint --fix ."}, "test_folders": ["tests/"]}
    mangled = {"npm_scripts": ['lint:fix": "eslint --fix .", "test": "vitest'], "test_folders": ["tests/test_main.py"]}
    assert bench.has_value(good, "lint:fix") and bench.has_value(good, "tests")
    assert not bench.has_value(mangled, "lint:fix") and not bench.has_value(mangled, "tests")  # C1 false positive


def test_cases_prompt_forbids_free_text_expectations():
    from app.skills.pipeline import CASES_SYSTEM
    assert "NEVER put descriptive text in an expectation" in CASES_SYSTEM and CASES_SYSTEM.rstrip().endswith('...]}.')
