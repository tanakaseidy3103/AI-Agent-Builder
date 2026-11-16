/**
 * Skill Flow UI in jsdom. Data: the REAL stored Skill fixture (version detail + file texts); the network is a fetch stub
 * that serves those files (MOCKED transport, real content). jsdom has no layout, so connectors are not measured here;
 * they are checked in the Playwright specs.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VersionDetail } from "../../api";
import { LangProvider, type Lang } from "../../i18n";
import { href, parseHash } from "../../route";
import { Code } from "../kit";
import bugFinder from "./__fixtures__/python-bug-finder.json";
import { SkillFlow } from "./SkillFlow";

const v = bugFinder.version as unknown as VersionDetail;
const files = bugFinder.files as Record<string, string>;
let calls: string[] = [];
let failing = new Set<string>();

beforeEach(() => {
  calls = []; failing = new Set();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const m = /\/files\/(.+)$/.exec(url);
    if (!m) return new Response("not found", { status: 404 });
    const path = decodeURIComponent(m[1]);
    calls.push(path);
    if (failing.has(path)) return new Response(JSON.stringify({ detail: "storage unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    return new Response(files[path] ?? "", { status: files[path] === undefined ? 404 : 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderFlow(version: VersionDetail = v, lang: Lang = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LangProvider lang={lang}><SkillFlow v={version} /></LangProvider></QueryClientProvider>);
}
const node = (id: string) => document.querySelector<HTMLButtonElement>(`button[data-node="${id}"]`)!;

it("loading, then the real flow: main steps, scanned helpers, and the entrypoint selected with its code and link", async () => {
  renderFlow();
  expect(screen.getByTestId("sf-loading")).toBeTruthy();
  await screen.findByTestId("skill-flow");
  for (const id of ["input", "validation", "execution", "output", "evaluation", "fn:_finding", "fn:_check", "fn:run", "deps", "runner:scripts/cli.py", "tests", "checks", "docs"])
    expect(node(id), id).toBeTruthy();
  expect(node("execution").getAttribute("aria-pressed")).toBe("true");
  expect(node("execution").dataset.state).toBe("passed");
  expect(node("fn:run").dataset.source).toBe("scanned");
  const detail = screen.getByTestId("sf-detail");
  expect(detail.dataset.node).toBe("execution");
  expect(within(detail).getByRole("link", { name: "Open in Code Workspace" }).getAttribute("href")).toBe(`#/code/${v.id}/files/scripts%2Fmain.py`);
  expect(screen.getByTestId("sf-approx").textContent).toMatch(/approximate/);
});

it("each file is requested once, shared with the details panel (same query keys as the Files tab)", async () => {
  renderFlow();
  await screen.findByTestId("skill-flow");
  fireEvent.click(node("fn:_check"));
  fireEvent.click(node("tests"));
  fireEvent.click(node("runner:scripts/cli.py"));
  await screen.findByText(/from main import run/, { selector: "code" });
  const counts = calls.reduce<Record<string, number>>((a, p) => ({ ...a, [p]: (a[p] ?? 0) + 1 }), {});
  expect(Object.values(counts).every((n) => n === 1)).toBe(true);
  expect(Object.keys(counts).sort()).toEqual(["SKILL.md", "evals/cases.json", "manifest.json", "scripts/cli.py", "scripts/main.py", "tests/test_main.py"]);
});

it("a function: its lines are highlighted in the excerpt and the link opens them in the Code Workspace", async () => {
  renderFlow();
  await screen.findByTestId("skill-flow");
  fireEvent.click(node("fn:_check"));
  const detail = screen.getByTestId("sf-detail");
  expect(detail.dataset.node).toBe("fn:_check");
  expect(within(detail).getByRole("link", { name: "Open in Code Workspace" }).getAttribute("href")).toBe(`#/code/${v.id}/files/scripts%2Fmain.py/20-39`);
  await vi.waitFor(() => expect(detail.querySelectorAll("[data-focus]")).toHaveLength(20));
  expect(detail.querySelector("[data-focus]")!.getAttribute("data-line")).toBe("20");
  // connections list the real call evidence (the calling line) and let you jump to the other step
  const call = detail.querySelector('[data-edge="fn:run>fn:_check"]')!;
  expect(call.querySelector("code")!.textContent).toBe("findings.extend(_check(path, tree))");
  fireEvent.click(within(call as HTMLElement).getByRole("button", { name: "run" }));
  expect(screen.getByTestId("sf-detail").dataset.node).toBe("fn:run");
});

it("results come from the stored report; not-executed and unmatched are shown, never hidden", async () => {
  renderFlow();
  await screen.findByTestId("skill-flow");
  fireEvent.click(node("evaluation"));
  const detail = screen.getByTestId("sf-detail");
  const items = [...detail.querySelectorAll<HTMLElement>("[data-result]")];
  expect(items.map((li) => [li.dataset.result, li.dataset.status])).toEqual([["bare-except", "pass"], ["clean", "pass"], ["unreachable-after-return", "pass"]]);
  expect(within(detail).getByText("holdout")).toBeTruthy();
});

it("keyboard: ↓/↑/Home/End move between steps, Enter selects", async () => {
  renderFlow();
  await screen.findByTestId("skill-flow");
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[data-node]")];
  buttons[0].focus();
  fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
  expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(buttons[1], { key: "End" });
  expect(document.activeElement).toBe(buttons.at(-1));
  fireEvent.keyDown(buttons.at(-1)!, { key: "Home" });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.click(document.activeElement!); // Enter on a native button is a click
  expect(screen.getByTestId("sf-detail").dataset.node).toBe(buttons[0].dataset.node);
});

it("error: every file fails → a clear error and a retry that recovers", async () => {
  failing = new Set(["manifest.json", "SKILL.md", "scripts/main.py", "evals/cases.json", "scripts/cli.py", "tests/test_main.py"]);
  renderFlow();
  await screen.findByTestId("sf-error");
  expect(screen.getByText("The Skill's files could not be loaded.")).toBeTruthy();
  failing = new Set();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByTestId("skill-flow");
});

it("one file fails → the flow still shows, with a warning and without the parts that file would give", async () => {
  failing = new Set(["scripts/main.py"]);
  renderFlow();
  await screen.findByTestId("skill-flow");
  expect(document.querySelector('[data-warning="file_unavailable"]')).toBeTruthy();
  expect(document.querySelector('button[data-kind="function"]')).toBeNull();
  expect(node("execution").dataset.state).toBe("passed"); // decided by the stored report, not by the scan
});

it("empty package and Japanese labels", async () => {
  renderFlow({ ...v, files: [] });
  expect(screen.getByText("This version has no files to show.")).toBeTruthy();
  cleanup();
  renderFlow(v, "ja");
  await screen.findByTestId("skill-flow");
  expect(node("execution").getAttribute("aria-label")).toMatch(/^Python の実行/);
});

it("routes: file deep links round-trip, old links are unchanged", () => {
  expect(href("code", "v1", "files", { path: "scripts/main.py", start: 20, end: 39 })).toBe("#/code/v1/files/scripts%2Fmain.py/20-39");
  expect(parseHash("#/code/v1/files/scripts%2Fmain.py/20-39")).toEqual({ page: "code", id: "v1", tab: "files", file: { path: "scripts/main.py", start: 20, end: 39 } });
  expect(parseHash("#/code/v1/files/SKILL.md/7")).toEqual({ page: "code", id: "v1", tab: "files", file: { path: "SKILL.md", start: 7, end: 7 } });
  expect(parseHash("#/code/v1/files/SKILL.md/9-3").file).toEqual({ path: "SKILL.md" }); // invalid range ignored
  expect(href("code", "v1", "validation")).toBe("#/code/v1/validation");
  expect(parseHash("#/code/v1/validation")).toEqual({ page: "code", id: "v1", tab: "validation" });
  expect(parseHash("#/%E0%A4%A")).toEqual({ page: "overview", id: undefined, tab: undefined }); // malformed escape does not throw
});

it("Code: focus highlights the range; without focus nothing changes", () => {
  render(<LangProvider lang="en"><Code text={"a\nb\nc\nd"} lineNumbers path="x.py" focus={{ start: 2, end: 3 }} /></LangProvider>);
  expect([...document.querySelectorAll("[data-focus]")].map((e) => e.getAttribute("data-line"))).toEqual(["2", "3"]);
  cleanup();
  render(<LangProvider lang="en"><Code text={"a\nb"} lineNumbers path="x.py" /></LangProvider>);
  expect(document.querySelectorAll("[data-focus]")).toHaveLength(0);
});
