import { defineConfig, devices } from "@playwright/test";

const python = process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";

/**
 * Browser tests run against the REAL frontend and backend.
 * - e2e/ui-mocked.spec.ts  : UI behaviour with intercepted /api calls (fast, deterministic)
 * - e2e/real.spec.ts       : no mocks; real FastAPI + Postgres + Docker sandbox data
 * - e2e/real-generation.spec.ts : opt-in (RUN_REAL_GENERATION=1), real Ollama generation, minutes long
 * Existing dev servers on :5173 / :8000 are reused; otherwise they are started.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: /real-(generation|workflow)/ },
  ],
  webServer: [
    { command: "npm run dev -- --port 5173 --strictPort", url: "http://localhost:5173", reuseExistingServer: true, timeout: 60_000 },
    {
      command: `${python} -m uvicorn app.main:app --port 8000`,
      cwd: "../api",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
