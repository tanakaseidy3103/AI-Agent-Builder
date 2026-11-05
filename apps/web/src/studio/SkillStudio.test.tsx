import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkillStudio } from "./SkillStudio";

const STAGES = ["analyze", "specify", "plan", "generate_files", "static_validation", "test_generation", "sandbox_tests", "report", "package"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let jobPolls = 0;
const version = {
  id: "v1", skill_id: "s1", slug: "react-perf", version: "0.1.0", kind: "code", status: "verified", file_count: 2,
  manifest: { id: "react-perf", name: "React Perf", description: "Finds perf issues", version: "0.1.0", kind: "code", tools: ["Read"],
    dependencies: [], permissions: ["compute"], input_schema: { type: "object" }, output_schema: { type: "object" },
    compatibility: ["claude-code", "codex", "cursor"], execution: { entrypoint: "scripts/main.py", timeout_seconds: 10, memory_mb: 256 } },
  files: [{ path: "SKILL.md", size: 10 }, { path: "scripts/main.py", size: 20 }],
  validation: { id: "r1", status: "verified", report: { status: "verified", duration_ms: 900,
    static: { passed: 1, failed: 0, warnings: 0, checks: [{ id: "manifest.schema", status: "pass", message: "ok" }] },
    tests: [{ name: "test_main.T.test_x", status: "pass", detail: "" }], sandbox: { status: "ran", duration_ms: 800 } } },
  versions: [{ id: "v1", slug: "react-perf", version: "0.1.0", kind: "code", status: "verified", file_count: 2 }],
};

function router(url: string, init?: RequestInit) {
  if (url === "/api/studio/skills") return json([]);
  if (url === "/api/studio/skills/generate" && init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    if (body.prompt.includes("FAIL")) return json({ detail: "Ollama unreachable" }, 500);
    return json({ id: "j1", status: "queued", stages: [] }, 202);
  }
  if (url === "/api/studio/jobs/j1") {
    jobPolls++;
    const done = jobPolls > 1;
    return json({ id: "j1", status: done ? "completed" : "running", provider: "ollama:test", stage: done ? null : "analyze", error: null,
      skill_version_id: done ? "v1" : null,
      stages: STAGES.map((n, i) => ({ name: n, status: done ? "passed" : i === 0 ? "running" : "pending", detail: done ? `${n} ok` : "" })) });
  }
  if (url === "/api/studio/versions/v1") return json(version);
  if (url === "/api/studio/versions/v1/files/SKILL.md") return new Response("---\nname: react-perf\n---", { headers: { "content-type": "text/plain" } });
  if (url === "/api/studio/versions/v1/files/scripts/main.py") return new Response("def run(data): ...", { headers: { "content-type": "text/plain" } });
  if (url === "/api/studio/integrations") return json([{ id: "claude-code", label: "Claude Code", scope: "user", notes: "n" }, { id: "canonical", label: "Canonical", scope: "user", notes: "" }]);
  if (url.startsWith("/api/studio/versions/v1/install/")) return json({ zip: "react-perf-0.1.0-claude-code.zip", version: "0.1.0", status: "verified",
    note: "AI Agent Builder cannot confirm the installation.", target: { label: "Claude Code", notes: "skills dir" },
    install: { bash: 'if [ -e "$DEST/react-perf" ]; then echo exists', powershell: "Test-Path" },
    replace: { bash: "mv backup", powershell: "Rename-Item", warning: "backup first" } });
  return json({ detail: `unmocked ${url}` }, 404);
}

beforeEach(() => {
  jobPolls = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => router(url, init)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderStudio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SkillStudio /></QueryClientProvider>);
}

it("runs the full workflow: generate → pipeline → inspect → validate report → export", async () => {
  renderStudio();
  expect(await screen.findByText("No Skills yet.")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Generate Skill" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByText("Use example"));
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "code" } });
  fireEvent.click(button);

  const stages = await screen.findByLabelText("pipeline stages");
  expect(within(stages).getAllByRole("listitem")).toHaveLength(9);
  expect(await screen.findByText("package ok", {}, { timeout: 3000 })).toBeTruthy();
  const sent = JSON.parse(String(vi.mocked(fetch).mock.calls.find(([u]) => u === "/api/studio/skills/generate")![1]!.body));
  expect(sent.kind).toBe("code");

  expect(await screen.findByText("React Perf · react-perf@0.1.0")).toBeTruthy();
  expect(screen.getByText(/passed in the isolated sandbox/)).toBeTruthy();
  expect((await screen.findByLabelText("file preview")).textContent).toContain("name: react-perf");
  fireEvent.click(screen.getByText(/scripts\/main.py/));
  expect(await screen.findByText("def run(data): ...")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "manifest" }));
  expect(screen.getByText("compute")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "validation" }));
  expect(screen.getByText("manifest.schema")).toBeTruthy();
  expect(screen.getByText("test_main.T.test_x")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "export" }));
  expect(await screen.findAllByText(/refuses to overwrite/)).toHaveLength(2);
  const link = screen.getByText("Download ZIP") as HTMLAnchorElement;
  expect(link.getAttribute("href")).toBe("/api/studio/versions/v1/export/claude-code");
  expect(screen.queryByText("Replace (bash)")).toBeNull();
  fireEvent.click(screen.getByLabelText(/Show replace commands/));
  expect(screen.getByText("Replace (bash)")).toBeTruthy();
  expect(screen.getByText(/cannot confirm the installation/)).toBeTruthy();
});

it("shows an honest error when generation cannot start", async () => {
  renderStudio();
  fireEvent.change(screen.getByLabelText("Describe the capability"), { target: { value: "FAIL please generate this" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate Skill" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Ollama unreachable");
});

it("blocks export for unvalidated versions", async () => {
  version.status = "generated";
  renderStudio();
  fireEvent.click(screen.getByText("Use example"));
  fireEvent.click(screen.getByRole("button", { name: "Generate Skill" }));
  await screen.findByText("React Perf · react-perf@0.1.0", {}, { timeout: 3000 });
  fireEvent.click(screen.getByRole("tab", { name: "export" }));
  expect(screen.getByRole("alert").textContent).toContain("cannot be exported");
  expect(screen.queryByText("Download ZIP")).toBeNull();
  version.status = "verified";
});
