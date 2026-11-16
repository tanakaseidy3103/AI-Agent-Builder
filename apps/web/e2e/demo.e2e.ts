/**
 * PUBLIC DEMO build (VITE_DEMO_MODE=true) against the real demo backend with a MOCKED LLM (playwright.demo.config.ts).
 * Real: session creation, isolation, limits, CORS, the pipeline, the Docker sandbox, ZIP export, connection states.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { nav, pane } from "./panes";
import { readZip } from "./zip";

const BACKEND = `http://127.0.0.1:${process.env.DEMO_API_PORT ?? "8100"}`;
const FRONTEND = `http://127.0.0.1:${process.env.DEMO_WEB_PORT ?? "4173"}`;
const PROMPT = "Create an agent that finds inline arrow handlers in React files and counts them.";

function watch(page: Page, allow: RegExp[] = []) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !allow.some((a) => a.test(m.text()))) problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400 && !allow.some((a) => a.test(r.url()))) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  page.on("requestfailed", (r) => { if (!allow.some((a) => a.test(r.url()))) problems.push(`failed ${r.url()}`); });
  return problems;
}

test("first visit: demo banner, automatic anonymous session, admin features absent, no errors", async ({ page }) => {
  const problems = watch(page);
  const session = page.waitForResponse((r) => r.url() === `${BACKEND}/demo/session` && r.request().method() === "POST");
  await page.goto("/");
  expect((await session).status()).toBe(201);
  const banner = page.getByTestId("demo-banner");
  await expect(banner).toHaveAttribute("data-state", "ok");
  await expect(banner).toContainText("Public demo");
  // installing into a folder of the host machine is not offered, nor are API keys or plan review
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My Projects", exact: true })).toHaveCount(0);
  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await nav(page, "Settings");
  await expect(page.getByText("API keys (for /v1 and the SDK)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create key" })).toHaveCount(0);
  await nav(page, "Agent Studio");
  await page.locator("details", { hasText: "Advanced" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await expect(page.getByLabel("Review the plan before generating")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(problems).toEqual([]);
});

test("create a Skill (MOCKED LLM) → verified in the real sandbox → download ZIP; Export offers the ZIP only", async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await page.goto("/#/studio");
  await page.getByLabel("Describe the agent you want").fill(PROMPT);
  const [gen] = await Promise.all([
    page.waitForResponse((r) => r.url() === `${BACKEND}/demo/skills/generate`),
    page.getByRole("button", { name: "Create agent" }).click(),
  ]);
  expect(gen.status()).toBe(202);
  await expect(page.getByText(/is verified/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Open the result" }).click();
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(page.getByText("This ZIP contains AI-generated code")).toBeVisible();
  await expect(page.getByRole("region", { name: "Implement in my project" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Publish to GitHub/ })).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download project (ZIP)" }).click()]);
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const zip = readZip(readFileSync(path));
  expect([...zip.keys()].some((k) => k.endsWith("/SKILL.md"))).toBe(true);
  expect([...zip.keys()].some((k) => k.endsWith("/scripts/main.py"))).toBe(true);
  expect(problems).toEqual([]);
});

test("visitors are isolated: a second browser does not see the first visitor's Skill", async ({ page, browser }) => {
  test.setTimeout(240_000);
  // visitor A (this test's own browser context, so its own anonymous session) creates a Skill
  await page.goto("/#/studio");
  await page.getByLabel("Describe the agent you want").fill(PROMPT);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/is verified/)).toBeVisible({ timeout: 180_000 });
  await page.goto("/#/agents");
  await expect(page.getByTestId("agent-react-performance-analyzer")).toBeVisible();
  // visitor B: new storage = new anonymous session
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto("/#/agents");
  await expect(p2.getByTestId("demo-banner")).toHaveAttribute("data-state", "ok");
  await p2.waitForLoadState("networkidle");
  await expect(p2.getByTestId("agent-react-performance-analyzer")).toHaveCount(0);
  await other.close();
});

test("the admin and local APIs are unreachable from the browser through the demo backend", async ({ page }) => {
  await page.goto("/");
  const codes = await page.evaluate(async (base) => {
    const out: Record<string, number> = {};
    for (const p of ["/studio/skills", "/studio/api-keys", "/studio/audit", "/v1/skills", "/docs", "/openapi.json"]) {
      try { out[p] = (await fetch(base + p)).status; } catch { out[p] = -1; }  // -1 = blocked by CORS: also unreachable
    }
    return out;
  }, BACKEND);
  for (const [p, code] of Object.entries(codes)) expect([404, -1], p).toContain(code);
});

test("backend offline: the banner and the composer explain it instead of failing silently", async ({ page }) => {
  await page.route(`${BACKEND}/**`, (r) => r.abort("connectionrefused"));
  watch(page, [/./]);  // failures are the point of this test
  await page.goto("/#/studio");
  await expect(page.getByTestId("demo-banner")).toHaveAttribute("data-state", "offline", { timeout: 20_000 });
  await expect(page.getByTestId("demo-banner")).toContainText("Demo server offline");
  await page.getByLabel("Describe the agent you want").fill(PROMPT);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/may be offline/).first()).toBeVisible();
});

test("rate limit and quota answers are shown to the visitor as written by the server", async ({ page }) => {
  await page.route(`${BACKEND}/demo/skills/generate`, (r) => r.fulfill({
    status: 429, contentType: "application/json", headers: { "Access-Control-Allow-Origin": FRONTEND },
    body: JSON.stringify({ detail: "this demo session already used its 3 generations" }) }));
  await page.goto("/#/studio");
  await pane(page, "Build");
  await page.getByLabel("Describe the agent you want").fill(PROMPT);
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText("this demo session already used its 3 generations")).toBeVisible();
});
