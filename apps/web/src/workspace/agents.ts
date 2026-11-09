/**
 * Agent Office model: pure functions from the persisted job (stages) and agent events to what the UI shows.
 * The backend is ONE sequential pipeline; an "agent" is the role that owns a group of its stages.
 * Event messages are produced by pipeline.Tracker: "<stage>: started (<label>)" and "<stage>: <status> — <detail>".
 */
import type { AgentEvent, AgentId, Job, Stage } from "../api";

export const ROLE_ORDER: AgentId[] = ["architect", "coder", "reviewer", "tester", "packager"];
export const ROLE_STAGES: Record<AgentId, string[]> = {
  architect: ["analyze", "specify", "plan"],
  coder: ["generate_files"],
  reviewer: ["static_validation", "report"],
  tester: ["test_generation", "sandbox_tests", "evaluate"],
  packager: ["package"],
};

export type AgentState = "waiting" | "working" | "done" | "failed";
type Kind = "started" | "passed" | "failed" | "skipped" | "error" | "completed" | "other";

export interface Step { ev: AgentEvent; role: AgentId; stage: string | null; kind: Kind; label?: string; detail?: string; repair?: number }

const STEP = /^(\w+): (started|passed|failed|skipped)(?: \(([^)]*)\))?(?: — ([\s\S]*))?$/;

export function parseEvent(ev: AgentEvent): Step {
  const msg = ev.message ?? "";
  const m = STEP.exec(msg);
  if (m) {
    const repair = m[2] === "started" ? Number(/^repair (\d+)$/.exec(m[3] ?? "")?.[1]) || undefined : undefined;
    return { ev, role: ev.agent_id, stage: m[1], kind: m[2] as Kind, label: m[3], detail: m[4], repair };
  }
  const err = /^generation failed at (\w+): ([\s\S]*)$/.exec(msg);
  if (err) return { ev, role: ev.agent_id, stage: err[1], kind: "error", detail: err[2] };
  if (ev.state === "completed") return { ev, role: ev.agent_id, stage: null, kind: "completed", detail: msg };
  return { ev, role: ev.agent_id, stage: null, kind: "other", detail: msg };
}

export interface AgentView {
  id: AgentId; state: AgentState; stages: Stage[]; done: number; total: number;
  current?: Stage; startedAt?: string; last?: Step; repairs: number;
}

/** State per agent. "working" only while one of its stages is running in the persisted job. */
export function agentViews(job: Job | undefined, events: AgentEvent[]): AgentView[] {
  const steps = [...events].sort((a, b) => a.id - b.id).map(parseEvent);
  return ROLE_ORDER.map((id) => {
    const stages = (job?.stages ?? []).filter((s) => ROLE_STAGES[id].includes(s.name));
    const mine = steps.filter((s) => s.role === id);
    const current = stages.find((s) => s.status === "running");
    const finished = mine.filter((s) => s.kind !== "started" && s.kind !== "other");
    const last = mine.at(-1);
    let state: AgentState = "waiting";
    if (current) state = "working";
    else if (stages.length && stages.every((s) => s.status === "passed" || s.status === "skipped")) state = "done";
    else if (stages.some((s) => s.status === "failed")) state = "failed";
    else if (finished.at(-1)?.kind === "failed" || finished.at(-1)?.kind === "error") state = "failed";
    const startedAt = current ? [...mine].reverse().find((s) => s.kind === "started" && s.stage === current.name)?.ev.at : undefined;
    return {
      id, state, stages, current, startedAt, last,
      done: stages.filter((s) => s.status === "passed" || s.status === "skipped").length,
      total: ROLE_STAGES[id].length,
      repairs: mine.filter((s) => s.repair).length,
    };
  });
}

export interface Turn { role: AgentId; steps: Step[]; outcome: "running" | "passed" | "failed" | "skipped"; repair?: number; reason?: Step }

/** Consecutive events of the same agent form a turn; a new agent taking over is a handoff. */
export function turns(events: AgentEvent[]): Turn[] {
  const out: Turn[] = [];
  for (const s of [...events].sort((a, b) => a.id - b.id).map(parseEvent)) {
    const cur = out.at(-1);
    if (cur && cur.role === s.role && !(s.repair && cur.steps.some((x) => x.kind !== "started"))) cur.steps.push(s);
    else out.push({ role: s.role, steps: [s], outcome: "running" });
  }
  out.forEach((t, i) => {
    const kinds = t.steps.map((s) => s.kind);
    t.repair = t.steps.find((s) => s.repair)?.repair;
    t.outcome = kinds.some((k) => k === "failed" || k === "error") ? "failed"
      : t.steps.at(-1)!.kind === "started" ? "running"
      : kinds.filter((k) => k !== "started").every((k) => k === "skipped") ? "skipped" : "passed";
    if (t.repair) {
      // why the developer was sent back: the latest failure reported before this turn (reviewer or tester)
      for (let j = i - 1; j >= 0 && !t.reason; j--) t.reason = [...out[j].steps].reverse().find((s) => s.kind === "failed");
    }
  });
  return out;
}

export type BotState = "idle" | "analyzing" | "planning" | "generating" | "reviewing" | "testing" | "completed" | "failed";
const STAGE_BOT: Record<string, BotState> = {
  analyze: "analyzing", specify: "planning", plan: "planning", generate_files: "generating", test_generation: "generating",
  static_validation: "reviewing", report: "reviewing", sandbox_tests: "testing", evaluate: "testing", package: "generating",
};

/** The Studio robot's state: the running stage of the real job, or the stored outcome. Never inferred from time. */
export function botState(job: Job | undefined, versionStatus?: string): BotState {
  if (!job) return "idle";
  if (job.status === "failed") return "failed";
  if (job.status === "completed") return versionStatus === "validation_failed" ? "failed" : "completed";
  const running = job.stages.find((s) => s.status === "running");
  return running ? STAGE_BOT[running.name] ?? "idle" : "idle"; // queued: nothing is running yet
}


export const JOURNEY = ["describe", "create", "test", "review", "export", "use"] as const;
export type StepState = "todo" | "current" | "done" | "failed" | "warn";
const STAGE_STEP: Record<string, number> = {
  analyze: 1, specify: 1, plan: 1, generate_files: 1, test_generation: 1, static_validation: 1,
  sandbox_tests: 2, evaluate: 2, report: 3, package: 3,
};

/** The user's path through the real run. "use" is never marked done: the app cannot know you used the agent. */
export function journey(job: Job | undefined, versionStatus?: string, awaitingApproval = false): StepState[] {
  const s: StepState[] = JOURNEY.map(() => "todo");
  const upTo = (i: number, state: StepState) => { for (let k = 0; k < i; k++) s[k] = "done"; s[i] = state; return s; };
  if (awaitingApproval) return upTo(1, "warn");                       // a plan is waiting for the user's approval
  if (!job) return upTo(0, "current");
  if (job.status === "failed") {
    const at = job.stages.find((x) => x.status === "failed" || x.status === "running");
    return upTo(at ? STAGE_STEP[at.name] ?? 1 : 1, "failed");
  }
  if (job.status !== "completed") {
    const running = job.stages.find((x) => x.status === "running");
    return upTo(running ? STAGE_STEP[running.name] ?? 1 : 1, "current");
  }
  if (!versionStatus) return upTo(3, "current");                      // result is loading
  if (versionStatus === "validation_failed") return upTo(3, "failed");
  upTo(4, "current");
  if (versionStatus !== "verified") s[2] = "warn";                    // ran, but the tests did not all pass
  return s;
}
