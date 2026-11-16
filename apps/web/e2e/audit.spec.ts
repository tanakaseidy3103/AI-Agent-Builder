/**
 * Engineering audit (2026-11): REAL frontend + FastAPI + Postgres + Docker-validated reference Skills. No mocks.
 * Covers what the older specs did not: direct URLs and reload on every route, three viewports with screenshots,
 * a sweep of every visible control for accessible names and dead clicks, the events WebSocket, and an export whose
 * ZIP is opened and compared file by file with the stored package.
 *   npx playwright test audit --project=desktop
 * Screenshots: docs/evidence/screenshots/audit/
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readZip } from "./zip";

test.skip(({ isMobile }) => isMobile, "viewports are set explicitly below");

const SHOTS = "../../docs/evidence/screenshots/audit";
const ROUTES = ["overview", "studio", "agents", "code", "projects", "evaluations", "integrations", "settings"] as const;
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } };

type Problem = string;
function watch(page: Page): Problem[] {
  const problems: Problem[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  return problems;
}

let refVersion = "";

test.beforeAll(async ({ request }) => {
  const seed = await request.post("/api/studio/reference/seed");
  expect(seed.ok()).toBeTruthy();
  const rows = (await seed.json()) as { slug: string; status: string; version_id: string }[];
  const ref = rows.find((r) => r.slug === "python-code-analyzer");
  expect(ref?.status).toBe("verified");
  refVersion = ref!.version_id;
});

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  test(`${vp}: every route by direct URL and after reload — renders, fits, no console errors or failed requests`, async ({ page }) => {
    await page.setViewportSize(size);
    const problems = watch(page);
    for (const route of ROUTES) {
      await page.goto(`/#/${route}`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).not.toBeEmpty();
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main"), `${route} after reload`).not.toBeEmpty();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${vp} ${route}: horizontal page scroll`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${SHOTS}/${vp}-${route}.png`, fullPage: true });
    }
    expect(problems).toEqual([]);
  });
}

test("deep links: every Code Workspace tab of a real verified Skill opens directly and survives reload", async ({ page }) => {
  const problems = watch(page);
  for (const tab of ["files", "validation", "manifest", "repairs", "export"]) {
    await page.goto("about:blank"); // a fresh document each time: a hash-only goto never reaches "networkidle"
    await page.goto(`/#/code/${refVersion}/${tab}`);
    await expect(page.getByText(/python-code-analyzer@1\.0\.0/).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("tab", { selected: true })).toBeVisible();
    test.info().annotations.push({ type: `tab ${tab}`, description: (await page.getByRole("tab", { selected: true }).first().textContent()) ?? "" });
  }
  expect(problems).toEqual([]);
});

test("unknown routes and unknown ids fail gracefully (no blank page, no crash)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#/does-not-exist");
  await expect(page.locator("main")).not.toBeEmpty();
  await page.goto("/#/code/0123456789abcdef0123456789abcdef/files");
  // the API's 404 message, promptly: before the fix the query retried the 404 three times with backoff ("Loading…")
  const t0 = Date.now();
  await expect(page.locator("main").getByText("skill version not found")).toBeVisible({ timeout: 5000 });
  test.info().annotations.push({ type: "404 shown after", description: `${Date.now() - t0} ms` });
  await page.screenshot({ path: `${SHOTS}/unknown-version.png`, fullPage: true });
  test.info().annotations.push({ type: "unknown version shows", description: (await page.locator("main").innerText()).slice(0, 300) });
  expect(errors).toEqual([]);
});

test("accessibility basics on every route: named controls, labelled fields, one main landmark, lang", async ({ page }) => {
  const report: string[] = [];
  for (const route of ROUTES) {
    await page.goto(`/#/${route}`);
    await page.waitForLoadState("networkidle");
    const issues = await page.evaluate(() => {
      // checkVisibility: content of a closed <details> keeps layout boxes in Chrome but is not rendered
      const visible = (e: Element) => e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
      const name = (e: Element) => (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") && document.getElementById(e.getAttribute("aria-labelledby")!)?.textContent
        || (e as HTMLElement).innerText || e.getAttribute("title") || "").trim();
      const out: string[] = [];
      document.querySelectorAll("button, a[href], [role=button], [role=tab]").forEach((e) => { if (visible(e) && !name(e)) out.push(`unnamed ${e.tagName.toLowerCase()} ${e.outerHTML.slice(0, 120)}`); });
      document.querySelectorAll("input:not([type=hidden]), select, textarea").forEach((e) => {
        const id = e.id; const lab = id && document.querySelector(`label[for="${id}"]`);
        if (visible(e) && !lab && !e.closest("label") && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby")) out.push(`unlabelled ${e.tagName.toLowerCase()} ${e.outerHTML.slice(0, 120)}`);
      });
      document.querySelectorAll("img, svg[role=img]").forEach((e) => { if (visible(e) && e.tagName === "IMG" && e.getAttribute("alt") === null) out.push(`img without alt ${e.outerHTML.slice(0, 100)}`); });
      if (document.querySelectorAll("main").length !== 1) out.push(`main landmarks: ${document.querySelectorAll("main").length}`);
      if (!document.querySelector("[lang]")) out.push("no lang attribute");
      if (!document.querySelector("h1")) out.push("no h1 heading");
      return out;
    });
    report.push(...issues.map((i) => `${route}: ${i}`));
  }
  test.info().annotations.push({ type: "a11y findings", description: report.join("\n") || "none" });
  expect(report).toEqual([]);
});

/** Every visible, non-destructive control should DO something when clicked: change the DOM, the URL, open a
 * dialog/download or send a request. A click with no observable effect is a dead or fake control. */
test("no dead controls: each visible button on each route has an observable effect", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const SKIP = /delete|remove|revoke|reject|download|create agent|propose plan|approve|run the tests again|validate|seed|install|apply|add to my project|copy/i;
  const dead: string[] = [];
  const tried: string[] = [];
  page.on("dialog", (d) => d.dismiss()); // confirm() prompts count as an effect and are always cancelled
  for (const route of ROUTES) {
    await page.goto(`/#/${route}`);
    await page.waitForLoadState("networkidle");
    const names = await page.locator("main button:visible").evaluateAll((els) =>
      // the option that is already pressed/selected/checked is expected to do nothing when clicked again
      els.map((e) => ((e.getAttribute("aria-label") || (e as HTMLElement).innerText || "").trim()) + "|" +
        ((e as HTMLButtonElement).disabled || ["aria-pressed", "aria-selected", "aria-checked"].some((a) => e.getAttribute(a) === "true") ? "skip" : "")));
    for (let i = 0; i < names.length; i++) {
      const [label, disabled] = names[i].split("|");
      if (disabled || SKIP.test(label)) continue;
      await page.goto(`/#/${route}`);
      await page.waitForLoadState("networkidle");
      const button = page.locator("main button:visible").nth(i);
      if (!(await button.count())) continue;
      const before = { url: page.url(), html: await page.locator("body").innerHTML() };
      let requests = 0, dialogs = 0, downloads = 0;
      const onReq = () => requests++; const onDlg = () => dialogs++; const onDl = () => downloads++;
      page.on("request", onReq); page.on("dialog", onDlg); page.on("download", onDl);
      await button.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
      page.off("request", onReq); page.off("dialog", onDlg); page.off("download", onDl);
      const changed = page.url() !== before.url || (await page.locator("body").innerHTML()) !== before.html;
      tried.push(`${route}: ${label}`);
      if (!changed && !requests && !dialogs && !downloads) dead.push(`${route}: "${label}"`);
    }
  }
  test.info().annotations.push({ type: "controls clicked", description: `${tried.length}\n${tried.join("\n")}` });
  expect(dead).toEqual([]);
});

test("export from the UI: the downloaded ZIP holds exactly the stored package, byte for byte", async ({ page, request }) => {
  await page.goto(`/#/code/${refVersion}/export`);
  const link = page.getByRole("link", { name: "Download project (ZIP)" });
  await expect(link).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  expect(download.suggestedFilename()).toBe("python-code-analyzer-1.0.0-claude-code.zip");
  const zip = readZip(readFileSync(path));
  const version = await (await request.get(`/api/studio/versions/${refVersion}`)).json() as { files: { path: string }[] };
  const expected = version.files.map((f) => `python-code-analyzer/${f.path}`).sort();
  expect([...zip.keys()].sort()).toEqual(expected);
  for (const f of version.files) {
    const stored = await (await request.get(`/api/studio/versions/${refVersion}/files/${f.path}`)).text();
    expect(zip.get(`python-code-analyzer/${f.path}`), f.path).toBe(stored);
  }
  expect(zip.get("python-code-analyzer/SKILL.md")).toMatch(/^---\nname: python-code-analyzer\n/);
  // the same export twice is identical (reproducible archives)
  const again = await request.get(`/api/studio/versions/${refVersion}/export/claude-code`);
  expect(Buffer.compare(await again.body(), readFileSync(path))).toBe(0);
  test.info().annotations.push({ type: "zip entries", description: [...zip.keys()].join(", ") });
});

test("events WebSocket: the Studio origin connects and receives persisted events; a foreign origin is refused", async ({ page, request }) => {
  await page.goto("/#/overview");
  const latest = await (await request.get("/api/studio/events?limit=500")).json() as { id: number }[];
  const result = await page.evaluate(async (after) => new Promise<{ opened: boolean; received: number; closeCode?: number }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:8000/studio/events/ws?after=${after}`);
    let received = 0, opened = false;
    ws.onopen = () => { opened = true; };
    ws.onmessage = () => { received++; };
    ws.onclose = (e) => resolve({ opened, received, closeCode: e.code });
    setTimeout(() => { ws.close(); resolve({ opened, received }); }, 2500);
  }), Math.max(0, (latest.at(-1)?.id ?? 0) - 5));
  expect(result.opened).toBe(true);
  expect(result.received).toBe(Math.min(5, latest.length)); // replays exactly the events after the cursor
  test.info().annotations.push({ type: "ws", description: JSON.stringify(result) });
  // the page above is http://localhost:5173 (allowed). A foreign origin is refused by the API (see test_api.py);
  // a browser cannot fake Origin, so this is checked with a raw handshake:
  const raw = await request.get("http://127.0.0.1:8000/studio/events/ws", {
    headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", Origin: "https://evil.example" },
  });
  expect(raw.status()).toBe(403);
});
