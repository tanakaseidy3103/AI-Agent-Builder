/**
 * Opt-in, slow: the full user workflow through the Agent Studio with the REAL configured Ollama model and sandbox.
 *   RUN_REAL_GENERATION=1 npx playwright test real-workflow --project=desktop
 * Three requests of increasing complexity, then a user correction ("Refine") that creates a new version.
 * Assertions check that every step happened and was reported honestly; they do NOT require the model to succeed.
 */
import { advanced } from "./panes";
import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.RUN_REAL_GENERATION, "set RUN_REAL_GENERATION=1 to run real, multi-minute generations");
test.describe.configure({ mode: "serial" });
test.setTimeout(20 * 60_000);

const OUTCOME = /is verified|is validated but not verified|failed validation/;
const CASES = [
  { id: "1-easy-todo", prompt: "Create an agent that finds TODO and FIXME comments in source files and reports file, line and the comment text." },
  { id: "2-medium-python", prompt: "Create an agent that analyzes Python source files and reports bare except clauses and mutable default arguments, each with file, line and rule name." },
  { id: "3-hard-laravel", prompt: "Create an agent that reviews Laravel PHP files and reports SQL built from variables in DB::select, leftover dd() calls and env() used outside config/, each with file and line." },
];

async function create(page: Page, prompt: string) {
  await page.getByLabel("Describe the agent you want").fill(prompt);
  await advanced(page);
  await page.getByLabel("Agent type").selectOption("code");
  await page.getByRole("button", { name: "Create agent" }).click();
}

async function inspect(page: Page, id: string) {
  const outcome = page.getByText(OUTCOME).last();
  await expect(outcome).toBeVisible({ timeout: 15 * 60_000 });
  const text = (await outcome.textContent()) ?? "";
  await page.getByRole("button", { name: "Open the result" }).last().click();
  await expect(page.getByLabel("Evidence")).toBeVisible();                       // evidence ladder from the stored report
  await page.getByRole("tab", { name: "Validation" }).click();
  await expect(page.getByText(/Verification criteria|did not run/).first()).toBeVisible();
  await page.screenshot({ path: `../../docs/evidence/screenshots/workflow-${id}.png`, fullPage: true });
  await page.getByRole("tab", { name: "Export" }).click();
  if (/failed validation/.test(text)) {
    await expect(page.getByRole("alert").filter({ hasText: "cannot be exported" })).toBeVisible();    // a failed Skill is never offered
  } else {
    const href = await page.getByRole("link", { name: "Download project (ZIP)" }).getAttribute("href");
    const zip = await page.request.get(href!);
    expect(zip.status()).toBe(200);                                              // real export of the stored package
  }
  test.info().annotations.push({ type: id, description: text });
  return text;
}

test("three real requests and a user correction, end to end", async ({ page }) => {
  await page.goto("/#/studio");
  for (const c of CASES) {
    await create(page, c.prompt);
    await expect(page.getByTestId("role-architect")).not.toHaveAttribute("data-state", "waiting", { timeout: 120_000 });
    await inspect(page, c.id);
    await page.getByRole("button", { name: "New agent" }).click();
  }
  // user correction on the last request -> a NEW version, old ones preserved
  await page.goto("/#/studio");
  await create(page, CASES[2].prompt);
  await expect(page.getByText(OUTCOME).last()).toBeVisible({ timeout: 15 * 60_000 });
  await page.getByRole("button", { name: "Refine (add a correction)" }).click();
  const box = page.getByLabel("Describe the agent you want");
  await box.press("End");
  await box.pressSequentially("report each finding as {file, line} only, and count findings per file.");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(OUTCOME)).toHaveCount(2, { timeout: 15 * 60_000 }); // the refined request's own outcome, not the first one
  await inspect(page, "4-refined-laravel");
  const versions = await page.getByRole("combobox", { name: "version" }).locator("option").count();
  expect(versions).toBeGreaterThanOrEqual(2);                                     // the correction did not overwrite
});
