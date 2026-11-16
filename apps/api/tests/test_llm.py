import httpx
import pytest

from app.config import settings
from app.llm import LLMError, OllamaProvider


def _resp(**body):
    return lambda *a, **k: httpx.Response(200, json=body)


def test_unreachable_ollama_raises_honest_error(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(LLMError, match="unreachable"):
        OllamaProvider("http://x", "m").complete_json("s", "u", {})


def test_timeout_is_reported_as_timeout_not_unreachable(monkeypatch):
    def slow(*a, **k):
        raise httpx.ReadTimeout("slow")
    monkeypatch.setattr(httpx, "post", slow)
    with pytest.raises(LLMError, match="timed out"):
        OllamaProvider("http://x", "m", timeout=5).complete("s", "u")


def test_truncated_output_raises(monkeypatch):
    monkeypatch.setattr(httpx, "post", _resp(done_reason="length", message={"content": "def run("}))
    with pytest.raises(LLMError, match="truncated"):
        OllamaProvider("http://x", "m").complete("s", "u")


def test_malformed_response_raises_llmerror(monkeypatch):
    monkeypatch.setattr(httpx, "post", _resp(error="weird"))
    with pytest.raises(LLMError, match="unexpected"):
        OllamaProvider("http://x", "m").complete("s", "u")


def test_invalid_json_raises(monkeypatch):
    monkeypatch.setattr(httpx, "post", _resp(message={"content": "not json"}))
    with pytest.raises(LLMError, match="invalid JSON"):
        OllamaProvider("http://x", "m").complete_json("s", "u", {})


def test_model_and_bounded_options_are_sent(monkeypatch):
    seen = {}

    def fake(url, json, timeout):
        seen.update(json)
        return httpx.Response(200, json={"message": {"content": "{}"}})
    monkeypatch.setattr(httpx, "post", fake)
    OllamaProvider("http://x", "my-model").complete_json("s", "u", {"type": "object"})
    assert seen["model"] == "my-model" and seen["format"] == {"type": "object"}
    assert seen["options"]["num_predict"] == settings.llm_num_predict
    assert seen["options"]["num_ctx"] == settings.llm_num_ctx and seen["options"]["seed"] == settings.llm_seed


def test_usage_summary_uses_ollamas_own_measurements():
    from app.llm import usage_summary
    calls = [{"prompt_eval_count": 100, "eval_count": 50, "eval_duration": 2_000_000_000, "total_duration": 3_000_000_000, "load_duration": 500_000_000},
             {"prompt_eval_count": 40, "eval_count": 30, "eval_duration": 1_000_000_000, "total_duration": 1_500_000_000, "load_duration": 0}]
    assert usage_summary(calls) == {"calls": 2, "prompt_tokens": 140, "output_tokens": 80, "model_seconds": 4.5,
                                    "load_seconds": 0.5, "tokens_per_second": 26.7}
    assert usage_summary([]) is None


def test_running_models_reports_gpu_share(monkeypatch):
    import httpx
    from app import llm
    class R:
        def raise_for_status(self): pass
        def json(self): return {"models": [{"name": "qwen2.5-coder:latest", "size": 6_000, "size_vram": 4_500}]}
    monkeypatch.setattr(httpx, "get", lambda *a, **k: R())
    assert llm.running_models() == [{"name": "qwen2.5-coder:latest", "size": 6000, "size_vram": 4500, "gpu_percent": 75}]
    def down(*a, **k): raise httpx.ConnectError("x")
    monkeypatch.setattr(httpx, "get", down)
    assert llm.running_models() == []


# ---- remote model server behind an authenticating proxy (settings.ollama_api_key, 2026-11-14) ----

class _Resp:
    status_code = 200

    def __init__(self, body):
        self._body = body

    def json(self):
        return self._body

    @property
    def text(self):
        return str(self._body)

    def raise_for_status(self):
        return None


def test_api_key_is_sent_on_every_model_server_call_and_never_in_errors(monkeypatch):
    import httpx as _httpx
    from app import llm as _llm, readiness as _readiness
    monkeypatch.setattr(_llm.settings, "ollama_api_key", "k-secret-123")
    seen = []

    def post(url, json=None, timeout=None, headers=None):
        seen.append(("post", url, headers))
        return _Resp({"message": {"content": "hello"}, "done_reason": "stop"})

    def get(url, timeout=None, headers=None):
        seen.append(("get", url, headers))
        return _Resp({"models": [{"name": "m"}]})
    monkeypatch.setattr(_httpx, "post", post)
    monkeypatch.setattr(_httpx, "get", get)
    assert _llm.OllamaProvider("https://model.example", "m").complete("s", "u") == "hello"
    _llm.installed_models()
    assert _readiness.model_ok("https://model.example")
    assert seen and all(h == {"Authorization": "Bearer k-secret-123"} for _, _, h in seen)

    def refused(*a, **k):
        raise _httpx.ConnectError("refused")
    monkeypatch.setattr(_httpx, "post", refused)
    try:
        _llm.OllamaProvider("https://model.example", "m").complete("s", "u")
    except _llm.LLMError as e:
        assert "k-secret-123" not in str(e)
    else:
        raise AssertionError("expected LLMError")


def test_no_auth_header_for_a_local_model_server(monkeypatch):
    from app import llm as _llm
    monkeypatch.setattr(_llm.settings, "ollama_api_key", "")
    assert _llm.ollama_headers() == {}
