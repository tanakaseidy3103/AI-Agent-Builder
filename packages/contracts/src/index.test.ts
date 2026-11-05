import { describe, expect, it } from "vitest";
import schema from "../schemas/agent-event.schema.json";
import { AGENT_STATES } from "./index";

describe("contracts", () => {
  it("AGENT_STATES matches the JSON schema", () => {
    expect([...AGENT_STATES]).toEqual(schema.properties.state.enum);
  });
});
