/**
 * NO MOCKS: real Vite → FastAPI → Postgres, with Skills that went through the real Docker sandbox.
 * Requires: `docker compose up -d db`, the API on :8000 (started automatically if absent), Docker for seeding.
 */
import { expect, test, type Page } from "@playwright/test";
import { nav } from "./panes";

test.beforeAll(async ({ request }) => {
  // idempotent: imports the human-written reference Skills and validates them in the sandbox once
  const seed = await request.post("/api/studio/reference/seed");
  expect(seed.ok()).toBeTruthy();
});

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) problems.push(`${r.status()} ${r.url()}`); });
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
  return problems;
}

const PAGES = ["Overview", "Agent Studio", "My Agents", "Code Workspace", "My Projects", "Evaluations", "Integrations", "Settings"];

test("every page loads real data with no failed requests or console errors", async ({ page }) => {
  const problems = watch(page);
  let skillCalls = 0;
  page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/studio/skills") skillCalls++; });
  await page.goto("/");
  for (const name of PAGES) {
    await nav(page, name);
    await expect(page.locator("main")).not.toBeEmpty();
    await page.waitForLoadState("networkidle");
    // nothing may be wider than its scroll container (code blocks and tab strips scroll by design)
    const clipped = await page.locator("main").evaluate((m) => [...m.querySelectorAll<HTMLElement>("*")]
      .filter((e) => { const cs = getComputedStyle(e); return !!e.offsetParent && !e.closest("pre, [role=tablist], .sr-only") && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis" && cs.webkitLineClamp === "none" && e.scrollWidth - e.clientWidth > 1; })
      .map((e) => `${e.tagName}.${e.className.toString().slice(0, 60)}`));
    expect(clipped, name).toEqual([]);
  }
  expect(problems).toEqual([]);
  expect(skillCalls).toBeLessThanOrEqual(1); // shared 30 s cache: moving between pages does not refetch the agent list
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("a verified reference Skill: criteria, sandbox evidence and a downloadable export", async ({ page, request }) => {
  const problems = watch(page);
  await page.goto("/#/agents");
  const card = page.getByTestId("agent-api-test-planner");
  await expect(card.getByRole("listitem").last()).toHaveAttribute("data-reached", "true"); // verified, from /studio/evaluations
  await card.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText(/api-test-planner@1\.0\.0/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Validation" }).click();
  await expect(page.getByText(/ran · \d+ ms · no network · 256 MB/)).toBeVisible();
  for (const id of ["static", "unit_tests", "eval_cases"]) {
    await expect(page.locator("li", { hasText: id }).getByText("pass", { exact: true }).first()).toBeVisible();
  }
  await page.getByRole("tab", { name: "Export" }).click();
  const href = await page.getByRole("link", { name: "Download project (ZIP)" }).getAttribute("href");
  const zip = await request.get(href!);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toContain("application/zip");
  expect(problems).toEqual([]);
});

test("a generated Skill that failed validation cannot be exported (real data)", async ({ page, request }) => {
  const skills = await (await request.get("/api/studio/skills")).json();
  const failed = skills.find((s: { latest?: { status: string } }) => s.latest?.status === "validation_failed");
  test.skip(!failed, "no validation_failed Skill in this database");
  await page.goto("/#/agents");
  const card = page.getByTestId(`agent-${failed.slug}`);
  await expect(card.getByRole("button", { name: "Export" })).toBeDisabled();
  await card.getByRole("button", { name: "Open" }).click();
  await page.getByRole("tab", { name: "Validation" }).click();
  await expect(page.getByText("How to fix").first()).toBeVisible();
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "cannot be exported" })).toBeVisible();
  const blocked = await request.get(`/api/studio/versions/${failed.latest.id}/export/claude-code`);
  expect(blocked.status()).toBe(409); // the server enforces it too, not only the UI
});

test("API keys: create shows the key once, revoke works", async ({ page }) => {
  const problems = watch(page);
  const name = `e2e-${Date.now()}`;
  await page.goto("/");
  await nav(page, "Settings");
  await page.getByLabel("key name").fill(name);
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText(/Shown once/)).toBeVisible();
  await expect(page.locator("pre", { hasText: /^aab_/ })).toBeVisible();
  const row = page.locator("li", { hasText: name });
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row.getByText("revoked")).toBeVisible();
  expect(problems).toEqual([]);
});

test("accessibility basics: landmarks, language, named controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("main")).toBeVisible();
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) {
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
  }
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "API: ok" })).toBeVisible();
  const unnamed = await page.locator("button, a, textarea, select, input").evaluateAll((els) =>
    els.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest("label")?.textContent?.trim())).length);
  expect(unnamed).toBe(0);
});
