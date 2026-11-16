/**
 * MOCKED LLM end-to-end audit — no Ollama, no real model calls.
 * The API must be the mocked-LLM server (isolated SQLite + storage under <repo>/test-results/e2e-mock/):
 *   apps/api> .venv/Scripts/python.exe scripts/e2e_mock_server.py
 *   apps/web> npx playwright test mock-workflow --project=desktop
 * Real: browser, Vite, FastAPI, the 10-stage pipeline, static validation, Docker sandbox, packaging, ZIP export,
 * project install, and running the installed Skill with Python in a separate project. Mocked: only the model's replies
 * (ScriptedProvider, shown everywhere as "fake:scripted (MOCKED LLM)").
 * Evidence: <repo>/test-results/screenshots/, <repo>/test-results/export/, <repo>/test-results/external-project/
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { advanced, openFile } from "./panes";
import { readZip } from "./zip";

const ROOT = resolve(process.cwd(), "../..");
const OUT = join(ROOT, "test-results");
const SHOTS = join(OUT, "screenshots");
const EXPORT = join(OUT, "export");
const PROJECT = join(OUT, "external-project");
const PYTHON = join(ROOT, "apps", "api", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const PROMPT = "Create a Python Skill that analyzes Python source files, identifies potential bugs, and produces useful improvement suggestions.";
const ROUTES = ["overview", "studio", "agents", "code", "projects", "evaluations", "integrations", "settings"] as const;
const VIEWPORTS = { "1920x1080": { width: 1920, height: 1080 }, "1366x768": { width: 1366, height: 768 },
  "768x1024": { width: 768, height: 1024 }, "390x844": { width: 390, height: 844 } };
const STAGES = ["analyze", "specify", "plan", "generate_files", "static_validation", "test_generation", "sandbox_tests", "evaluate", "report", "package"];

type Stage = { name: string; status: string; detail?: string };
type Job = { id: string; status: string; stage: string | null; stages: Stage[]; provider: string; skill_version_id: string | null; error: string | null };
type Version = { id: string; slug: string; version: string; status: string; files: { path: string; size: number }[];
  validation: { report: { model: string; static: { passed: number; failed: number }; summary: Record<string, number>; sandbox: { status: string }; criteria: { id: string; passed: boolean }[] } } };

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "viewports are set explicitly");

const state: { job?: Job; version?: Version; files?: Map<string, string> } = {};

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on("requestfailed", (r) => problems.push(`requestfailed ${r.url()}: ${r.failure()?.errorText}`));
  return problems;
}

async function visualPass(page: Page, label: string) {
  const problems = watch(page);
  const notes: string[] = [];
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(size);
    for (const route of ROUTES) {
      await page.goto("about:blank");
      await page.goto(`/#/${route}`);
      await expect(page.locator("main")).not.toBeEmpty();
      await page.waitForTimeout(600); // let queries settle; nothing here polls when no job is live
      const m = await page.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        smallTargets: [...document.querySelectorAll<HTMLElement>("main button, main a[href], main select, main input")]
          .filter((e) => e.checkVisibility()).filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 24 || r.width < 24); })
          .map((e) => (e.getAttribute("aria-label") || e.innerText || e.tagName).trim().slice(0, 30)),
        h1: [...document.querySelectorAll("h1")].filter((h) => h.checkVisibility()).length, // the Studio stays mounted but hidden
      }));
      if (m.overflowX > 1) notes.push(`${vp} ${route}: page scrolls horizontally by ${m.overflowX}px`);
      if (m.smallTargets.length) notes.push(`${vp} ${route}: ${m.smallTargets.length} targets < 24px (${m.smallTargets.slice(0, 4).join(", ")})`);
      if (m.h1 !== 1) notes.push(`${vp} ${route}: ${m.h1} h1 headings`);
      await page.screenshot({ path: join(SHOTS, `${label}-${vp}-${route}.png`), fullPage: true });
    }
  }
  test.info().annotations.push({ type: `${label}: layout notes`, description: notes.join("\n") || "none" },
    { type: `${label}: console/network`, description: problems.join("\n") || "none" });
  expect(notes.filter((n) => n.includes("horizontally"))).toEqual([]);
  expect(problems).toEqual([]);
}

test.beforeAll(async ({ request }) => {
  const models = await (await request.get("/api/studio/models")).json() as { default: string };
  test.skip(models.default !== "fake:scripted", "the API on :8000 is not the mocked-LLM server (scripts/e2e_mock_server.py)");
  mkdirSync(SHOTS, { recursive: true });
});

test("1 · visual audit with no data: 8 routes × 4 viewports (empty states)", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await visualPass(page, "empty");
});

test("2 · MOCKED LLM: prompt → job → 10 real pipeline stages → verified Skill, shown in the UI", async ({ page, request }) => {
  test.setTimeout(5 * 60_000);
  await page.setViewportSize(VIEWPORTS["1366x768"]);
  const problems = watch(page);
  await page.goto("/#/studio");
  await page.getByLabel("Describe the agent you want").fill(PROMPT);
  await advanced(page);
  await page.getByLabel("Agent type").selectOption("code");
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/studio/skills/generate") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Create agent" }).click(),
  ]);
  expect(res.status()).toBe(202);                                                   // a job was created
  const jobId = ((await res.json()) as Job).id;
  await expect(page.getByText(/Request received/)).toBeVisible();
  await expect(page.getByText("fake:scripted (MOCKED LLM)").first()).toBeVisible(); // the UI says which model built it

  // observe real stage transitions from the API while the UI runs
  const seen: string[] = [];
  let maxWorking = 0;
  for (let i = 0; i < 240; i++) {
    const job = (await (await request.get(`/api/studio/jobs/${jobId}`)).json()) as Job;
    for (const s of job.stages) if (s.status !== "pending" && !seen.includes(s.name)) seen.push(s.name);
    maxWorking = Math.max(maxWorking, await page.locator('[data-testid^="role-"][data-state="working"]').count());
    if (job.status === "completed" || job.status === "failed") { state.job = job; break; }
    await page.waitForTimeout(500);
  }
  const job = state.job!;
  expect(job.status, job.error ?? "").toBe("completed");
  expect(job.provider).toBe("fake:scripted (MOCKED LLM)");
  for (const s of STAGES) expect(job.stages.find((x) => x.name === s)?.status, `stage ${s}`).toBe("passed");
  expect(maxWorking).toBeLessThanOrEqual(1);

  const v = (await (await request.get(`/api/studio/versions/${job.skill_version_id}`)).json()) as Version;
  state.version = v;
  const r = v.validation.report;
  expect(v.status).toBe("verified");
  expect(r.model).toBe("fake:scripted (MOCKED LLM)");
  expect(r.static.failed).toBe(0);
  expect(r.sandbox.status).toBe("ran");                                              // real Docker sandbox
  expect(r.summary).toMatchObject({ tests_total: 5, tests_passed: 5, evals_total: 3, evals_passed: 3 });
  await expect(page.getByText(`${v.slug}@${v.version} is verified`, { exact: false })).toBeVisible(); // new versions never overwrite: 0.1.0, 0.2.0…
  await page.screenshot({ path: join(SHOTS, "workflow-1-generated.png"), fullPage: true });
  test.info().annotations.push({ type: "MOCKED LLM generation", description: `job ${jobId}: ${job.stages.map((s) => `${s.name}=${s.status}`).join(", ")}` },
    { type: "stages observed while running", description: seen.join(" → ") },
    { type: "report", description: JSON.stringify({ status: v.status, static: r.static, ...r.summary, sandbox: r.sandbox.status }) });
  expect(problems).toEqual([]);
});

test("3 · every generated file opens in the code viewer; Copy file / Copy all match the stored files", async ({ page, request, context }) => {
  test.skip(!state.version, "generation did not complete");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:5173" });
  const v = state.version!;
  const files = new Map<string, string>();
  for (const f of v.files) files.set(f.path, await (await request.get(`/api/studio/versions/${v.id}/files/${f.path}`)).text());
  state.files = files;
  await page.setViewportSize(VIEWPORTS["1366x768"]);
  await page.goto(`/#/code/${v.id}/files`);
  const preview = page.getByLabel("file preview");
  for (const [path, text] of files) {
    await openFile(page, path);
    const firstLine = text.split("\n").find((l) => l.trim())!.trim();
    await expect(preview, path).toContainText(firstLine.slice(0, 60));
  }
  await openFile(page, "scripts/main.py");
  await page.screenshot({ path: join(SHOTS, "workflow-2-code-viewer.png"), fullPage: true });

  // The Windows system clipboard stores text with CRLF line endings, so what is read back has \r\n where the file has
  // \n. That conversion is the OS's; the comparison below is otherwise exact (every character, trailing spaces included).
  const clip = async () => page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole("button", { name: "Copy file" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();          // the button confirms the copy
  const copied = await clip();
  test.info().annotations.push({ type: "clipboard line endings", description: copied.includes("\r\n") ? "CRLF (Windows clipboard)" : "LF" });
  expect(copied.replace(/\r\n/g, "\n")).toBe(files.get("scripts/main.py"));
  await expect(page.getByRole("button", { name: "Copy file" })).toBeVisible();     // label reverts after 1.5 s
  await page.getByRole("button", { name: "Copy all files" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const all = (await clip()).replace(/\r\n/g, "\n");
  for (const [path, text] of files) expect(all, path).toContain(`# ${v.slug}/${path}\n${text}`);
  test.info().annotations.push({ type: "files", description: [...files.keys()].join(", ") });
});

test("4 · ZIP download from the UI: structure, byte-identical files, no temp files or credentials", async ({ page }) => {
  test.skip(!state.files, "no generated files");
  const v = state.version!;
  await page.goto(`/#/code/${v.id}/export`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download project (ZIP)" }).click()]);
  rmSync(EXPORT, { recursive: true, force: true });
  mkdirSync(EXPORT, { recursive: true });
  const zipPath = join(EXPORT, download.suggestedFilename());
  await download.saveAs(zipPath);
  expect(download.suggestedFilename()).toBe(`${v.slug}-${v.version}-claude-code.zip`);
  const zip = readZip(readFileSync(zipPath));
  for (const [name, text] of zip) {                                                 // extract for inspection
    const p = join(EXPORT, "extracted", name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  for (const req of ["SKILL.md", "manifest.json", "README.md", "scripts/main.py", "scripts/cli.py", "tests/test_main.py", "evals/cases.json", "docs/usage.md"]) {
    expect(zip.has(`${v.slug}/${req}`), req).toBe(true);
  }
  expect([...zip.keys()].sort()).toEqual([...state.files!.keys()].map((p) => `${v.slug}/${p}`).sort());
  for (const [p, text] of state.files!) expect(zip.get(`${v.slug}/${p}`), p).toBe(text);
  const junk = [...zip.keys()].filter((n) => /(^|\/)(\.|__pycache__|.*\.pyc$|.*\.tmp$|.*~$|\.env)/.test(n));
  expect(junk).toEqual([]);
  const secrets = [...zip].filter(([, t]) => /AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{20}|-----BEGIN [A-Z ]*PRIVATE KEY|aab_[A-Za-z0-9_-]{20}/.test(t)).map(([n]) => n);
  expect(secrets).toEqual([]);
  expect(JSON.parse(zip.get(`${v.slug}/manifest.json`)!)).toMatchObject({ id: v.slug, version: v.version, kind: "code" });
  test.info().annotations.push({ type: "zip", description: `${zipPath}\n${[...zip.keys()].join("\n")}` });
});

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => readdirSync(d).forEach((n) => {
    const p = join(d, n);
    if (n === ".git" || n === ".claude") return;
    if (statSync(p).isDirectory()) walk(p); else out.set(relative(dir, p).replace(/\\/g, "/"), createHash("sha256").update(readFileSync(p)).digest("hex"));
  });
  walk(dir);
  return out;
}

const git = (...args: string[]) => execFileSync("git", ["-C", PROJECT, "-c", "user.name=e2e", "-c", "user.email=e2e@example.invalid", ...args], { encoding: "utf8" }).trim();

test("5 · install into a separate Python project through the UI, then RUN the installed Skill there", async ({ page, request }) => {
  test.skip(!state.files, "no generated files");
  test.setTimeout(3 * 60_000);
  const v = state.version!;
  // a separate project with deliberate bugs, under git, clean
  rmSync(PROJECT, { recursive: true, force: true });
  mkdirSync(join(PROJECT, "app"), { recursive: true });
  writeFileSync(join(PROJECT, "pyproject.toml"), '[project]\nname = "external-demo"\nversion = "0.0.1"\n');
  writeFileSync(join(PROJECT, "README.md"), "# External demo project\n");
  writeFileSync(join(PROJECT, "app", "buggy.py"), [
    "def load(path, cache={}):",           // 1 mutable default
    "    try:",
    "        return open(path).read()",
    "    except:",                           // 4 bare except
    "        return None",
    "",
    "def is_empty(value):",
    "    if value == None:",                 // 8 none comparison
    "        return True",
    "    return False",
    "    print('unreachable')",              // 11 unreachable
    "",
  ].join("\n"));
  writeFileSync(join(PROJECT, "app", "clean.py"), "def add(a, b):\n    return a + b\n");
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "initial");
  const before = snapshot(PROJECT);

  await page.setViewportSize(VIEWPORTS["1366x768"]);
  await page.goto(`/#/code/${v.id}/export`);
  const section = page.getByRole("region", { name: "Implement in my project" });
  await section.getByLabel("Project folder (absolute path)").fill(PROJECT);
  await section.getByRole("button", { name: "Analyze" }).click();
  await expect(section.getByText("Python").first()).toBeVisible();                         // detected from pyproject.toml
  await expect(section.getByText(`aab/${v.slug}-${v.version}`).first()).toBeVisible();          // isolated branch, shown before approval
  await page.screenshot({ path: join(SHOTS, "workflow-3-install-plan.png"), fullPage: true });
  await section.getByRole("button", { name: /^Approve and create \d+ files$/ }).click();
  await expect(section.getByText(/Installed \d+ files\./)).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "workflow-4-installed.png"), fullPage: true });

  // destination, structure and content
  const dest = join(PROJECT, ".claude", "skills", v.slug);
  for (const [p, text] of state.files!) expect(readFileSync(join(dest, p), "utf8"), p).toBe(text);
  expect(JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8")).version).toBe(v.version);      // version info
  // nothing else changed; the install sits on its own branch, uncommitted, for review
  expect(snapshot(PROJECT)).toEqual(before);
  expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe(`aab/${v.slug}-${v.version}`);
  expect(git("status", "--porcelain")).toBe("?? .claude/");
  // history: the API's audit log records the installation with the project root
  const audit = await (await request.get("/api/studio/audit")).json() as { action: string; detail: { root?: string; files?: number } }[];
  expect(audit.find((a) => a.action === "skill.installed_in_project")?.detail).toMatchObject({ root: PROJECT, files: state.files!.size });

  // conflict detection: planning again refuses to overwrite the installed copy
  await page.reload();
  await section.getByLabel("Project folder (absolute path)").fill(PROJECT);
  await section.getByRole("button", { name: "Analyze" }).click();
  await expect(section.getByText(/already exists; remove or rename it first/)).toBeVisible();
  await expect(section.getByRole("button", { name: /^Approve and create/ })).toBeDisabled();
  await page.screenshot({ path: join(SHOTS, "workflow-5-conflict.png"), fullPage: true });

  // RUN the installed Skill from the project, the documented way (SKILL.md "How to run"), with plain Python
  const out = JSON.parse(execFileSync(PYTHON, [join(dest, "scripts", "cli.py"), "--dir", join(PROJECT, "app")], { cwd: PROJECT, encoding: "utf8" })) as
    { findings: { file: string; line: number; rule: string; suggestion: string }[]; count: number; parse_errors: string[] };
  const got = out.findings.map((f) => `${f.file}:${f.line}:${f.rule}`).sort();
  expect(got).toEqual(["buggy.py:1:mutable-default", "buggy.py:11:unreachable-code", "buggy.py:4:bare-except", "buggy.py:8:none-comparison"].sort());
  expect(out.findings.every((f) => f.suggestion.length > 10)).toBe(true);
  expect(out.parse_errors).toEqual([]);
  // and its own unit tests, from the installed copy
  const unit = execFileSync(PYTHON, ["-m", "unittest", "discover", "-s", "tests", "-t", "tests"], { cwd: dest, env: { ...process.env, PYTHONPATH: join(dest, "scripts") }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(join(OUT, "external-project-run.json"), JSON.stringify(out, null, 2));
  test.info().annotations.push({ type: "installed Skill output (external project)", description: got.join(", ") },
    { type: "installed unit tests", description: unit || "ok (unittest prints to stderr)" });

  // and the Studio's "run the agent's tests in the sandbox" after install
  await page.goto(`/#/code/${v.id}/export`);
  // the button only appears right after an install in this session; re-validation is covered on the Validation tab
  await page.getByRole("tab", { name: "Validation" }).click();
  await page.getByRole("button", { name: "Run validation again" }).click();
  await expect(page.getByText(/22 passed|passed · 0 failed/).first()).toBeVisible({ timeout: 60_000 });
});

test("6 · GitHub: what exists is copyable instructions, not an integration", async ({ page }) => {
  test.skip(!state.version, "no version");
  const requests: string[] = [];
  page.on("request", (r) => { if (!r.url().startsWith("http://localhost:5173")) requests.push(r.url()); });
  await page.goto(`/#/code/${state.version!.id}/export`);
  const gh = page.getByRole("region", { name: "Publish to GitHub (from your machine)" });
  await expect(gh).toContainText(`gh repo create ${state.version!.slug} --private --source . --push`);
  expect(requests).toEqual([]);  // nothing is sent to GitHub by the app
  await gh.screenshot({ path: join(SHOTS, "workflow-6-github-section.png") });
});

test("7 · visual audit with data: 8 routes × 4 viewports", async ({ page }) => {
  test.skip(!state.version, "no data");
  test.setTimeout(5 * 60_000);
  await visualPass(page, "data");
});
