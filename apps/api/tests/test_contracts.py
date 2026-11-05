import json
from pathlib import Path

from app.contracts import AgentEvent, AgentState

SCHEMA = Path(__file__).parents[3] / "packages/contracts/schemas/agent-event.schema.json"


def test_agent_state_matches_shared_schema():
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    assert schema["properties"]["state"]["enum"] == [s.value for s in AgentState]
    assert set(schema["required"]) == {
        n for n, f in AgentEvent.model_fields.items() if f.is_required()
    }
