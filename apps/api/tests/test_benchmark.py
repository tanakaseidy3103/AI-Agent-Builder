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
