import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LangProvider, type Lang } from "../i18n";
import { App } from "../App";

// Long UI flows (generate → poll → result → export) can exceed the 5 s default on a loaded machine.
vi.setConfig({ testTimeout: 15_000 });

// Mocked-backend UI tests. Real end-to-end coverage lives in apps/web/e2e (Playwright).
const STAGES = ["analyze", "specify", "plan", "generate_files", "static_validation", "test_generation", "sandbox_tests", "evaluate", "report", "package"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let jobPolls = 0;
let deleted: string[] = [];
const skillRows = [{ id: "s1", slug: "react-perf", name: "React Perf", description: "Finds perf issues", versions: 1,
  latest: { id: "v1", skill_id: "s1", slug: "react-perf", version: "0.1.0", kind: "code", status: "verified", file_count: 2, created_at: "2026-11-06T08:00:20Z" } }];
let projectCalls: string[] = [];
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
  if (url === "/api/health") return json({ status: "ok" });
  if (url === "/api/studio/jobs") return json(jobPolls > 1 ? [{ id: "j1", status: "completed", provider: "ollama:test", prompt: "Laravel", skill_version_id: current.id, stages: [] }] : []);
  if (url === "/api/studio/skills") return json(skillRows);
  if (url === "/api/studio/evaluations") return json([{ slug: "react-perf", name: "React Perf", versions: [{ version_id: "v1", version: "0.1.0",
    status: "verified", kind: "code", origin: "generated", model: "ollama:test", runs: 1, tests_total: 3, tests_passed: 3, evals_total: 2,
    evals_passed: 2, success_rate: 1, duration_ms: 900, validated_at: "2026-11-06T08:00:20Z", criteria: report.criteria, repair_rounds: 0 }] }]);
  if (url === "/api/studio/agents") return json([{ id: "tester", name: "Tester", role: "r", state: "failed", current_run: "j1", runs: 1, recent: [events[2]] }]);
  if (url === "/api/studio/skills/s1" && init?.method === "DELETE") { deleted.push("s1"); return new Response(null, { status: 204 }); }
  if (url.endsWith("/project/plan")) {
    projectCalls.push("plan");
    return json({ analysis: { root: "C:/work/shop", languages: ["JavaScript/TypeScript"], frameworks: ["React"], git: { branch: "main", head: "abc", dirty: false } },
      target: "claude-code", dest: ".claude/skills/react-perf", files: [{ path: ".claude/skills/react-perf/SKILL.md", bytes: 10 }],
      conflicts: [], blockers: [], branch: "aab/react-perf-0.1.0", token: "tok123" });
  }
  if (url.endsWith("/project/apply")) {
    projectCalls.push(`apply:${JSON.parse(String(init?.body)).token}`);
    return json({ created: [".claude/skills/react-perf/SKILL.md"], branch: "aab/react-perf-0.1.0", original_branch: "main", root: "C:/work/shop",
      rollback: { bash: 'cd "C:/work/shop" && rm -r ".claude/skills/react-perf" && git switch main && git branch -D aab/react-perf-0.1.0', powershell: "Remove-Item" } });
  }
  if (url === "/api/studio/models") return json({ default: "qwen2.5-coder:latest", installed: ["llama3.2:3b", "qwen2.5-coder:latest"], error: null });
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
  sessionStorage.clear();
  jobPolls = 0;
  deleted = [];
  projectCalls = [];
  current = version;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => router(url, init)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** A rendered code line (syntax highlighting splits it into token spans), matched on its full text. */
const codeLine = (text: string) => (_: string, el: Element | null) => !!el?.hasAttribute("data-line") && el.lastElementChild?.textContent === text;

function renderStudio(lang: Lang = "en", route = "#/studio") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.location.hash = route;
  render(<QueryClientProvider client={client}><LangProvider lang={lang}><App /></LangProvider></QueryClientProvider>);
}

async function createFromTemplate() {
  fireEvent.click(screen.getByRole("button", { name: /^Laravel bug finder/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  await screen.findByText("Open the result", {}, { timeout: 3000 });
}

it("first-time user: intro, sample, live pipeline from real stages/events, result workspace and export", async () => {
  renderStudio();
  expect(screen.getByRole("heading", { name: "What should your agent do?" })).toBeTruthy();
  expect(screen.getByText("No agent selected")).toBeTruthy();                 // empty result pane before any run
  const send = screen.getByRole("button", { name: "Create agent" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /^Laravel bug finder/ }));
  expect((screen.getByLabelText("Describe the agent you want") as HTMLTextAreaElement).value).toContain("Laravel");
  fireEvent.click(send);

  expect(await screen.findByText("Open the result", {}, { timeout: 3000 })).toBeTruthy();
  expect(jobPolls).toBeGreaterThanOrEqual(2); // kept polling while 'generating'
  expect(screen.getByText(/react-perf@0.1.0 is verified/)).toBeTruthy();
  await vi.waitFor(() => expect(screen.getByTestId("studio-bot").dataset.state).toBe("completed"));  // from the stored status
  expect(screen.getByTestId("studio-bot").dataset.verified).toBe("true");                             // only a verified run looks like a success

  // Agent Office: states come from the job's stages; repair rounds, handoffs and the stream from persisted events
  for (const r of ["architect", "coder", "reviewer", "tester", "packager"]) expect(screen.getByTestId(`role-${r}`).dataset.state).toBe("done");
  expect(screen.getAllByText(/1 repair round\(s\)/).length).toBeGreaterThan(0);
  const stream = screen.getByRole("list", { name: "Live activity" });
  expect([...stream.querySelectorAll(":scope > li")].map((li) => (li as HTMLElement).dataset.role)).toEqual(["architect", "tester", "coder"]);
  expect(within(stream).getByText(/Sent back by Tester/)).toBeTruthy();         // why the developer was sent back
  expect(within(stream).getAllByText(/1\/3 tests passed/)).toHaveLength(2); // the tester's result and the reason for the repair

  // the finished version opens in the result pane automatically
  expect(await screen.findByText(codeLine("def run(data): ..."))).toBeTruthy();       // code entrypoint preselected in the file explorer
  fireEvent.click(screen.getByRole("button", { name: "SKILL.md" }));
  expect(await screen.findByText(codeLine("name: react-perf"))).toBeTruthy();
  const ladder = within(screen.getByLabelText("Evidence")).getAllByRole("listitem");
  expect(ladder.map((li) => li.dataset.reached)).toEqual(["true", "true", "true", "true"]);
  fireEvent.click(screen.getByRole("tab", { name: /Tests/ }));
  expect(screen.getByText("hidden holdout")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Validation" }));
  expect(screen.getByText(/ran · 800 ms · no network · 256 MB/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Export" }));
  expect(await screen.findAllByText(/refuses to overwrite/)).toHaveLength(2);
  expect((screen.getByText("Download project (ZIP)") as HTMLAnchorElement).getAttribute("href")).toBe("/api/studio/versions/v1/export/claude-code");
  // the agent tab in the right pane shows the selected agent's real results
  fireEvent.click(screen.getByRole("button", { name: "Tester: Done" }));
  const panel = await screen.findByTestId("agent-panel");
  expect(panel.dataset.role).toBe("tester");
  expect(within(panel).getByText(/1\/3 tests passed/)).toBeTruthy();
  // the sidebar lists the real recent request and model
  expect(within(screen.getByRole("complementary", { name: "Sidebar" })).getByText("qwen2.5-coder:latest")).toBeTruthy();
});

it("explains a policy failure, why the sandbox did not run, and blocks export", async () => {
  current = failedVersion;
  renderStudio();
  await createFromTemplate();
  expect(screen.getByText(/failed validation, so it cannot be exported/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refine (add a correction)" }));
  const box = screen.getByLabelText("Describe the agent you want") as HTMLTextAreaElement;
  expect(box.value).toMatch(/Laravel[\s\S]*Correction: $/);
  expect(screen.getByText(/used something the sandbox never allows/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open the result" }));
  const ladder = within(await screen.findByLabelText("Evidence")).getAllByRole("listitem");
  expect(ladder.map((li) => li.dataset.reached)).toEqual(["true", "false", "false", "false"]);
  fireEvent.click(await screen.findByRole("tab", { name: "Validation" }));
  expect(screen.getByText(/The Skill cannot run external programs or linters/)).toBeTruthy();
  expect(screen.getByText(/static validation failed first, so the code was never executed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Export" }));
  expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("cannot be exported"))).toBe(true);
  expect(screen.queryByText("Download project (ZIP)")).toBeNull();
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

it("New agent clears the conversation; every nav item opens its page", async () => {
  renderStudio();
  await createFromTemplate();
  fireEvent.click(screen.getByRole("button", { name: "New agent" }));
  expect(screen.queryByText("Open the result")).toBeNull();
  expect(screen.getByRole("heading", { name: "What should your agent do?" })).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "Main" });
  for (const [link, heading] of [["Overview", "Overview"], ["My Agents", "My Agents"], ["Evaluations", "Evaluations"],
    ["My Projects", "My Projects"], ["Integrations", "Integrations"], ["Settings", "Settings"], ["Code Workspace", "Code Workspace"]]) {
    window.location.hash = within(nav).getByRole("link", { name: link }).getAttribute("href")!;
    expect(await screen.findByRole("heading", { name: heading, level: 1 })).toBeTruthy();
  }
});

it("overview shows only backend numbers and real recent activity", async () => {
  renderStudio("en", "#/overview");
  const agents = await screen.findByText("Agents", { selector: "dt" });
  await vi.waitFor(() => expect(agents.nextElementSibling?.textContent).toBe("1"));
  expect(screen.getByText("Verified", { selector: "dt" }).nextElementSibling?.textContent).toBe("1");
  expect(await screen.findByText("sandbox_tests: failed — 1/3 tests passed")).toBeTruthy();  // from /studio/agents
  expect(await screen.findByText(/tests 3\/3 · eval cases 2\/2/)).toBeTruthy();                  // from /studio/evaluations
});

it("my agents: evidence and model per agent; delete needs the slug typed", async () => {
  renderStudio("en", "#/agents");
  const card = await screen.findByTestId("agent-react-perf");
  expect(await within(card).findByText("ollama:test")).toBeTruthy();
  expect(within(card).getAllByRole("listitem").map((li) => li.dataset.reached)).toEqual(["true", "true", "true", "true"]);
  fireEvent.click(within(card).getByRole("button", { name: "Delete react-perf" }));
  const confirm = screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Type react-perf to confirm"), { target: { value: "react-perf" } });
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  await vi.waitFor(() => expect(deleted).toEqual(["s1"]));
});

it("renders the Japanese interface", async () => {
  renderStudio("ja");
  expect(screen.getByRole("heading", { name: "エージェントに何をさせますか？" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Laravel のバグ検出/ }));
  fireEvent.click(screen.getByRole("button", { name: "エージェントを作成" }));
  expect(await screen.findByText("結果を開く", {}, { timeout: 3000 })).toBeTruthy();
  expect(screen.getByText(/react-perf@0.1.0 は verified です/)).toBeTruthy();
});

it("copy code with destination paths, and implement in a project only after approving the plan", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  renderStudio();
  await createFromTemplate();
  await screen.findByText(codeLine("def run(data): ..."));
  fireEvent.click(screen.getByRole("button", { name: "Copy all files" }));
  await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
  const copied = (writeText.mock.calls[0] as unknown as [string])[0];
  expect(copied).toContain("# react-perf/SKILL.md\n---\nname: react-perf");
  expect(copied).toContain("# react-perf/scripts/main.py\ndef run(data): ...");

  fireEvent.click(screen.getByRole("tab", { name: "Export" }));
  expect(await screen.findByText("Publish to GitHub (from your machine)")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Project folder (absolute path)"), { target: { value: "C:/work/shop" } });
  fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
  const plan = await screen.findByTestId("project-plan");
  expect(within(plan).getByText("JavaScript/TypeScript, React")).toBeTruthy();
  expect(within(plan).getByText(".claude/skills/react-perf/SKILL.md")).toBeTruthy();
  expect(projectCalls).toEqual(["plan"]);                                   // analysing never applies
  fireEvent.click(within(plan).getByRole("button", { name: "Approve and create 1 files" }));
  expect(await screen.findByText("Installed 1 files.")).toBeTruthy();
  expect(projectCalls).toEqual(["plan", "apply:tok123"]);                   // apply carries the approved plan's token
  expect(screen.getByText(/git branch -D aab\/react-perf-0.1.0/)).toBeTruthy();
});

it("a failed Skill cannot be copied", async () => {
  current = failedVersion;
  renderStudio();
  await createFromTemplate();
  fireEvent.click(screen.getByRole("button", { name: "Open the result" }));
  await screen.findByText(codeLine("def run(data): ..."));
  expect((screen.getByRole("button", { name: "Copy all files" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByTestId("studio-bot").dataset.state).toBe("failed");               // a failed Skill is never "completed"
  const checks = screen.getByRole("list", { name: "Validation errors in this file" });   // shown next to the code it is about
  expect(within(checks).getByText(/forbidden modules/)).toBeTruthy();
});

// jsdom has no modal <dialog>; the browser's native one is what the app uses
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); };
}


it("after a run: the outcome offers only supported next steps (view, download, GitHub, project, re-test)", async () => {
  renderStudio();
  await createFromTemplate();
  const use = await screen.findByRole("group", { name: "Use this agent" });
  expect(within(use).getByRole("link", { name: "Download project" }).getAttribute("href")).toBe("/api/studio/versions/v1/export/canonical");
  expect(within(use).getByRole("link", { name: "GitHub & install commands" }).getAttribute("href")).toBe("#/code/v1/export");
  expect(within(use).getByRole("link", { name: "Add to my project" })).toBeTruthy();
  expect(within(use).getByRole("button", { name: "View code" })).toBeTruthy();
  expect(screen.getAllByText("Verified").length).toBeGreaterThan(0);              // plain-language status, not a raw code
});

it("a failed agent offers no download, only what failed", async () => {
  current = failedVersion;
  renderStudio();
  await createFromTemplate();
  expect(screen.queryByRole("group", { name: "Use this agent" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Download project" })).toBeNull();
  expect(screen.getByRole("link", { name: "See what failed" }).getAttribute("href")).toBe("#/code/v2/validation");
  expect(screen.getAllByText("Failed validation").length).toBeGreaterThan(0);
});

it("a reload during a run restores the conversation from this tab's session", async () => {
  sessionStorage.setItem("aab.studio.requests", JSON.stringify([{ jobId: "j1", prompt: "Laravel agent restored", kind: "auto" }]));
  renderStudio();
  expect(await screen.findByText("Laravel agent restored")).toBeTruthy();
  expect(await screen.findByText("Open the result", {}, { timeout: 3000 })).toBeTruthy();  // job state comes from the backend
  fireEvent.click(screen.getByRole("button", { name: "New agent" }));
  expect(screen.queryByText("Laravel agent restored")).toBeNull();
  expect(JSON.parse(sessionStorage.getItem("aab.studio.requests") ?? "[]")).toEqual([]);
});

it("my agents: search, status filter and empty result", async () => {
  renderStudio("en", "#/agents");
  await screen.findByTestId("agent-react-perf");
  expect(screen.getByText("1 of 1")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search agents"), { target: { value: "laravel" } });
  expect(screen.getByText("No agent matches this search.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search agents"), { target: { value: "perf" } });
  fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "validation_failed" } });
  expect(screen.queryByTestId("agent-react-perf")).toBeNull();
  fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "verified" } });
  expect(screen.getByTestId("agent-react-perf")).toBeTruthy();
});
