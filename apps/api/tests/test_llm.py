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
