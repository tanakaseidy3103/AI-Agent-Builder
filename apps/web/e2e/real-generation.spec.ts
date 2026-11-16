/**
 * Opt-in, slow (minutes): a REAL generation through the UI with the configured Ollama model and the Docker sandbox.
 *   RUN_REAL_GENERATION=1 npx playwright test real-generation --project=desktop
 * It asserts that the pipeline ran and reported honestly — NOT that the model succeeded (it often does not) —
 * and that the Agent Office only shows what the backend reports: one agent at a time, real handoffs.
 */
import { advanced } from "./panes";
import { expect, test } from "@playwright/test";

test.skip(!process.env.RUN_REAL_GENERATION, "set RUN_REAL_GENERATION=1 to run a real, multi-minute generation");
test.setTimeout(15 * 60_000);
const shot = (n: string) => `../../docs/evidence/screenshots/office-${n}.png`;

test("real generation drives the Agent Office from persisted events and ends with an honest status", async ({ page }) => {
  await page.goto("/#/studio");
  await page.getByRole("button", { name: /^Python code review/ }).click();
  await advanced(page);
  await page.getByLabel("Agent type").selectOption("code");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText(/Request received/)).toBeVisible();
  // the planner must move only because the backend emitted an event
  await expect(page.getByTestId("role-architect")).not.toHaveAttribute("data-state", "waiting", { timeout: 120_000 });

  const outcome = page.getByText(/is verified|is validated but not verified|failed validation/);
  const seen = new Set<string>();
  const botStates = new Set<string>();
  const bot = page.getByTestId("studio-bot");
  let maxWorking = 0, midShot = false;
  while (!(await outcome.isVisible())) {
    const working = await page.locator('[data-testid^="role-"][data-state="working"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    maxWorking = Math.max(maxWorking, working.length);
    botStates.add((await bot.getAttribute("data-state")) ?? "");
    working.forEach((w) => seen.add(w!));
    if (!midShot && working.length === 1 && seen.size >= 2) { await page.screenshot({ path: shot("live") }); midShot = true; }
    await page.waitForTimeout(500);
  }
  expect(maxWorking).toBeLessThanOrEqual(1);   // a sequential pipeline never shows two agents working at once
  expect(seen.size).toBeGreaterThanOrEqual(3); // real handoffs were observed live

  // the "Live activity" list this used to read is no longer rendered (ActivityStream is unused since the Studio's
  // right pane became Planner | Agent result); the order is checked on the persisted events the Office is drawn from
  const jobs = await (await page.request.get("/api/studio/jobs")).json() as { id: string; prompt: string }[];
  const events = await (await page.request.get(`/api/studio/events?run_id=${jobs[0].id}&limit=500`)).json() as { agent_id: string }[];
  const roles = events.map((e) => e.agent_id).filter((r, i, a) => r !== a[i - 1]); // one entry per turn
  expect(roles[0]).toBe("architect");
  expect(roles.at(-1)).toBe("packager");
  await page.screenshot({ path: shot("finished") });
  // while running the robot only showed states that map to real stages; at the end it matches the stored outcome
  for (const s of botStates) expect(["idle", "analyzing", "planning", "generating", "reviewing", "testing"]).toContain(s);
  const text = (await outcome.textContent()) ?? "";
  await expect(bot).toHaveAttribute("data-state", /failed validation/.test(text) ? "failed" : "completed");
  test.info().annotations.push({ type: "outcome", description: (await outcome.textContent()) ?? "" },
    { type: "working-roles-seen", description: [...seen].join(", ") }, { type: "robot-states", description: [...botStates].join(", ") }, { type: "turns", description: roles.join(" → ") });
});
