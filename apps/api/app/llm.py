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
    def __init__(self, base_url: str, model: str, timeout: float | None = None, seed: int | None = None):
        self.name = f"ollama:{model}"
        self._url, self._model = base_url.rstrip("/"), model
        self._timeout = timeout or settings.llm_timeout_s
        # Bounded options: without num_predict a looping model generates until the HTTP timeout.
        # A fixed seed makes repeated runs identical; pass a different seed for independent samples.
        self.usage: list[dict] = []  # Ollama's own timing/token counts per call, for honest performance reporting
        self.options = {"temperature": 0.2, "seed": settings.llm_seed if seed is None else seed,
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
        self.usage.append({k: data.get(k) for k in ("prompt_eval_count", "eval_count", "eval_duration", "total_duration", "load_duration")})
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
        self.schemas: list[dict] = []  # schemas passed to complete_json, for asserting structured-output contracts

    def _next(self, system: str, user: str):
        self.calls.append((system, user))
        if not self.responses:
            raise LLMError("fake provider exhausted")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def complete_json(self, system: str, user: str, schema: dict) -> dict:
        self.schemas.append(schema)
        return self._next(system, user)

    def complete(self, system: str, user: str) -> str:
        return self._next(system, user)


def usage_summary(calls: list[dict]) -> dict | None:
    """Totals measured by Ollama itself (durations are nanoseconds). None when nothing was recorded."""
    if not calls:
        return None
    total = lambda k: sum(c.get(k) or 0 for c in calls)  # noqa: E731
    out_tokens, eval_ns = total("eval_count"), total("eval_duration")
    return {"calls": len(calls), "prompt_tokens": total("prompt_eval_count"), "output_tokens": out_tokens,
            "model_seconds": round(total("total_duration") / 1e9, 2), "load_seconds": round(total("load_duration") / 1e9, 2),
            "tokens_per_second": round(out_tokens / (eval_ns / 1e9), 1) if eval_ns else None}


def running_models() -> list[dict]:
    """What Ollama has loaded right now and how much of it sits in GPU memory (GET /api/ps). [] when unavailable."""
    try:
        r = httpx.get(f"{settings.ollama_base_url.rstrip('/')}/api/ps", timeout=5)
        r.raise_for_status()
        out = []
        for m in r.json().get("models", []):
            size, vram = m.get("size") or 0, m.get("size_vram") or 0
            out.append({"name": m.get("name"), "size": size, "size_vram": vram, "gpu_percent": round(100 * vram / size) if size else None})
        return out
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return []


def get_provider() -> LLMProvider:
    return OllamaProvider(settings.ollama_base_url, settings.llm_model)


def installed_models() -> list[str]:
    """Models the local Ollama has pulled. The only names a request may choose from."""
    try:
        r = httpx.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags", timeout=5)
        r.raise_for_status()
        return sorted(m["name"] for m in r.json().get("models", []))
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
        raise LLMError(f"Ollama unreachable at {settings.ollama_base_url}: {e.__class__.__name__}") from e
