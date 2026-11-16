/**
 * Visual tour of the demo build (MOCKED LLM) for UX review: every page, the creation flow, the result, the code and the
 * export, on desktop and mobile. On every screen it also asserts: no horizontal overflow, no console errors, no failed
 * requests. Run it explicitly:
 *   UX_SHOTS=after npx playwright test -c playwright.demo.config.ts ux-tour     → docs/evidence/screenshots/ux/after/
 */
import { expect, test, type Page } from "@playwright/test";
import { nav, pane } from "./panes";

const PHASE = process.env.UX_SHOTS;
test.skip(!PHASE, "set UX_SHOTS=<phase> to capture the UX tour screenshots");
const DIR = `../../docs/evidence/screenshots/ux/${PHASE}`;

async function shot(page: Page, name: string, project: string) {
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect.soft(overflow, `horizontal overflow on ${name}`).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${DIR}/${project}-${name}.png`, fullPage: true });
}

test("UX tour", async ({ page }, info) => {
  test.setTimeout(240_000);
  const p = info.project.name;
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto("/");
  await page.getByTestId("demo-banner").waitFor();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "Create your first Skill" })).toBeVisible();
  await expect(page.getByRole("region", { name: "How it works" })).toContainText("Export");
  await shot(page, "01-overview", p);
  await nav(page, "Agent Studio");
  await expect(page.getByRole("region", { name: "Tips for a good description" })).toBeVisible();
  await shot(page, "02-studio-empty", p);
  await page.getByLabel("Describe the agent you want").fill("Create an agent that finds inline arrow handlers in React files and counts them.");
  await page.getByRole("button", { name: "Create agent" }).click();
  await page.getByText(/Request received/).waitFor();
  await page.waitForTimeout(1200);
  await shot(page, "03-studio-running", p);
  await pane(page, "Result");
  await shot(page, "04-studio-running-result-pane", p);
  await pane(page, "Build");
  await page.getByText(/is verified|validated but not verified|failed validation/).first().waitFor({ timeout: 180_000 });
  await expect(page.getByTestId("run-line")).toHaveCount(0);  // the live line disappears once the job has finished
  await shot(page, "05-studio-done", p);
  await page.getByRole("button", { name: "Open the result" }).click();
  await pane(page, "Result");
  await expect(page.getByTestId("file-about")).not.toBeEmpty();
  await shot(page, "06-result-files", p);
  for (const tab of ["Flow", "Validation", "Export"]) {
    await page.getByRole("tab", { name: tab }).click();
    await shot(page, `07-result-${tab.toLowerCase()}`, p);
  }
  await expect(page.getByRole("region", { name: "What's in the ZIP" })).toContainText("SKILL.md");
  for (const [name, label] of [["08-my-agents", "My Agents"], ["09-code", "Code Workspace"], ["10-evaluations", "Evaluations"],
    ["11-integrations", "Integrations"], ["12-settings", "Settings"]] as const) {
    await nav(page, label);
    await page.waitForLoadState("networkidle");
    if (label === "My Agents") await expect(page.getByTestId("example-badge").first()).toBeVisible();
    await shot(page, name, p);
  }
  expect(problems).toEqual([]);
});
