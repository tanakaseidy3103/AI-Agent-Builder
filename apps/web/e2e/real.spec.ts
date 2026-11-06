/**
 * NO MOCKS: real Vite → FastAPI → Postgres, with Skills that went through the real Docker sandbox.
 * Requires: `docker compose up -d db`, the API on :8000 (started automatically if absent), Docker for seeding.
 */
import { expect, test, type Page } from "@playwright/test";

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

test("a verified reference Skill: criteria, sandbox evidence and a downloadable export", async ({ page, request }) => {
  const problems = watch(page);
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "API: ok" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Skills" }).click();
  await page.getByRole("button", { name: /api-test-planner/ }).click();
  await expect(page.getByText(/api-test-planner@1\.0\.0/)).toBeVisible();
  await page.getByRole("tab", { name: "Validation" }).click();
  await expect(page.getByText(/ran · \d+ ms · no network · 256 MB/)).toBeVisible();
  for (const id of ["static", "unit_tests", "eval_cases"]) {
    await expect(page.locator("li", { hasText: id }).getByText("pass", { exact: true }).first()).toBeVisible();
  }
  await page.getByRole("tab", { name: "Export" }).click();
  const href = await page.getByRole("link", { name: "Download ZIP" }).getAttribute("href");
  const zip = await request.get(href!);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toContain("application/zip");
  expect(problems).toEqual([]);
});

test("a generated Skill that failed validation cannot be exported (real data)", async ({ page, request }) => {
  const skills = await (await request.get("/api/studio/skills")).json();
  const failed = skills.find((s: { latest?: { status: string } }) => s.latest?.status === "validation_failed");
  test.skip(!failed, "no validation_failed Skill in this database");
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Skills" }).click();
  await page.getByRole("button", { name: new RegExp(failed.slug) }).click();
  await page.getByRole("tab", { name: "Validation" }).click();
  await expect(page.getByText("How to fix").first()).toBeVisible();
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(page.getByRole("alert")).toContainText("cannot be exported");
  const blocked = await request.get(`/api/studio/versions/${failed.latest.id}/export/claude-code`);
  expect(blocked.status()).toBe(409); // the server enforces it too, not only the UI
});

test("API keys: create shows the key once, revoke works", async ({ page }) => {
  const problems = watch(page);
  const name = `e2e-${Date.now()}`;
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "API keys" }).click();
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
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  const unnamed = await page.locator("button, a, textarea, select, input").evaluateAll((els) =>
    els.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e.id && document.querySelector(`label[for="${e.id}"]`)))).length);
  expect(unnamed).toBe(0);
});
