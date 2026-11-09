/**
 * UI behaviour with intercepted /api calls. These tests prove the INTERFACE (states, validation, keyboard,
 * responsive layout, export restrictions). They do NOT prove generation works: see real*.spec.ts for that.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { advanced, nav, openFile, pane } from "./panes";

const STAGES = ["analyze", "specify", "plan", "generate_files", "static_validation", "test_generation", "sandbox_tests", "evaluate", "report", "package"];

function versionFor(status: "verified" | "validation_failed") {
  const failed = status === "validation_failed";
  return {
    id: failed ? "vf" : "vv", skill_id: "s", slug: "laravel-bug-finder", version: "0.1.0", kind: "code", status, file_count: 2,
    manifest: { id: "laravel-bug-finder", name: "Laravel Bug Finder", description: "Finds Laravel bugs", version: "0.1.0", kind: "code",
      tools: [], dependencies: [], permissions: ["compute"], input_schema: { type: "object" }, output_schema: { type: "object" },
      compatibility: ["claude-code", "codex", "cursor"], execution: { entrypoint: "scripts/main.py", timeout_seconds: 10, memory_mb: 256 } },
    files: [{ path: "SKILL.md", size: 10 }, { path: "scripts/main.py", size: 20 }],
    versions: [],
    validation: { id: "r", status, report: {
      status, duration_ms: 500, failure_category: failed ? "policy" : "none", repair_rounds: 1,
      static: { passed: failed ? 19 : 20, failed: failed ? 1 : 0, warnings: 0, checks: failed
        ? [{ id: "python.policy:scripts/main.py", status: "fail", message: "forbidden modules ['subprocess']", hint: "The Skill cannot run external programs" }]
        : [{ id: "manifest.schema", status: "pass", message: "ok" }] },
      tests: [], evals: [], criteria: [{ id: "static", passed: !failed, detail: "" }],
      sandbox: failed ? { status: "not_run" } : { status: "ran", duration_ms: 700, limits: { memory_mb: 256, timeout_s: 10 } } } },
  };
}

async function mockApi(page: Page, outcome: "verified" | "validation_failed" | "start-error") {
  let polls = 0;
  const v = versionFor(outcome === "verified" ? "verified" : "validation_failed");
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, "");
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/health") return json({ status: "ok" });
    if (p === "/studio/skills/generate") return outcome === "start-error" ? json({ detail: "Ollama unreachable at http://127.0.0.1:11434" }, 503) : json({ id: "j", status: "draft", stages: [] }, 202);
    if (p === "/studio/jobs/j") {
      polls++;
      const done = polls > 2;
      return json({ id: "j", status: done ? "completed" : "generating", provider: "ollama:mock", stage: done ? null : "generate_files", error: null,
        skill_version_id: done ? v.id : null, stages: STAGES.map((n, i) => ({ name: n, status: done || i < 3 ? "passed" : i === 3 ? "running" : "pending" })) });
    }
    if (p === "/studio/events") return json([
      { id: 1, agent_id: "architect", run_id: "j", state: "idle", message: "plan: passed", at: new Date().toISOString() },
      { id: 2, agent_id: "coder", run_id: "j", state: polls > 2 ? "idle" : "working", message: "generate_files: started", at: new Date().toISOString() },
    ]);
    if (p === `/studio/versions/${v.id}`) return json(v);
    if (p.startsWith(`/studio/versions/${v.id}/files/`)) return route.fulfill({ status: 200, contentType: "text/plain", body: "---\nname: laravel-bug-finder\n---" });
    if (p === "/studio/integrations") return json([{ id: "claude-code", label: "Claude Code", scope: "user", notes: "Installs into ~/.claude/skills" }]);
    if (p.includes("/install/")) return json({ zip: "x.zip", version: "0.1.0", status: "verified", note: "cannot confirm", target: { label: "Claude Code", notes: "n" },
      install: { bash: "echo install", powershell: "echo install" }, replace: { bash: "mv", powershell: "Rename-Item", warning: "w" } });
    if (p === "/studio/skills" || p === "/studio/api-keys") return json([]);
    if (p === "/studio/jobs") return json([]);
    if (p === "/studio/evaluations" || p === "/studio/agents") return json([]);
    if (p === "/studio/skills/plan") return json({ provider: "ollama:mock", spec: { name: "Laravel Bug Finder", description: "Finds bugs", kind: "code",
      instructions: "Scan PHP files.", tools: ["Read", "Grep"], permissions: ["read-input-files"], input_schema: { type: "object" }, output_schema: { type: "object" } },
      preview: { slug: "laravel-bug-finder", kind: "code", name: "Laravel Bug Finder", permissions: ["read-input-files"], tools: ["Read", "Grep"],
        files: ["SKILL.md", "manifest.json"], input_schema: { type: "object" }, output_schema: { type: "object" }, warnings: [] } });
    if (p === "/studio/models") return json({ default: "qwen2.5-coder:latest", installed: ["qwen2.5-coder:latest"], error: null });
    return json({ detail: `unmocked ${p}` }, 404);
  });
}

test("first visit: one clear request box, samples, an idle team, empty result pane", async ({ page }) => {
  await mockApi(page, "verified");
  await page.goto("/#/studio");
  for (const r of ["architect", "coder", "reviewer", "tester", "packager"]) await expect(page.getByTestId(`role-${r}`)).toHaveAttribute("data-state", "waiting");
  await expect(page.locator(".agent-orbit, .agent-bars")).toHaveCount(0);                         // no motion without a run
  await expect(page.getByRole("heading", { name: "What should your agent do?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create agent" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Laravel bug finder/ })).toBeVisible();
  await pane(page, "Result");
  await expect(page.getByText("No agent selected")).toBeVisible();
});

test("form validation, live pipeline, result workspace and export of a verified Skill", async ({ page }) => {
  await mockApi(page, "verified");
  await page.goto("/#/studio");
  const input = page.getByLabel("Describe the agent you want");
  await input.fill("short");
  await expect(page.getByText("Write at least 10 characters.")).toBeVisible();
  await page.getByRole("button", { name: /^Laravel bug finder/ }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/Now · Developer/)).toBeVisible();                    // only while the backend reports a running stage
  await expect(page.getByTestId("role-coder")).toHaveAttribute("data-state", "working");
  await expect(page.getByTestId("role-reviewer")).toHaveAttribute("data-state", "waiting");     // nobody else pretends to work
  await expect(page.getByTestId("role-coder")).toHaveAttribute("data-state", "done");
  await page.getByRole("button", { name: "Open the result" }).click();
  await openFile(page, "SKILL.md");
  await expect(page.getByLabel("file preview")).toContainText("name: laravel-bug-finder");
  await page.getByRole("tab", { name: "Manifest" }).click();
  await expect(page.getByText("Permissions")).toBeVisible();
  await page.getByRole("tab", { name: /Repairs/ }).click();
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(page.getByRole("link", { name: "Download project (ZIP)" })).toHaveAttribute("href", "/api/studio/versions/vv/export/claude-code");
});

test("a failed Skill explains the failure and cannot be exported", async ({ page }) => {
  await mockApi(page, "validation_failed");
  await page.goto("/#/studio");
  await page.getByRole("button", { name: /^Laravel bug finder/ }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/failed validation, so it cannot be exported/)).toBeVisible();
  await page.getByRole("button", { name: "Open the result" }).click();
  await page.getByRole("tab", { name: "Validation" }).click();
  await expect(page.getByText(/The Skill cannot run external programs/)).toBeVisible();
  await expect(page.getByText(/static validation failed first, so the code was never executed/)).toBeVisible();
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "cannot be exported" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download project (ZIP)" })).toHaveCount(0);
});

test("a backend error is shown, not hidden", async ({ page }) => {
  await mockApi(page, "start-error");
  await page.goto("/#/studio");
  await page.getByRole("button", { name: /^Laravel bug finder/ }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByRole("alert")).toContainText("Ollama unreachable");
});

test("keyboard: skip link, focus on the request, Ctrl+Enter submits", async ({ page }) => {
  await mockApi(page, "verified");
  await page.goto("/#/studio");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  const input = page.getByLabel("Describe the agent you want");
  await input.focus();
  await input.fill("An agent that finds TODO comments in source files");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText(/Request received/)).toBeVisible();
});

test("Japanese interface", async ({ page }) => {
  await mockApi(page, "verified");
  await page.goto("/#/studio");
  if (await page.getByRole("button", { name: "Menu" }).isVisible()) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "日本語" }).click();
  await page.keyboard.press("Escape");                                                   // closes the drawer on mobile
  await expect(page.getByRole("heading", { name: "エージェントに何をさせますか？" })).toBeVisible();
  await expect(page.locator("div[lang]").first()).toHaveAttribute("lang", "ja");
});

test("every page: no horizontal overflow and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await mockApi(page, "verified");
  await page.goto("/");
  for (const name of ["Overview", "Agent Studio", "My Agents", "Code Workspace", "My Projects", "Evaluations", "Integrations", "Settings"]) {
    await nav(page, name);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, name).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test("plan review: nothing is generated until the user approves; rejecting discards the plan", async ({ page }) => {
  await mockApi(page, "verified");
  const generated: unknown[] = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/studio/skills/generate")) generated.push(r.postDataJSON()); });
  await page.goto("/#/studio");
  await page.getByRole("button", { name: /^Laravel bug finder/ }).click();
  await advanced(page);
  await page.getByLabel("Review the plan before generating").check();
  await page.getByRole("button", { name: "Propose plan" }).click();
  const plan = page.getByTestId("plan-review");
  await expect(plan).toBeVisible();
  await expect(page.getByRole("region", { name: "Agent Office" }).getByText("Approval needed")).toBeVisible();
  for (const r of ["architect", "coder", "reviewer", "tester", "packager"]) await expect(page.getByTestId(`role-${r}`)).toHaveAttribute("data-state", "waiting");
  await plan.getByRole("button", { name: "Reject" }).click();
  await expect(plan).toHaveCount(0);
  expect(generated).toEqual([]);

  await page.getByRole("button", { name: "Propose plan" }).click();
  await page.getByRole("textbox", { name: "Instructions" }).fill("Scan PHP and Blade files only.");
  await page.getByRole("checkbox", { name: "Grep" }).uncheck();
  await page.getByRole("button", { name: "Approve and generate" }).click();
  await expect(page.getByText(/Request received/)).toBeVisible();
  expect(generated).toHaveLength(1);
  expect(generated[0]).toMatchObject({ spec: { instructions: "Scan PHP and Blade files only.", tools: ["Read"] } });
});
