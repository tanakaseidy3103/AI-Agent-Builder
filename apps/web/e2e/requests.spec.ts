/**
 * API request discipline: how many requests the UI makes while a job is live, after it ends, and across pages.
 * Mocked API with a job that stays "generating" for a fixed time, so counts are deterministic.
 */
import { expect, test, type Page } from "@playwright/test";
import { nav } from "./panes";

const STAGES = ["analyze", "specify", "plan", "generate_files", "static_validation", "test_generation", "sandbox_tests", "evaluate", "report", "package"];

async function mock(page: Page, liveMs: number) {
  const counts: Record<string, number> = {};
  let started = 0;
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    counts[p] = (counts[p] ?? 0) + 1;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/studio/skills/generate") { started = Date.now(); return json({ id: "j", status: "draft", stages: [] }, 202); }
    const done = started > 0 && Date.now() - started > liveMs;
    if (p === "/studio/jobs/j") return json({ id: "j", status: done ? "completed" : "generating", provider: "ollama:mock", stage: "generate_files", error: null,
      skill_version_id: done ? "v" : null, stages: STAGES.map((n, i) => ({ name: n, status: done || i < 3 ? "passed" : i === 3 ? "running" : "pending" })) });
    if (p === "/studio/events") return json([{ id: 1, agent_id: "coder", run_id: "j", state: "working", message: "generate_files: started", at: new Date().toISOString() }]);
    if (p === "/health") return json({ status: "ok" });
    if (p === "/studio/models") return json({ default: "m", installed: ["m"], error: null, runtime: [] });
    if (p === "/studio/versions/v") return json({ id: "v", skill_id: "s", slug: "x", version: "0.1.0", kind: "code", status: "verified", file_count: 0, files: [], versions: [],
      manifest: { id: "x", name: "X", description: "", version: "0.1.0", kind: "code", tools: [], dependencies: [], permissions: [], input_schema: {}, output_schema: {}, compatibility: [] }, validation: null });
    return json([]);
  });
  return { counts, start: () => started };
}

test("while a job is live: one job poll and one events poll per second; nothing after it ends", async ({ page }) => {
  const m = await mock(page, 6000);
  await page.goto("/#/studio");
  await page.getByLabel("Describe the agent you want").fill("An agent that finds TODO comments in source files");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/Request received/)).toBeVisible();
  await page.waitForTimeout(6000 - (Date.now() - m.start()) + 1500);  // the live window plus the final fetch after completion
  const live = { job: m.counts["/studio/jobs/j"] ?? 0, events: m.counts["/studio/events"] ?? 0 };
  await page.waitForTimeout(4000);
  const after = { job: (m.counts["/studio/jobs/j"] ?? 0) - live.job, events: (m.counts["/studio/events"] ?? 0) - live.events };
  test.info().annotations.push({ type: "requests", description: JSON.stringify({ live, after }) });
  console.log("REQUESTS", JSON.stringify({ live, after }));
  // ~6 s live at 1 s intervals (+ the first fetch and the final one): a budget, not an exact count
  expect(live.job).toBeLessThanOrEqual(9);
  expect(live.events).toBeLessThanOrEqual(9);
  expect(after).toEqual({ job: 0, events: 0 });  // polling stops when the job ends
});

test("navigating every page twice fetches each list once (shared cache)", async ({ page }) => {
  const m = await mock(page, 0);
  await page.goto("/");
  const pages = ["Overview", "Agent Studio", "My Agents", "Code Workspace", "My Projects", "Evaluations", "Integrations", "Settings"];
  for (const name of [...pages, ...pages]) { await nav(page, name); await page.waitForLoadState("networkidle"); }
  console.log("NAV", JSON.stringify(m.counts));
  for (const p of ["/studio/skills", "/studio/jobs", "/studio/evaluations", "/health"]) expect(m.counts[p] ?? 0, p).toBeLessThanOrEqual(1);
  expect(m.counts["/studio/models"] ?? 0).toBeLessThanOrEqual(3); // cached, except Integrations refreshes "loaded now" on each of its 2 visits
});
