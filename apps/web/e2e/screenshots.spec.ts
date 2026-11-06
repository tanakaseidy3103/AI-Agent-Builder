/**
 * Opt-in: documentation screenshots of the workspace, from REAL data (no mocks).
 *   SCREENSHOTS=1 npx playwright test screenshots
 */
import { expect, test } from "@playwright/test";
import { pane } from "./panes";

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to refresh docs/evidence/screenshots/redesign-*.png");
const out = (name: string) => `../../docs/evidence/screenshots/redesign-${name}.png`;

test("workspace screenshots", async ({ page, request }, info) => {
  const mobile = info.project.name === "mobile";
  if (mobile) await page.addInitScript(() => localStorage.setItem("aab.lang", "ja"));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: out(mobile ? "mobile-ja-start" : "desktop-en-start") });

  await pane(page, mobile ? "Skill" : "Skills");
  await page.getByRole("region", { name: mobile ? "Skill" : "Skills" }).getByRole("button", { name: /api-test-planner/ }).click();
  await expect(page.getByLabel(mobile ? "検証の到達度" : "Evidence")).toBeVisible();
  await page.getByRole("tab", { name: mobile ? "検証" : "Validation" }).click();
  await page.screenshot({ path: out(mobile ? "mobile-ja-result" : "desktop-en-verified") });
  if (mobile) return;

  await page.getByRole("tab", { name: "Files" }).click();
  await page.screenshot({ path: out("desktop-en-files") });
  const skills = await (await request.get("/api/studio/skills")).json();
  const failed = skills.find((s: { latest?: { status: string } }) => s.latest?.status === "validation_failed");
  if (failed) {
    await page.getByRole("region", { name: "Skills" }).getByRole("button", { name: new RegExp(failed.slug) }).click();
    await page.getByRole("tab", { name: "Validation" }).click();
    await page.screenshot({ path: out("desktop-en-failed") });
  }
});
