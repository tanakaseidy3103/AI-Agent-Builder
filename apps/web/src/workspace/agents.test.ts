import { expect, it } from "vitest";
import type { AgentEvent, AgentId, Job, Stage } from "../api";
import { agentViews, parseEvent, turns } from "./agents";

// Messages exactly as apps/api/app/skills/pipeline.py (Tracker) persists them.
const LOG: [AgentId, string, string][] = [
  ["architect", "planning", "analyze: started"], ["architect", "idle", "analyze: passed — kind=code"],
  ["architect", "planning", "specify: started"], ["architect", "idle", "specify: passed — x@0.1.0"],
  ["architect", "planning", "plan: started"], ["architect", "idle", "plan: passed — SKILL.md, scripts/main.py"],
  ["coder", "working", "generate_files: started"], ["coder", "idle", "generate_files: passed — 8 files; 3 eval cases"],
  ["tester", "working", "test_generation: started"], ["tester", "idle", "test_generation: passed — tests/test_main.py"],
  ["reviewer", "testing", "static_validation: started (round 1/4)"], ["reviewer", "failed", "static_validation: failed — round 1/4: 19 passed, 1 failed"],
  ["tester", "failed", "sandbox_tests: skipped — static validation failed"], ["tester", "testing", "evaluate: started"], ["tester", "idle", "evaluate: skipped — sandbox did not run"],
  ["coder", "working", "generate_files: started (repair 1)"], ["coder", "idle", "generate_files: passed — repair 1: updated"],
  ["reviewer", "testing", "static_validation: started (round 2/4)"], ["reviewer", "idle", "static_validation: passed — round 2/4: 20 passed, 0 failed"],
  ["tester", "testing", "sandbox_tests: started (round 2/4)"],
];
const ev = (n = LOG.length): AgentEvent[] => LOG.slice(0, n).map(([agent_id, state, message], i) =>
  ({ id: i + 1, agent_id, run_id: "j", state, message, at: `2026-11-06T08:00:${String(i).padStart(2, "0")}Z` }));
const job = (st: Record<string, Stage["status"]>, status: Job["status"] = "generating"): Job => ({
  id: "j", prompt: "p", requested_kind: null, status, stage: null, error: null, provider: "ollama:test", skill_version_id: null,
  stages: ["analyze", "specify", "plan", "generate_files", "static_validation", "test_generation", "sandbox_tests", "evaluate", "report", "package"]
    .map((name) => ({ name, status: st[name] ?? "pending" })),
});

it("parses started/finished/repair/error/completed messages", () => {
  const p = parseEvent(ev()[15]);
  expect([p.stage, p.kind, p.label, p.repair]).toEqual(["generate_files", "started", "repair 1", 1]);
  expect(parseEvent(ev()[11])).toMatchObject({ stage: "static_validation", kind: "failed", detail: "round 1/4: 19 passed, 1 failed" });
  expect(parseEvent({ ...ev()[0], agent_id: "architect", state: "failed", message: "generation failed at analyze: Ollama unreachable" }))
    .toMatchObject({ stage: "analyze", kind: "error", detail: "Ollama unreachable" });
  expect(parseEvent({ ...ev()[0], agent_id: "packager", state: "completed", message: "x@0.1.0 is verified" }).kind).toBe("completed");
});

it("only the agent with a running stage is working; others are done, failed or waiting", () => {
  const passed = { analyze: "passed", specify: "passed", plan: "passed", generate_files: "passed", test_generation: "passed", static_validation: "passed" } as const;
  const v = Object.fromEntries(agentViews(job({ ...passed, sandbox_tests: "running" }), ev()).map((a) => [a.id, a]));
  expect(v.architect.state).toBe("done");
  expect(v.coder.state).toBe("done");
  expect(v.coder.repairs).toBe(1);
  expect(v.reviewer.state).toBe("waiting");           // passed this round, report still pending
  expect(v.tester.state).toBe("working");
  expect(v.tester.current?.name).toBe("sandbox_tests");
  expect(v.tester.startedAt).toBe("2026-11-06T08:00:19Z");
  expect(v.packager.state).toBe("waiting");
  expect(agentViews(job({ ...passed, sandbox_tests: "running" }), ev()).filter((a) => a.state === "working")).toHaveLength(1);
});

it("a failed review shows the reviewer failed while nobody pretends to work", () => {
  const st = { analyze: "passed", specify: "passed", plan: "passed", generate_files: "passed", test_generation: "passed", static_validation: "failed" } as const;
  const v = Object.fromEntries(agentViews(job(st), ev(12)).map((a) => [a.id, a]));
  expect(v.reviewer.state).toBe("failed");
  expect(Object.values(v).some((a) => a.state === "working")).toBe(false);
});

it("without a job every agent is waiting", () => {
  expect(agentViews(undefined, []).map((a) => a.state)).toEqual(["waiting", "waiting", "waiting", "waiting", "waiting"]);
});

it("turns follow real handoffs, and a repair turn carries the failure that caused it", () => {
  const t = turns(ev());
  expect(t.map((x) => `${x.role}:${x.outcome}`)).toEqual([
    "architect:passed", "coder:passed", "tester:passed", "reviewer:failed", "tester:skipped",
    "coder:passed", "reviewer:passed", "tester:running",
  ]);
  const repair = t[5];
  expect(repair.repair).toBe(1);
  expect(repair.reason?.role).toBe("reviewer");
  expect(repair.reason?.detail).toBe("round 1/4: 19 passed, 1 failed");
});

it("the robot follows the running stage and the stored outcome only", async () => {
  const { botState } = await import("./agents");
  expect(botState(undefined)).toBe("idle");
  expect(botState(job({}))).toBe("idle");                                            // queued: nothing running
  expect(botState(job({ analyze: "running" }))).toBe("analyzing");
  expect(botState(job({ analyze: "passed", plan: "running" }))).toBe("planning");
  expect(botState(job({ generate_files: "running" }))).toBe("generating");
  expect(botState(job({ static_validation: "running" }))).toBe("reviewing");
  expect(botState(job({ sandbox_tests: "running" }))).toBe("testing");
  expect(botState(job({}, "completed"), "verified")).toBe("completed");
  expect(botState(job({}, "completed"), "validated")).toBe("completed");
  expect(botState(job({}, "completed"), "validation_failed")).toBe("failed");          // a failed Skill is never "completed"
  expect(botState(job({}, "failed"))).toBe("failed");
});


it("the user journey follows the real run, never marks 'use' done, and flags unverified tests", async () => {
  const { journey } = await import("./agents");
  expect(journey(undefined)).toEqual(["current", "todo", "todo", "todo", "todo", "todo"]);
  expect(journey(undefined, undefined, true)).toEqual(["done", "warn", "todo", "todo", "todo", "todo"]);
  expect(journey(job({ analyze: "running" }))).toEqual(["done", "current", "todo", "todo", "todo", "todo"]);
  expect(journey(job({ sandbox_tests: "running" }))).toEqual(["done", "done", "current", "todo", "todo", "todo"]);
  expect(journey(job({ analyze: "failed" }, "failed"))).toEqual(["done", "failed", "todo", "todo", "todo", "todo"]);
  expect(journey(job({}, "completed"), "validation_failed")).toEqual(["done", "done", "done", "failed", "todo", "todo"]);
  expect(journey(job({}, "completed"), "validated")).toEqual(["done", "done", "warn", "done", "current", "todo"]);
  expect(journey(job({}, "completed"), "verified")).toEqual(["done", "done", "done", "done", "current", "todo"]);
});
