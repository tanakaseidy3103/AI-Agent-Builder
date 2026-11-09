/**
 * Persona journeys with click counts. AUTOMATED walkthroughs, not human usability tests: they prove each path works
 * end to end and measure how many clicks it takes. Desktop only (mobile layout is covered by the other specs).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

test.skip(({ isMobile }) => isMobile, "desktop journeys");

function counter(page: Page) {
  let clicks = 0;
  const click = async (l: Locator) => { clicks++; await l.click(); };
  return { click, get clicks() { return clicks; }, page };
}

test("beginner: understands the product, creates an agent from an example, finds its code", async ({ page }) => {
  // generation is mocked here (deterministic); real generations are covered by real-generation.spec.ts
  let polls = 0;
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const json = (b: unknown, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/studio/skills/generate") return json({ id: "j", status: "draft", stages: [] }, 202);
    if (p === "/studio/jobs/j") { polls++; const done = polls > 2;
      return json({ id: "j", status: done ? "completed" : "generating", provider: "ollama:mock", stage: null, error: null, skill_version_id: done ? "v" : null,
        stages: ["analyze", "specify", "plan", "generate_files", "static_validation", "test_generation", "sandbox_tests", "evaluate", "report", "package"].map((n, i) => ({ name: n, status: done ? "passed" : i === 0 ? "running" : "pending" })) }); }
    if (p === "/studio/versions/v") return json({ id: "v", skill_id: "s", slug: "laravel-bug-finder", version: "0.1.0", kind: "code", status: "verified", file_count: 1,
      files: [{ path: "scripts/main.py", size: 30 }], versions: [],
      manifest: { id: "laravel-bug-finder", name: "Laravel Bug Finder", description: "d", version: "0.1.0", kind: "code", tools: [], dependencies: [], permissions: [], input_schema: {}, output_schema: {}, compatibility: ["claude-code"] },
      validation: { id: "r", status: "verified", report: { status: "verified", duration_ms: 1, failure_category: "none", repair_rounds: 0, static: { passed: 1, failed: 0, warnings: 0, checks: [] }, tests: [], evals: [], criteria: [], sandbox: { status: "ran", duration_ms: 1, limits: { memory_mb: 256 } } } } });
    if (p.startsWith("/studio/versions/v/files/")) return route.fulfill({ status: 200, contentType: "text/plain", body: "def run(data):\n    return {}\n" });
    if (p === "/health") return json({ status: "ok" });
    if (p === "/studio/models") return json({ default: "m", installed: ["m"], error: null, runtime: [] });
    return json([]);
  });
  const u = counter(page);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "How it works" })).toContainText("An agent is a small, tested program");
  await u.click(page.getByRole("link", { name: "Create agent" }));
  await u.click(page.getByRole("button", { name: /^Laravel bug finder/ }));
  await u.click(page.getByRole("button", { name: "Create agent" }));
  await expect(page.getByRole("group", { name: "Use this agent" })).toBeVisible();
  await expect(page.getByTestId("studio-bot")).toHaveAttribute("data-state", "completed");
  await u.click(page.getByRole("button", { name: "View code" }));
  await expect(page.locator('[data-line="1"]').first()).toContainText("def run(data):");
  test.info().annotations.push({ type: "clicks: open app → see generated code", description: String(u.clicks) });
  expect(u.clicks).toBeLessThanOrEqual(4);
});

test("developer: finds a verified agent, checks its validation, exports it (real data)", async ({ page, request }) => {
  const u = counter(page);
  await page.goto("/");
  await u.click(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My Agents" }));
  await page.getByLabel("Search agents").fill("api test");
  const card = page.getByTestId("agent-api-test-planner");
  await expect(card).toBeVisible();
  await u.click(card.getByRole("button", { name: "Open" }));
  await expect(page.locator('[data-line="1"]').first()).toBeVisible();                      // code is shown first
  await u.click(page.getByRole("tab", { name: "Validation" }));
  await expect(page.getByText("unit_tests").first()).toBeVisible();
  await u.click(page.getByRole("tab", { name: "Export" }));
  const href = await page.getByRole("link", { name: "Download project (ZIP)" }).getAttribute("href");
  expect((await request.get(href!)).status()).toBe(200);
  test.info().annotations.push({ type: "clicks: find agent → validation → export", description: String(u.clicks) });
  expect(u.clicks).toBeLessThanOrEqual(5);
});

test("returning user: finds an agent, understands its status, refines it, runs the evaluation again (real data)", async ({ page }) => {
  const u = counter(page);
  await page.goto("/#/agents");
  await page.getByLabel("Filter by status").selectOption("validated");
  const card = page.locator('[data-testid^="agent-"]').first();
  await expect(card.getByText("Validated · not verified")).toBeVisible();                   // plain status, not "validated"
  const slug = (await card.getAttribute("data-testid"))!.replace("agent-", "");
  await u.click(card.getByRole("button", { name: "Edit" }));
  await expect(page.getByLabel("Describe the agent you want")).toHaveValue(/Correction: $/);   // ready to refine, nothing sent yet
  await u.click(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Evaluations" }));
  const row = page.locator(`[data-testid^="eval-${slug}-"]`).first();
  await u.click(row.locator("summary"));
  await expect(row.getByText(/Unit tests|Evaluation cases|Static checks/).first()).toBeVisible();
  await u.click(row.getByRole("button", { name: "Run again" }));                             // real sandbox re-validation
  await expect(row.getByRole("button", { name: "Run again" })).toBeEnabled({ timeout: 120_000 });
  test.info().annotations.push({ type: "clicks: find → refine → re-evaluate", description: String(u.clicks) });
  expect(u.clicks).toBeLessThanOrEqual(5);
});
