import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LangProvider, type Lang } from "../i18n";
import { AgentStudio } from "./AgentStudio";

// Mocked-backend UI tests. Real end-to-end coverage lives in apps/web/e2e (Playwright).
const STAGES = ["analyze", "specify", "plan", "generate_files", "static_validation", "test_generation", "sandbox_tests", "evaluate", "report", "package"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let jobPolls = 0;
const report = {
  status: "verified", duration_ms: 900, failure_category: "none", repair_rounds: 0,
  static: { passed: 1, failed: 0, warnings: 0, checks: [{ id: "manifest.schema", status: "pass", message: "ok", hint: null }] },
  tests: [{ name: "test_main.T.test_x", status: "pass", detail: "" }],
  evals: [{ name: "visible", status: "pass", reasons: [] }, { name: "hidden", status: "pass", reasons: [], holdout: true }],
  criteria: [{ id: "static", passed: true, detail: "1 passed" }, { id: "unit_tests", passed: true, detail: "3/3" }, { id: "eval_cases", passed: true, detail: "3/3" }],
  sandbox: { status: "ran", duration_ms: 800, limits: { memory_mb: 256, timeout_s: 10 } },
};
const version = {
  id: "v1", skill_id: "s1", slug: "react-perf", version: "0.1.0", kind: "code", status: "verified", file_count: 2,
  manifest: { id: "react-perf", name: "React Perf", description: "Finds perf issues", version: "0.1.0", kind: "code", tools: ["Read"],
    dependencies: [], permissions: ["compute"], input_schema: { type: "object" }, output_schema: { type: "object" },
    compatibility: ["claude-code", "codex", "cursor"], execution: { entrypoint: "scripts/main.py", timeout_seconds: 10, memory_mb: 256 } },
  files: [{ path: "SKILL.md", size: 10 }, { path: "scripts/main.py", size: 20 }],
  validation: { id: "r1", status: "verified", report },
  versions: [{ id: "v1", slug: "react-perf", version: "0.1.0", kind: "code", status: "verified", file_count: 2 }],
};
const failedVersion = {
  ...version, id: "v2", status: "validation_failed",
  validation: { id: "r2", status: "validation_failed", report: { ...report, status: "validation_failed", failure_category: "policy",
    static: { passed: 19, failed: 1, warnings: 0, checks: [{ id: "python.policy:scripts/main.py", status: "fail",
      message: "forbidden modules ['subprocess']", hint: "The Skill cannot run external programs or linters" }] },
    tests: [], evals: [], criteria: [{ id: "static", passed: false, detail: "19 passed, 1 failed" }], sandbox: { status: "not_run" } } },
};
let current: { id: string } & Record<string, unknown> = version; // swapped per test
const events = [
  { id: 1, agent_id: "architect", run_id: "j1", state: "planning", message: "analyze: started", at: "2026-11-06T08:00:00Z" },
  { id: 2, agent_id: "architect", run_id: "j1", state: "idle", message: "plan: passed", at: "2026-11-06T08:00:05Z" },
  { id: 3, agent_id: "tester", run_id: "j1", state: "failed", message: "sandbox_tests: failed — 1/3 tests passed", at: "2026-11-06T08:00:09Z" },
  { id: 4, agent_id: "coder", run_id: "j1", state: "working", message: "generate_files: started (repair 1)", at: "2026-11-06T08:00:10Z" },
];

function router(url: string, init?: RequestInit) {
  if (url === "/api/studio/skills/generate" && init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    if (body.prompt.includes("FAIL")) return json({ detail: "Ollama unreachable" }, 500);
    return json({ id: "j1", status: "draft", stages: [] }, 202);
  }
  if (url === "/api/studio/jobs/j1") {
    jobPolls++;
    const done = jobPolls > 1;
    return json({ id: "j1", status: done ? "completed" : "generating", provider: "ollama:test", stage: done ? null : "analyze", error: null,
      skill_version_id: done ? current.id : null,
      stages: STAGES.map((n, i) => ({ name: n, status: done ? "passed" : i === 0 ? "running" : "pending", detail: done ? `${n} ok` : "" })) });
  }
  if (url.startsWith("/api/studio/events?run_id=j1")) return json(events);
  if (url === `/api/studio/versions/${current.id}`) return json(current);
  if (url.endsWith("/files/SKILL.md")) return new Response("---\nname: react-perf\n---", { headers: { "content-type": "text/plain" } });
  if (url.endsWith("/files/scripts/main.py")) return new Response("def run(data): ...", { headers: { "content-type": "text/plain" } });
  if (url === "/api/studio/integrations") return json([{ id: "claude-code", label: "Claude Code", scope: "user", notes: "n" }]);
  if (url.includes("/install/")) return json({ zip: "react-perf-0.1.0-claude-code.zip", version: "0.1.0", status: "verified",
    note: "AI Agent Builder cannot confirm the installation.", target: { label: "Claude Code", notes: "skills dir" },
    install: { bash: 'if [ -e "$DEST/react-perf" ]; then echo exists', powershell: "Test-Path" },
    replace: { bash: "mv backup", powershell: "Rename-Item", warning: "backup first" } });
  return json({ detail: `unmocked ${url}` }, 404);
}

beforeEach(() => {
  jobPolls = 0;
  current = version;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => router(url, init)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderStudio(lang: Lang = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LangProvider lang={lang}><AgentStudio /></LangProvider></QueryClientProvider>);
}

async function createFromTemplate() {
  fireEvent.click(screen.getByRole("button", { name: "Laravel bug finder" }));
  fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  await screen.findByText("Open the result", {}, { timeout: 3000 });
}

it("first-time user: hero, templates, chat flow, real-event robots, result tabs and export", async () => {
  renderStudio();
  expect(screen.getByRole("heading", { name: "Build AI agents you can actually trust" })).toBeTruthy();
  const send = screen.getByRole("button", { name: "Create agent" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Laravel bug finder" }));
  expect((screen.getByLabelText("Describe the agent you want") as HTMLTextAreaElement).value).toContain("Laravel");
  fireEvent.click(send);

  expect(await screen.findByText("Open the result", {}, { timeout: 3000 })).toBeTruthy();
  expect(jobPolls).toBeGreaterThanOrEqual(2); // kept polling while 'generating'
  expect(screen.getByText(/react-perf@0.1.0 is verified/)).toBeTruthy();
  expect(within(screen.getByLabelText("pipeline stages")).getAllByRole("listitem")).toHaveLength(10);

  // robots reflect the latest persisted event per role; roles without events stay 'waiting'
  expect(screen.getByTestId("robot-architect").dataset.state).toBe("idle");
  expect(screen.getByTestId("robot-tester").dataset.state).toBe("failed");
  expect(screen.getByTestId("robot-coder").dataset.state).toBe("working");
  expect(within(screen.getByTestId("robot-coder")).getByText("1 repair round(s)")).toBeTruthy();
  expect(screen.getByTestId("robot-reviewer").dataset.state).toBe("waiting");
  expect(screen.getByText("sandbox_tests: failed — 1/3 tests passed")).toBeTruthy();
  expect(screen.getByText(/Planned \(not implemented yet\)/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Open the result" }));
  expect(await screen.findByText(/name: react-perf/)).toBeTruthy();
  const ladder = within(screen.getByLabelText("Evidence")).getAllByRole("listitem");
  expect(ladder.map((li) => li.dataset.reached)).toEqual(["true", "true", "true", "true"]);
  fireEvent.click(screen.getByRole("tab", { name: "Validation" }));
  expect(screen.getByText("hidden holdout")).toBeTruthy();
  expect(screen.getByText(/ran · 800 ms · no network · 256 MB/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Export" }));
  expect(await screen.findAllByText(/refuses to overwrite/)).toHaveLength(2);
  expect((screen.getByText("Download ZIP") as HTMLAnchorElement).getAttribute("href")).toBe("/api/studio/versions/v1/export/claude-code");
});

it("explains a policy failure, why the sandbox did not run, and blocks export", async () => {
  current = failedVersion;
  renderStudio();
  await createFromTemplate();
  expect(screen.getByText(/failed validation, so it cannot be exported/)).toBeTruthy();
  expect(screen.getByText(/used something the sandbox never allows/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open the result" }));
  const ladder = within(await screen.findByLabelText("Evidence")).getAllByRole("listitem");
  expect(ladder.map((li) => li.dataset.reached)).toEqual(["true", "false", "false", "false"]);
  fireEvent.click(await screen.findByRole("tab", { name: "Validation" }));
  expect(screen.getByText(/The Skill cannot run external programs or linters/)).toBeTruthy();
  expect(screen.getByText(/static validation failed first, so the code was never executed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Export" }));
  expect(screen.getByRole("alert").textContent).toContain("cannot be exported");
  expect(screen.queryByText("Download ZIP")).toBeNull();
});

it("shows an honest error when generation cannot start", async () => {
  renderStudio();
  fireEvent.change(screen.getByLabelText("Describe the agent you want"), { target: { value: "FAIL please generate this" } });
  fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Ollama unreachable");
});

it("validates the minimum prompt length", () => {
  renderStudio();
  fireEvent.change(screen.getByLabelText("Describe the agent you want"), { target: { value: "short" } });
  expect(screen.getByText("Write at least 10 characters.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Create agent" }) as HTMLButtonElement).disabled).toBe(true);
});

it("renders the Japanese interface", async () => {
  renderStudio("ja");
  expect(screen.getByRole("heading", { name: "信頼できる AI エージェントを、言葉から。" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Laravel のバグ検出" }));
  fireEvent.click(screen.getByRole("button", { name: "エージェントを作成" }));
  expect(await screen.findByText("結果を開く", {}, { timeout: 3000 })).toBeTruthy();
  expect(screen.getByText(/react-perf@0.1.0 は verified です/)).toBeTruthy();
});
