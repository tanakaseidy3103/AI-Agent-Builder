/**
 * Skill Flow in the PUBLIC DEMO build (VITE_DEMO_MODE=true) against the real demo backend (app.demo) with a MOCKED LLM
 * (playwright.demo.config.ts). Real: the demo session, the /demo/* routes, the Docker sandbox and the stored reports.
 * The generated Skill's code comes from the mocked LLM, so this checks the UI, not generation quality.
 */
import { expect, test, type Page } from "@playwright/test";
import { nav, pane } from "./panes";

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on("requestfailed", (r) => problems.push(`failed ${r.url()}`));
  return problems;
}
const node = (page: Page, id: string) => page.locator(`button[data-node="${id}"]`);

test("an example Skill: My Agents → Open → Flow, details and the link back to its code", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/");
  await expect(page.getByTestId("demo-banner")).toHaveAttribute("data-state", "ok");
  await nav(page, "My Agents");
  await page.getByTestId("agent-react-accessibility-analyzer").getByRole("button", { name: "Open" }).click();
  await page.getByRole("tab", { name: "Flow" }).click();
  await expect(page.getByTestId("skill-flow")).toBeVisible();
  await expect(node(page, "execution")).toHaveAttribute("data-state", "passed");
  await expect(page.locator("[data-testid=sf-edges] path[data-edge]").first()).toBeAttached();
  await node(page, "fn:_has").click();
  const detail = page.getByTestId("sf-detail");
  await expect(detail.locator("[data-focus]")).toHaveCount(2);
  await detail.getByRole("link", { name: "Open in Code Workspace" }).click();
  await expect(page).toHaveURL(/#\/code\/[^/]+\/files\/scripts%2Fmain\.py\/8-9$/);
  await expect(page.getByLabel("file preview").locator('[data-line="8"]')).toContainText("def _has(attrs, *names):");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(problems).toEqual([]);
});

test("a Skill generated in the Studio (MOCKED LLM, real sandbox): the result pane has the Flow tab", async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await page.goto("/#/studio");
  await page.getByLabel("Describe the agent you want").fill("Create an agent that finds inline arrow handlers in React files and counts them.");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/is verified|validated but not verified|failed validation/).first()).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Open the result" }).click();
  await pane(page, "Result");
  await page.getByRole("tab", { name: "Flow" }).click();
  await expect(page.getByTestId("skill-flow")).toBeVisible();
  // states come from this run's stored report; the mocked Skill is verified, so its eval cases ran in the sandbox
  await expect(node(page, "execution")).toHaveAttribute("data-source", "executed");
  await expect(node(page, "evaluation")).toHaveAttribute("data-state", "passed");
  await node(page, "evaluation").click();
  await expect(page.getByTestId("sf-detail").locator("[data-result]").first()).toHaveAttribute("data-status", "pass");
  await node(page, "execution").click();
  await page.getByTestId("sf-detail").getByRole("link", { name: "Open in Code Workspace" }).click();
  await expect(page).toHaveURL(/#\/code\/[^/]+\/files\/scripts%2Fmain\.py$/);
  await expect(page.getByRole("tab", { name: /^Files/ })).toHaveAttribute("aria-selected", "true");
  expect(problems).toEqual([]);
});
