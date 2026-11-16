/**
 * Engineering audit (2026-11): the complete user flow with the REAL local Ollama model and the REAL Docker sandbox.
 *   RUN_REAL_GENERATION=1 npx playwright test audit-real-flow --project=desktop
 * prompt → generation → static validation → unit tests → evaluation → status → export → exported files on disk.
 * It asserts that every step really ran and that the UI reports exactly what the API stored. It does NOT require the
 * model to succeed (with 7B local models it usually does not reach `verified`); the outcome is recorded either way.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { advanced } from "./panes";
import { readZip } from "./zip";

test.skip(!process.env.RUN_REAL_GENERATION, "set RUN_REAL_GENERATION=1 to run a real, multi-minute generation");
test.skip(({ isMobile }) => isMobile, "desktop flow");
test.setTimeout(40 * 60_000);

const SHOTS = "../../docs/evidence/screenshots/audit";
const OUTCOME = /is verified|is validated but not verified|failed validation/;
type Job = { id: string; status: string; stage: string | null; stages: { name: string; status: string; detail?: string }[]; skill_version_id: string | null; error: string | null };

test("real prompt → pipeline → sandbox → status → export, UI consistent with the API at every step", async ({ page, request }) => {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

  // events WebSocket opened BEFORE the run: it must deliver the same events the REST endpoint persists
  await page.goto("/#/studio");
  const startCursor = ((await (await request.get("/api/studio/events?limit=500")).json()) as { id: number }[]).at(-1)?.id ?? 0;
  await page.evaluate((after) => {
    const w = window as unknown as { __ws: unknown[] };
    w.__ws = [];
    const ws = new WebSocket(`ws://127.0.0.1:8000/studio/events/ws?after=${after}`);
    ws.onmessage = (m) => w.__ws.push(JSON.parse(m.data));
  }, startCursor);

  await page.getByLabel("Describe the agent you want").fill(
    "Create an agent that finds TODO and FIXME comments in source files and reports file, line and the comment text.");
  await advanced(page);
  await page.getByLabel("Agent type").selectOption("code");
  const [gen] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/studio/skills/generate") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Create agent" }).click(),
  ]);
  expect(gen.status()).toBe(202);
  const jobId = ((await gen.json()) as Job).id;
  await expect(page.getByText(/Request received/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/flow-1-submitted.png`, fullPage: true });

  // while running: the office must only show what the API's job reports
  const uiVsApi: string[] = [];
  let shotMid = false;
  const t0 = Date.now();
  while (!(await page.getByText(OUTCOME).isVisible())) {
    const job = (await (await request.get(`/api/studio/jobs/${jobId}`)).json()) as Job;
    if (job.status === "failed") break;
    const working = await page.locator('[data-testid^="role-"][data-state="working"]').count();
    if (working > 1) uiVsApi.push(`${Math.round((Date.now() - t0) / 1000)}s: ${working} roles shown working at once`);
    if (!shotMid && job.stage === "sandbox_tests") { await page.screenshot({ path: `${SHOTS}/flow-2-sandbox-running.png`, fullPage: true }); shotMid = true; }
    await page.waitForTimeout(1000);
  }
  const job = (await (await request.get(`/api/studio/jobs/${jobId}`)).json()) as Job;
  test.info().annotations.push({ type: "duration", description: `${Math.round((Date.now() - t0) / 1000)} s` },
    { type: "job", description: `${job.status}; ${job.stages.map((s) => `${s.name}=${s.status}`).join(", ")}` });
  await page.screenshot({ path: `${SHOTS}/flow-3-finished.png`, fullPage: true });
  expect(uiVsApi).toEqual([]);

  if (job.status === "failed") {
    // an honest LLM/infrastructure failure must be shown, with the stage it happened in
    await expect(page.getByText(new RegExp(job.stages.find((s) => s.status === "failed")?.name ?? "failed")).first()).toBeVisible();
    test.info().annotations.push({ type: "outcome", description: `job failed: ${job.error}` });
    return;
  }
  expect(job.status).toBe("completed");
  for (const s of ["analyze", "specify", "plan", "generate_files", "test_generation", "static_validation", "report", "package"]) {
    expect(job.stages.find((x) => x.name === s)?.status, s).toBe("passed");
  }

  const version = (await (await request.get(`/api/studio/versions/${job.skill_version_id}`)).json()) as {
    status: string; slug: string; version: string; files: { path: string }[];
    validation: { report: { static: { failed: number }; summary: { tests_total: number; tests_passed: number; evals_total: number; evals_passed: number }; sandbox: { status: string } } };
  };
  const rep = version.validation.report;
  const outcomeText = (await page.getByText(OUTCOME).textContent()) ?? "";
  test.info().annotations.push({ type: "outcome", description: outcomeText },
    { type: "report", description: JSON.stringify({ status: version.status, static_failed: rep.static.failed, ...rep.summary, sandbox: rep.sandbox.status }) });
  // the UI sentence matches the stored status, never a better one
  expect(outcomeText).toMatch({ verified: /is verified/, validated: /validated but not verified/, validation_failed: /failed validation/ }[version.status]!);
  if (version.status !== "validation_failed") {
    expect(rep.sandbox.status).toBe("ran");                       // the Docker sandbox really executed tests and evals
    expect(rep.summary.tests_total).toBeGreaterThanOrEqual(3);
    expect(rep.summary.evals_total).toBeGreaterThanOrEqual(2);
  }

  // events: WebSocket delivered exactly what REST persisted for this run, starting with the architect
  const rest = (await (await request.get(`/api/studio/events?run_id=${jobId}&limit=500`)).json()) as { id: number }[];
  const ws = (await page.evaluate(() => (window as unknown as { __ws: { id: number; run_id: string }[] }).__ws)).filter((e) => e.run_id === jobId);
  expect(ws.map((e) => e.id)).toEqual(rest.map((e) => e.id));
  expect(rest.length).toBeGreaterThan(10);

  // result workspace: validation evidence as stored
  await page.getByRole("button", { name: "Open the result" }).last().click();
  await page.getByRole("tab", { name: "Validation" }).click();
  await page.screenshot({ path: `${SHOTS}/flow-4-validation.png`, fullPage: true });

  // reload in the middle of the result: same version, same status
  await page.reload();
  await expect(page.getByText(new RegExp(`${version.slug}@${version.version.replace(/\./g, "\\.")}`)).first()).toBeVisible();

  await page.getByRole("tab", { name: "Export" }).click();
  await page.screenshot({ path: `${SHOTS}/flow-5-export.png`, fullPage: true });
  if (version.status === "validation_failed") {
    await expect(page.getByRole("alert").filter({ hasText: "cannot be exported" })).toBeVisible();
    expect((await request.get(`/api/studio/versions/${job.skill_version_id}/export/claude-code`)).status()).toBe(409);
  } else {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download project (ZIP)" }).click()]);
    const path = test.info().outputPath(download.suggestedFilename());
    await download.saveAs(path);
    const zip = readZip(readFileSync(path));
    expect([...zip.keys()].sort()).toEqual(version.files.map((f) => `${version.slug}/${f.path}`).sort());
    for (const f of version.files) {
      const stored = await (await request.get(`/api/studio/versions/${job.skill_version_id}/files/${f.path}`)).text();
      expect(zip.get(`${version.slug}/${f.path}`), f.path).toBe(stored);
    }
    for (const required of ["SKILL.md", "manifest.json", "scripts/main.py", "tests/test_main.py", "evals/cases.json"]) {
      expect(zip.has(`${version.slug}/${required}`), required).toBe(true);
    }
    test.info().annotations.push({ type: "export", description: `${download.suggestedFilename()}: ${[...zip.keys()].join(", ")}` });
  }
  expect(problems).toEqual([]);
});
