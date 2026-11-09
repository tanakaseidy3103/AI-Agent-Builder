/**
 * QA matrix. Viewports run on REAL data (no mocks); failure paths use mocked API responses because they cannot be
 * produced on demand against a healthy backend. Each test says which one it is.
 */
import { expect, test, type Page } from "@playwright/test";

const PAGES = ["#/overview", "#/studio", "#/agents", "#/code", "#/projects", "#/evaluations", "#/integrations", "#/settings"];
const WIDTHS = [1920, 1440, 768, 390, 360];

test.describe("viewports (real data)", () => {
  test.skip(({ isMobile }) => isMobile, "widths are set explicitly");
  for (const width of WIDTHS) {
    test(`${width}px: every page fits, nothing clipped, no console errors, touch targets >= 24px`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.setViewportSize({ width, height: width >= 1024 ? 900 : 800 });
      for (const route of PAGES) {
        await page.goto("about:blank");                                   // full load per page: a hash change alone does not reload
        await page.goto(`/${route}`);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expect(page.getByText(/^Loading/)).toHaveCount(0);        // measure the loaded page, not its loading state
        const report = await page.evaluate(() => {
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          const main = document.querySelector("main")!;
          const clipped = [...main.querySelectorAll<HTMLElement>("*")].filter((e) => {
            const cs = getComputedStyle(e);
            return !!e.offsetParent && !e.closest("pre, [role=tablist], .sr-only, table") && cs.overflowX !== "visible"
              && cs.textOverflow !== "ellipsis" && cs.webkitLineClamp === "none" && e.scrollWidth - e.clientWidth > 1;
          }).map((e) => `${e.tagName}.${String(e.className).slice(0, 50)}`);
          const small = [...document.querySelectorAll<HTMLElement>("button, select, input, [role=tab]")].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) && !e.closest(".sr-only") && (e as HTMLInputElement).type !== "checkbox";
          }).map((e) => `${e.tagName} "${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
          return { overflow, clipped, small };
        });
        expect(report.overflow, `${route} horizontal overflow`).toBeLessThanOrEqual(1);
        expect(report.clipped, `${route} clipped`).toEqual([]);
        expect(report.small, `${route} small targets`).toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  }
});

async function mockApi(page: Page, opts: { job?: "failed"; models?: "missing"; down?: boolean }) {
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const json = (b: unknown, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    if (opts.down) return route.fulfill({ status: 502, body: "" });
    if (p === "/health") return json({ status: "ok" });
    if (p === "/studio/models") return json(opts.models === "missing"
      ? { default: "qwen2.5-coder:latest", installed: ["llama3.2:3b"], error: null, runtime: [] }
      : { default: "m", installed: ["m"], error: null, runtime: [] });
    if (p === "/studio/skills/generate") return json({ id: "j", status: "draft", stages: [] }, 202);
    if (p === "/studio/jobs/j") return json({ id: "j", status: "failed", provider: "ollama:m", stage: null, skill_version_id: null,
      error: "Ollama timed out after 600s (qwen2.5-coder:latest)",
      stages: [{ name: "analyze", status: "passed" }, { name: "specify", status: "passed" }, { name: "plan", status: "passed" }, { name: "generate_files", status: "failed" }] });
    if (p === "/studio/events") return json([{ id: 1, agent_id: "coder", run_id: "j", state: "failed", message: "generation failed at generate_files: Ollama timed out after 600s", at: new Date().toISOString() }]);
    return json([]);
  });
}

test("mocked: a failed generation explains what happened and offers a retry", async ({ page }) => {
  await mockApi(page, { job: "failed" });
  await page.goto("/#/studio");
  await page.getByRole("button", { name: /^Laravel bug finder/ }).click();
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ollama timed out" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry this request/ })).toBeVisible();
  await expect(page.getByTestId("studio-bot")).toHaveAttribute("data-state", "failed");
  await expect(page.getByTestId("journey").locator('[data-step="create"]')).toHaveAttribute("data-state", "failed");
  await expect(page.getByRole("group", { name: "Use this agent" })).toHaveCount(0);   // nothing to export
});

test("mocked: a missing default model is explained with the exact fix (never downloaded automatically)", async ({ page }) => {
  await mockApi(page, { models: "missing" });
  await page.goto("/#/integrations");
  await expect(page.getByRole("alert").filter({ hasText: "is not installed" })).toContainText("ollama pull qwen2.5-coder:latest");
});

test("mocked: an unreachable API shows a plain message, not a raw 502", async ({ page }) => {
  await mockApi(page, { down: true });
  await page.goto("/#/studio");
  await page.getByLabel("Describe the agent you want").fill("An agent that finds TODO comments in source files");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The API is not reachable" }).first()).toBeVisible();
});

test("mocked: reloading during a run keeps the conversation (this tab)", async ({ page }) => {
  await mockApi(page, { job: "failed" });
  await page.goto("/#/studio");
  await page.getByLabel("Describe the agent you want").fill("An agent that survives a reload of the page");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText("An agent that survives a reload of the page")).toBeVisible();
  await page.reload();
  await expect(page.getByText("An agent that survives a reload of the page")).toBeVisible();
});

test("keyboard only: reach the navigation, open a page with Enter, focus is visible", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard journey on desktop layout");
  await page.goto("/#/overview");
  let found = false;
  for (let i = 0; i < 20 && !found; i++) {
    await page.keyboard.press("Tab");
    found = (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "Evaluations";
  }
  expect(found).toBe(true);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");                                                      // visible focus ring
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Evaluations", level: 1 })).toBeVisible();
});
