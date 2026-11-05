// Mirror of schemas/agent-event.schema.json (sync enforced by index.test.ts).
export const AGENT_STATES = [
  "idle",
  "planning",
  "working",
  "testing",
  "waiting_for_approval",
  "completed",
  "failed",
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export interface AgentEvent {
  agent_id: string;
  run_id?: string | null;
  state: AgentState;
  message?: string | null;
  at: string; // ISO 8601
}
