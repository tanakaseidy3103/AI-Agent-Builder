"""LLM provider abstraction. Ollama first; hosted providers implement the same protocol."""
import json
from typing import Protocol

import httpx

from app.config import settings


class LLMError(RuntimeError):
    """Model unavailable or returned unusable output. Message is safe to show the user."""


class LLMProvider(Protocol):
    name: str

    def complete_json(self, system: str, user: str, schema: dict) -> dict: ...

    def complete(self, system: str, user: str) -> str: ...


class OllamaProvider:
    def __init__(self, base_url: str, model: str, timeout: float = 180):
        self.name = f"ollama:{model}"
        self._url, self._model, self._timeout = base_url.rstrip("/"), model, timeout

    def _chat(self, system: str, user: str, fmt: dict | None) -> str:
        body = {
            "model": self._model,
            "stream": False,
            "options": {"temperature": 0.2},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        if fmt is not None:
            body["format"] = fmt  # Ollama structured outputs (JSON schema)
        try:
            r = httpx.post(f"{self._url}/api/chat", json=body, timeout=self._timeout)
        except httpx.HTTPError as e:
            raise LLMError(f"Ollama unreachable at {self._url}: {e.__class__.__name__}") from e
        if r.status_code != 200:
            raise LLMError(f"Ollama error {r.status_code}: {r.text[:200]}")
        return r.json()["message"]["content"]

    def complete_json(self, system: str, user: str, schema: dict) -> dict:
        text = self._chat(system, user, schema)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise LLMError("model returned invalid JSON") from e
        if not isinstance(data, dict):
            raise LLMError("model returned non-object JSON")
        return data

    def complete(self, system: str, user: str) -> str:
        return self._chat(system, user, None)


class FakeProvider:
    """Deterministic provider for tests: returns queued responses in order."""

    name = "fake"

    def __init__(self, responses: list):
        self.responses = list(responses)
        self.calls: list[tuple[str, str]] = []

    def _next(self, system: str, user: str):
        self.calls.append((system, user))
        if not self.responses:
            raise LLMError("fake provider exhausted")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def complete_json(self, system: str, user: str, schema: dict) -> dict:
        return self._next(system, user)

    def complete(self, system: str, user: str) -> str:
        return self._next(system, user)


def get_provider() -> LLMProvider:
    return OllamaProvider(settings.ollama_base_url, settings.llm_model)
