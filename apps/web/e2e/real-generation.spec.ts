/**
 * Opt-in, slow (minutes): a REAL generation through the UI with the configured Ollama model and the Docker sandbox.
 *   RUN_REAL_GENERATION=1 npx playwright test real-generation --project=desktop
 * It asserts that the pipeline ran and reported honestly — NOT that the model succeeded (it often does not).
 */
import { expect, test } from "@playwright/test";

test.skip(!process.env.RUN_REAL_GENERATION, "set RUN_REAL_GENERATION=1 to run a real, multi-minute generation");
test.setTimeout(15 * 60_000);

test("real generation drives the Agent Office from persisted events and ends with an honest status", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Python code review/ }).click();
  await page.getByLabel("Skill type").selectOption("code");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/Request received/)).toBeVisible();
  // the planner must move only because the backend emitted an event
  await expect(page.getByTestId("role-architect")).not.toHaveAttribute("data-state", "pending", { timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Open the result" })).toBeVisible({ timeout: 14 * 60_000 });
  const outcome = page.getByText(/is verified|is validated but not verified|failed validation/);
  await expect(outcome).toBeVisible();
  await page.screenshot({ path: "test-results/real-generation-outcome.png", fullPage: true });
  test.info().annotations.push({ type: "outcome", description: (await outcome.textContent()) ?? "" });
});
