"""Mirror of packages/contracts/schemas/agent-event.schema.json (sync enforced by tests)."""
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class AgentState(StrEnum):
    idle = "idle"
    planning = "planning"
    working = "working"
    testing = "testing"
    waiting_for_approval = "waiting_for_approval"
    completed = "completed"
    failed = "failed"


class AgentEvent(BaseModel):
    """Emitted by the backend runtime only when a real state change happens."""

    agent_id: str
    run_id: str | None = None
    state: AgentState
    message: str | None = None
    at: datetime
