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
    def __init__(self, base_url: str, model: str, timeout: float | None = None):
        self.name = f"ollama:{model}"
        self._url, self._model = base_url.rstrip("/"), model
        self._timeout = timeout or settings.llm_timeout_s
        # Fixed options: without num_predict a looping model generates until the HTTP timeout.
        self.options = {"temperature": 0.2, "seed": settings.llm_seed,
                        "num_ctx": settings.llm_num_ctx, "num_predict": settings.llm_num_predict}

    def _chat(self, system: str, user: str, fmt: dict | None) -> str:
        body = {
            "model": self._model,
            "stream": False,
            "options": self.options,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        if fmt is not None:
            body["format"] = fmt  # Ollama structured outputs (JSON schema)
        try:
            r = httpx.post(f"{self._url}/api/chat", json=body, timeout=self._timeout)
        except httpx.TimeoutException as e:
            raise LLMError(f"Ollama timed out after {self._timeout:.0f}s ({self._model})") from e
        except httpx.HTTPError as e:
            raise LLMError(f"Ollama unreachable at {self._url}: {e.__class__.__name__}") from e
        if r.status_code != 200:
            raise LLMError(f"Ollama error {r.status_code}: {r.text[:200]}")
        try:
            data = r.json()
            content = data["message"]["content"]
        except (ValueError, KeyError, TypeError) as e:
            raise LLMError("unexpected Ollama response shape") from e
        if data.get("done_reason") == "length":
            raise LLMError(f"model output truncated at num_predict={settings.llm_num_predict} (done_reason=length)")
        return content

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
