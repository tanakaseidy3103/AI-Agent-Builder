"""Bounded generation for the demo: a fixed pool of worker threads consuming a queue, and a wall-clock deadline per job.
The pipeline itself (app.skills.pipeline.run_generation) is reused unchanged."""
import queue
import threading
import time
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.llm import LLMError, LLMProvider
from app.skills.pipeline import run_generation


class DeadlineProvider:
    """Wraps a provider: once the job's wall-clock budget is spent, further model calls fail with a clear message, so
    the pipeline ends the job as `failed` (its normal error path) instead of holding the machine indefinitely."""

    def __init__(self, inner: LLMProvider, deadline: float, clock=time.monotonic):
        self._inner, self._deadline, self._clock = inner, deadline, clock
        self.name = inner.name
        self.usage = getattr(inner, "usage", [])

    def _check(self) -> None:
        if self._clock() >= self._deadline:
            raise LLMError("demo time limit reached for this generation")

    def complete_json(self, system: str, user: str, schema: dict) -> dict:
        self._check()
        return self._inner.complete_json(system, user, schema)

    def complete(self, system: str, user: str) -> str:
        self._check()
        return self._inner.complete(system, user)


class GenerationWorker:
    def __init__(self, session_factory: Callable[[], Session], provider_factory: Callable[[], LLMProvider],
                 concurrency: int, job_timeout_s: float):
        self._factory, self._provider_factory = session_factory, provider_factory
        self._timeout = job_timeout_s
        self._q: queue.Queue[str] = queue.Queue()
        self._running = 0
        self._lock = threading.Lock()
        self._threads = [threading.Thread(target=self._loop, name=f"demo-gen-{i}", daemon=True) for i in range(concurrency)]
        for t in self._threads:
            t.start()

    def submit(self, job_id: str) -> int:
        """Queue a job; returns how many jobs are ahead of it."""
        ahead = self.load()
        self._q.put(job_id)
        return ahead

    def load(self) -> int:
        """Jobs waiting plus jobs running."""
        with self._lock:
            return self._q.qsize() + self._running

    def _loop(self) -> None:
        while True:
            job_id = self._q.get()
            with self._lock:
                self._running += 1
            try:
                provider = DeadlineProvider(self._provider_factory(), time.monotonic() + self._timeout)
                run_generation(job_id, self._factory, provider)  # never raises: failures end the job as `failed`
            finally:
                with self._lock:
                    self._running -= 1
                self._q.task_done()

    def join(self) -> None:
        """Tests only: wait until every queued job has finished."""
        self._q.join()
