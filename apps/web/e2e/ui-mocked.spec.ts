/**
 * UI behaviour with intercepted /api calls. These tests prove the INTERFACE (states, validation, keyboard,
 * responsive layout, export restrictions). They do NOT prove generation works: see real*.spec.ts for that.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

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
    return json({ detail: `unmocked ${p}` }, 404);
  });
}

test("first visit explains the product and offers templates", async ({ page }) => {
  await mockApi(page, "verified");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Build AI agents you can actually trust" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create agent" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Laravel bug finder" })).toBeVisible();
});

test("form validation, progress, result tabs and export of a verified Skill", async ({ page }) => {
  await mockApi(page, "verified");
  await page.goto("/");
  const input = page.getByLabel("Describe the agent you want");
  await input.fill("short");
  await expect(page.getByText("Write at least 10 characters.")).toBeVisible();
  await page.getByRole("button", { name: "Laravel bug finder" }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText("Now: generate_files")).toBeVisible();              // loading/progress state
  await expect(page.getByTestId("robot-coder")).toHaveAttribute("data-state", /working|idle/);
  await page.getByRole("button", { name: "Open the result" }).click();
  await expect(page.getByLabel("file preview")).toContainText("name: laravel-bug-finder");
  await page.getByRole("tab", { name: "Manifest" }).click();
  await expect(page.getByText("Permissions")).toBeVisible();
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(page.getByRole("link", { name: "Download ZIP" })).toHaveAttribute("href", "/api/studio/versions/vv/export/claude-code");
});

test("a failed Skill explains the failure and cannot be exported", async ({ page }) => {
  await mockApi(page, "validation_failed");
  await page.goto("/");
  await page.getByRole("button", { name: "Laravel bug finder" }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/failed validation, so it cannot be exported/)).toBeVisible();
  await page.getByRole("button", { name: "Open the result" }).click();
  await page.getByRole("tab", { name: "Validation" }).click();
  await expect(page.getByText(/The Skill cannot run external programs/)).toBeVisible();
  await expect(page.getByText(/static validation failed first, so the code was never executed/)).toBeVisible();
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(page.getByRole("alert")).toContainText("cannot be exported");
  await expect(page.getByRole("link", { name: "Download ZIP" })).toHaveCount(0);
});

test("a backend error is shown, not hidden", async ({ page }) => {
  await mockApi(page, "start-error");
  await page.goto("/");
  await page.getByRole("button", { name: "Laravel bug finder" }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByRole("alert")).toContainText("Ollama unreachable");
});

test("keyboard: skip link, focus on the request, Ctrl+Enter submits", async ({ page }) => {
  await mockApi(page, "verified");
  await page.goto("/");
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
  await page.goto("/");
  await page.getByRole("button", { name: "日本語" }).click();
  await expect(page.getByRole("heading", { name: "信頼できる AI エージェントを、言葉から。" })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("lang", "ja");
});

test("no horizontal overflow and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await mockApi(page, "verified");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
