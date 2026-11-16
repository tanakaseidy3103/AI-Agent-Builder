import { defineConfig, devices } from "@playwright/test";

const python = process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python";

/**
 * Browser tests of the PUBLIC DEMO build against the real demo backend (app.demo) with a MOCKED LLM.
 *   npx playwright test -c playwright.demo.config.ts
 * Builds the frontend exactly like the published one would be (VITE_DEMO_MODE=true, VITE_API_BASE=<backend URL>),
 * serves it with `vite preview` on :4173 and starts scripts/demo_mock_server.py on :8100.
 * Other ports, e.g. when 8100 is busy: DEMO_API_PORT=8101 DEMO_WEB_PORT=4174 npx playwright test -c playwright.demo.config.ts
 * The local-mode suite (playwright.config.ts) is separate and unchanged.
 */
const API_PORT = process.env.DEMO_API_PORT ?? "8100";
const WEB_PORT = process.env.DEMO_WEB_PORT ?? "4173";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts$/,  // not *.spec.ts: keeps these out of the local suite and out of Vitest
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  outputDir: "test-results/demo",
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `npx vite build --outDir dist-demo --emptyOutDir && npx vite preview --outDir dist-demo --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      env: { VITE_DEMO_MODE: "true", VITE_API_BASE: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `${python} -u scripts/demo_mock_server.py`,
      cwd: "../api",
      env: { PORT: API_PORT, DEMO_ALLOWED_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}` },
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      // /health answers only after the 5 examples are validated in the sandbox (seeded before serving, see the
      // script): ~7 s normally, minutes on a loaded machine. The wait belongs here, not inside the first test.
      timeout: 300_000,
    },
  ],
});
