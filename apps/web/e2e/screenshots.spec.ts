/**
 * Opt-in: presentation screenshots from REAL data only (no mocks). Studio states are real stored runs, restored into
 * the Studio the same way a page reload restores them.
 *   SCREENSHOTS=1 npx playwright test screenshots
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to refresh docs/evidence/screenshots/final-*.png");
const out = (name: string) => `../../docs/evidence/screenshots/final-${name}.png`;

/** The newest real run whose stored version has one of these statuses. */
async function realRun(request: APIRequestContext, statuses: string[]) {
  for (const j of await (await request.get("/api/studio/jobs")).json()) {
    if (!j.skill_version_id) continue;
    const v = await (await request.get(`/api/studio/versions/${j.skill_version_id}`)).json();
    if (statuses.includes(v.status)) return { jobId: j.id as string, prompt: j.prompt as string, status: v.status as string };
  }
  return null;
}

async function studioWith(page: Page, run: { jobId: string; prompt: string }) {
  await page.addInitScript((r) => {
    try { sessionStorage.setItem("aab.studio.requests", JSON.stringify([{ jobId: r.jobId, prompt: r.prompt, kind: "code" }])); } catch { /* about:blank */ }
  }, run);
  await page.goto("about:blank");          // a full load, so the Studio restores the run like after a reload
  await page.goto("/#/studio");
  await expect(page.getByTestId("studio-bot")).not.toHaveAttribute("data-state", "idle");
  await page.waitForLoadState("networkidle");
}

async function shot(page: Page, route: string, name: string) {
  await page.goto("about:blank");
  await page.goto(`/${route}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: out(name) });
}

test("desktop (1440px, English)", async ({ page, request, isMobile }) => {
  test.skip(isMobile, "desktop set");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [route, name] of [["#/overview", "overview"], ["#/agents", "my-agents"], ["#/evaluations", "evaluations"], ["#/studio", "studio-start"]]) await shot(page, route, name);
  await page.goto("/#/agents");
  await page.getByTestId("agent-api-test-planner").getByRole("button", { name: "Open" }).click();
  await expect(page.locator('[data-line="1"]').first()).toBeVisible();
  await page.screenshot({ path: out("code-workspace") });

  const success = await realRun(request, ["verified"]) ?? await realRun(request, ["validated"]);
  if (success) { await studioWith(page, success); await page.screenshot({ path: out(`studio-run-${success.status}`) }); }
  const failed = await realRun(request, ["validation_failed"]);
  if (failed) { await studioWith(page, failed); await page.getByRole("link", { name: "See what failed" }).scrollIntoViewIfNeeded(); await page.screenshot({ path: out("studio-run-failed") }); }
  test.info().annotations.push({ type: "runs", description: JSON.stringify({ success, failed }) });
});

test("mobile (Pixel 7, Japanese)", async ({ page, request, isMobile }) => {
  test.skip(!isMobile, "mobile set");
  await page.addInitScript(() => localStorage.setItem("aab.lang", "ja"));
  await shot(page, "#/overview", "mobile-ja-overview");
  const run = await realRun(request, ["verified", "validated"]);
  if (run) { await studioWith(page, run); await page.screenshot({ path: out("mobile-ja-studio") }); }
});
