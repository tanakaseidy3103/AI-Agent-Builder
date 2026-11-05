import httpx
import pytest

from app.llm import LLMError, OllamaProvider


def test_unreachable_ollama_raises_honest_error(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(LLMError, match="unreachable"):
        OllamaProvider("http://x", "m").complete_json("s", "u", {})


def test_invalid_json_raises(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(200, json={"message": {"content": "not json"}}))
    with pytest.raises(LLMError, match="invalid JSON"):
        OllamaProvider("http://x", "m").complete_json("s", "u", {})


def test_model_comes_from_constructor(monkeypatch):
    seen = {}
    def fake(url, json, timeout):
        seen.update(json)
        return httpx.Response(200, json={"message": {"content": "{}"}})
    monkeypatch.setattr(httpx, "post", fake)
    OllamaProvider("http://x", "my-model").complete_json("s", "u", {"type": "object"})
    assert seen["model"] == "my-model" and seen["format"] == {"type": "object"}
