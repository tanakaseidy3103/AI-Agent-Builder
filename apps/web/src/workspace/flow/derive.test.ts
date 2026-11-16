/**
 * deriveFlow on REAL stored Skills (fixtures: GET /studio/versions/{id} + file contents from the local API, see
 * __fixtures__/*.json "_source"), plus variants of them for the cases a real store does not contain yet (no report,
 * instructions Skill, broken manifest, crashes). The variants are hand-edited copies and are marked as such below.
 * No test here executes a Skill: "executed" results come from the stored report.
 */
import { describe, expect, it } from "vitest";
import bugFinder from "./__fixtures__/python-bug-finder.json";
import a11y from "./__fixtures__/react-accessibility-analyzer.json";
import { deriveFlow, flowFiles, typeOf, type FlowInput } from "./derive";
import { lineText } from "./pyscan";
import type { Flow } from "./types";

type Fixture = { version: unknown; files: Record<string, string> };
const input = (f: Fixture, edit?: (x: { version: FlowInput["version"]; files: Record<string, string | undefined> }) => void): FlowInput => {
  const x = structuredClone(f) as unknown as { version: FlowInput["version"]; files: Record<string, string | undefined> };
  const before = JSON.stringify(x.version.manifest);
  edit?.(x);
  // keep the variant consistent: an edited manifest is also what manifest.json contains (as the backend would store it)
  if (JSON.stringify(x.version.manifest) !== before && x.files["manifest.json"] !== undefined)
    x.files["manifest.json"] = JSON.stringify(x.version.manifest, null, 2);
  return { version: x.version, files: x.files };
};
const byId = (f: Flow, id: string) => f.nodes.find((n) => n.id === id);
const edgesOf = (f: Flow) => f.edges.map((e) => `${e.from}>${e.to}:${e.reason}`);

/** The core rule: every edge joins existing nodes and points at a real line whose text is the recorded evidence. */
function expectEvidence(flow: Flow, files: Record<string, string | undefined>) {
  for (const e of flow.edges) {
    expect(byId(flow, e.from), `edge from ${e.from}`).toBeTruthy();
    expect(byId(flow, e.to), `edge to ${e.to}`).toBeTruthy();
    expect(e.evidence.path).toBeTruthy();
    expect(e.evidence.start, `${e.from}>${e.to} has a line`).toBeGreaterThan(0);
    if (files[e.evidence.path] !== undefined) expect(e.evidence.text).toBe(lineText(files[e.evidence.path], e.evidence.start));
  }
}

describe("real generated Skill (python-bug-finder, verified)", () => {
  const inp = input(bugFinder as Fixture);
  const flow = deriveFlow(inp);

  it("main flow: input → platform validation → execution → output → evaluation, with evidence", () => {
    expect(flow.kind).toBe("code");
    expect(flow.warnings).toEqual([]);
    expect(edgesOf(flow)).toEqual(expect.arrayContaining([
      "input>validation:platform_check", "validation>execution:contract", "execution>output:contract", "output>evaluation:evaluates",
    ]));
    expectEvidence(flow, inp.files);
  });

  it("input and output come from the manifest schemas", () => {
    expect(byId(flow, "input")!.facts).toEqual([expect.objectContaining({ key: "property", value: "files", detail: "object<string>", required: true, source: "manifest" })]);
    expect(byId(flow, "output")!.facts.map((f) => f.value)).toEqual(expect.arrayContaining(["findings", "count"]));
    expect(byId(flow, "output")).toMatchObject({ state: "passed", source: "platform" });
  });

  it("validation is the platform's, and says it is not necessarily in the ZIP", () => {
    const v = byId(flow, "validation")!;
    expect(v).toMatchObject({ source: "platform", state: "info" });
    expect(v.facts.map((f) => `${f.key}=${f.value}`)).toEqual(expect.arrayContaining([
      "platform_input_check=api_run", "platform_output_check=api_run_and_evaluation", "not_in_zip=true", "eval_inputs_checked=pass"]));
    expect(v.results.map((r) => r.name)).toEqual(["manifest.io_schemas", "code.evals"]);
  });

  it("execution: passed only because the sandbox really ran the eval cases", () => {
    expect(byId(flow, "execution")).toMatchObject({ state: "passed", source: "executed", title: "scripts/main.py" });
    expect(byId(flow, "execution")!.facts).toEqual(expect.arrayContaining([expect.objectContaining({ key: "sandbox", value: "ran", source: "executed" })]));
  });

  it("functions are scanned (never 'passed'); calls drawn only where the text has them", () => {
    const fns = flow.nodes.filter((n) => n.kind === "function");
    expect(fns.map((n) => n.title)).toEqual(["_finding", "_check", "run"]);
    expect(fns.every((n) => n.source === "scanned" && n.state === "info")).toBe(true);
    expect(edgesOf(flow)).toEqual(expect.arrayContaining(["execution>fn:run:contract", "fn:run>fn:_check:calls", "fn:_check>fn:_finding:calls"]));
    expect(edgesOf(flow)).not.toContain("fn:run>fn:_finding:calls");
  });

  it("cli.py, the tests and SKILL.md are linked by their real import / mention lines", () => {
    const cli = flow.edges.find((e) => e.from === "runner:scripts/cli.py")!;
    expect(cli).toMatchObject({ to: "fn:run", reason: "imports", evidence: { path: "scripts/cli.py", text: "from main import run  # noqa: E402" } });
    expect(flow.edges.find((e) => e.from === "tests")).toMatchObject({ to: "fn:run", evidence: { path: "tests/test_main.py", text: "from main import run" } });
    expect(edgesOf(flow)).toContain("docs>runner:scripts/cli.py:mentions");
  });

  it("unit tests: each definition tied to its report entry by module.Class.method, all executed", () => {
    const t = byId(flow, "tests")!;
    expect(t).toMatchObject({ state: "passed", source: "executed" });
    const items = t.results.filter((r) => r.name.startsWith("test_main."));
    expect(items).toHaveLength(5);
    expect(items.every((r) => r.status === "pass" && r.source === "executed" && !r.unmatched && r.ref?.path === "tests/test_main.py")).toBe(true);
  });

  it("eval cases: report results joined to cases.json lines, holdout kept", () => {
    const e = byId(flow, "evaluation")!;
    expect(e).toMatchObject({ state: "passed", source: "executed" });
    expect(e.results.map((r) => [r.name, r.status, r.holdout])).toEqual([["bare-except", "pass", false], ["clean", "pass", false], ["unreachable-after-return", "pass", true]]);
    for (const r of e.results) expect(lineText(inp.files[r.ref!.path], r.ref!.start)).toContain(`"${r.name}"`);
  });

  it("dependencies: the imports of the entrypoint and the policy check", () => {
    const d = byId(flow, "deps")!;
    expect(d.facts.filter((f) => f.key === "import").map((f) => f.value)).toEqual(["import ast"]);
    expect(d.results.map((r) => [r.name, r.status])).toContainEqual(["python.policy:scripts/main.py", "pass"]);
  });

  it("flowFiles lists only package files the flow reads", () => {
    expect(flowFiles(inp.version)).toEqual(["manifest.json", "SKILL.md", "scripts/main.py", "evals/cases.json", "scripts/cli.py", "tests/test_main.py"]);
  });
});

describe("real reference Skill (react-accessibility-analyzer)", () => {
  const inp = input(a11y as Fixture);
  const flow = deriveFlow(inp);
  it("helper chain run → _check → _has, no edge from the docstring mention of run()", () => {
    expect(edgesOf(flow)).toEqual(expect.arrayContaining(["fn:run>fn:_check:calls", "fn:_check>fn:_has:calls"]));
    expect(flow.edges.filter((e) => e.reason === "calls")).toHaveLength(2);
    expectEvidence(flow, inp.files);
  });
  it("a module-level test helper is not a test; the five test methods are", () => {
    expect(byId(flow, "tests")!.results.filter((r) => r.name.startsWith("test_main.")).map((r) => r.name.split(".").pop()))
      .toEqual(["test_img_without_alt", "test_clickable_div", "test_anchor_href", "test_input_label", "test_line_numbers_and_non_frontend_files"]);
  });
});

describe("variants (hand-edited copies of the real fixture)", () => {
  it("no validation report: nothing is passed, everything that would run is 'not executed'", () => {
    const inp = input(bugFinder as Fixture, (x) => { x.version.validation = null; });
    const flow = deriveFlow(inp);
    expect(flow.warnings).toContain("no_report");
    for (const id of ["execution", "tests", "evaluation", "checks", "output"]) expect(byId(flow, id)!.state, id).toBe("not_executed");
    expect(flow.nodes.some((n) => n.state === "passed")).toBe(false);
    expect(byId(flow, "tests")!.results.every((r) => r.status === "not_executed" && r.source === "scanned")).toBe(true);
    expect(byId(flow, "evaluation")!.results.map((r) => [r.name, r.status])).toEqual([
      ["bare-except", "not_executed"], ["clean", "not_executed"], ["unreachable-after-return", "not_executed"]]);
  });

  it("instructions Skill (no Python): input → validation → SKILL.md instructions → text output; output not validated", () => {
    const inp = input(bugFinder as Fixture, (x) => {
      x.version.kind = "instructions";
      x.version.manifest = { ...x.version.manifest, kind: "instructions", execution: null, tests: null };
      x.version.files = [{ path: "SKILL.md", size: 1 }, { path: "manifest.json", size: 1 }, { path: "README.md", size: 1 }];
      x.version.validation = null;
      x.files = { "SKILL.md": x.files["SKILL.md"], "manifest.json": x.files["manifest.json"] };
    });
    const flow = deriveFlow(inp);
    expect(flow.kind).toBe("instructions");
    expect(flow.nodes.map((n) => n.kind)).not.toEqual(expect.arrayContaining(["execution"]));
    expect(flow.nodes.some((n) => n.kind === "execution" || n.kind === "function" || n.kind === "tests" || n.kind === "runner")).toBe(false);
    expect(edgesOf(flow)).toEqual(["input>validation:platform_check", "validation>instructions:contract", "instructions>output:contract"]);
    expect(byId(flow, "validation")!.facts).toContainEqual(expect.objectContaining({ key: "platform_output_check", value: "none" }));
    expect(byId(flow, "output")!.facts).toContainEqual(expect.objectContaining({ key: "output_shape", value: "text", source: "platform" }));
    expect(Number(byId(flow, "instructions")!.facts.find((f) => f.key === "steps")!.value)).toBeGreaterThan(0);
    expect(byId(flow, "evaluation")).toBeUndefined(); // no evals file in this package
    expectEvidence(flow, inp.files);
  });

  it("incomplete manifest: no execution block, empty schemas → missing / unspecified, and no invented edges", () => {
    const flow = deriveFlow(input(bugFinder as Fixture, (x) => {
      x.version.manifest = { ...x.version.manifest, execution: undefined, input_schema: { type: "object" }, output_schema: {} };
    }));
    expect(byId(flow, "execution")).toMatchObject({ state: "missing", title: null });
    expect(byId(flow, "input")).toMatchObject({ state: "unspecified", facts: [] });
    expect(byId(flow, "output")!.state).toBe("unspecified");
    expect(flow.nodes.some((n) => n.kind === "function")).toBe(false);
    // no entrypoint declared → no evidence for the contract edges through execution
    expect(edgesOf(flow).some((e) => e.includes("execution"))).toBe(false);
    expect(edgesOf(flow)).toContain("input>validation:platform_check");
    expect(flow.edges.every((e) => e.evidence.start! > 0)).toBe(true);
  });

  it("files absent from the package: entrypoint, tests and eval cases are 'missing'", () => {
    const flow = deriveFlow(input(bugFinder as Fixture, (x) => {
      x.version.files = x.version.files.filter((f) => !["scripts/main.py", "tests/test_main.py", "evals/cases.json"].includes(f.path));
      for (const p of ["scripts/main.py", "tests/test_main.py", "evals/cases.json"]) delete x.files[p];
    }));
    expect(byId(flow, "execution")!.state).toBe("missing");
    expect(byId(flow, "tests")!.state).toBe("missing");
    expect(byId(flow, "evaluation")).toMatchObject({ state: "missing", title: "evals/cases.json" });
    expect(byId(flow, "deps")).toBeUndefined();
  });

  it("a file that failed to load: warning, no scanned functions, the report still decides the state", () => {
    const flow = deriveFlow({ ...input(bugFinder as Fixture, (x) => { delete x.files["scripts/main.py"]; }), failed: ["scripts/main.py"] });
    expect(flow.warnings).toContain("file_unavailable");
    expect(flow.nodes.some((n) => n.kind === "function")).toBe(false);
    expect(byId(flow, "execution")!.state).toBe("passed");
  });

  it("schema validation failures are shown: io_schemas check fails, eval output breaks output_schema", () => {
    const flow = deriveFlow(input(bugFinder as Fixture, (x) => {
      const r = x.version.validation!.report;
      r.static.checks = r.static.checks.map((c) => (c.id === "manifest.io_schemas" ? { ...c, status: "fail", message: "schemas must be {type: object}" } : c));
      r.evals![0] = { ...r.evals![0], status: "fail", reasons: ["output schema: $.count: expected integer"] };
    }));
    expect(byId(flow, "validation")!.state).toBe("failed");
    expect(byId(flow, "output")).toMatchObject({ state: "failed" });
    expect(byId(flow, "output")!.results[0]).toMatchObject({ name: "bare-except", status: "fail", detail: "output schema: $.count: expected integer" });
    expect(byId(flow, "evaluation")!.state).toBe("failed");
    expect(byId(flow, "checks")!.state).toBe("failed");
  });

  it("execution failures are shown: a crashing eval case and a sandbox error", () => {
    const crash = deriveFlow(input(bugFinder as Fixture, (x) => {
      const r = x.version.validation!.report;
      r.evals![1] = { ...r.evals![1], status: "fail", reasons: ["raised ZeroDivisionError: division by zero"], actual: null };
    }));
    const ex = byId(crash, "execution")!;
    expect(ex).toMatchObject({ state: "failed", source: "executed" });
    expect(ex.results).toContainEqual(expect.objectContaining({ name: "clean", status: "fail", detail: "raised ZeroDivisionError: division by zero" }));
    expect(byId(crash, "output")!.results.map((r) => r.name)).not.toContain("clean"); // no output was produced

    const sbx = deriveFlow(input(bugFinder as Fixture, (x) => {
      const r = x.version.validation!.report;
      r.sandbox = { status: "error", error: "container exited 137 (out of memory)" };
      r.tests = []; r.evals = [];
    }));
    expect(sbx.warnings).toContain("sandbox_error");
    expect(byId(sbx, "execution")).toMatchObject({ state: "failed", source: "executed" });
    expect(byId(sbx, "execution")!.facts).toContainEqual(expect.objectContaining({ key: "sandbox_error", value: "container exited 137 (out of memory)" }));
    expect(byId(sbx, "tests")!.state).toBe("not_executed");
  });

  it("validation_failed with a syntax error: sandbox not run, the static failure is the reason", () => {
    const flow = deriveFlow(input(bugFinder as Fixture, (x) => {
      x.version.status = "validation_failed";
      const r = x.version.validation!.report;
      r.static.checks = r.static.checks.map((c) => (c.id === "python.syntax:scripts/main.py" ? { ...c, status: "fail", message: "line 7: invalid syntax" } : c));
      r.sandbox = { status: "not_run" }; r.tests = []; r.evals = [];
    }));
    expect(flow.warnings).toEqual(expect.arrayContaining(["validation_failed", "sandbox_not_run"]));
    expect(byId(flow, "execution")).toMatchObject({ state: "failed", source: "static" });
    expect(byId(flow, "execution")!.results).toContainEqual(expect.objectContaining({ name: "python.syntax:scripts/main.py", status: "fail", ref: { path: "scripts/main.py", start: 7, end: 7 } }));
    expect(byId(flow, "evaluation")!.state).toBe("not_executed");
  });

  it("a test result that matches no definition is listed as unmatched and fails the node", () => {
    const flow = deriveFlow(input(bugFinder as Fixture, (x) => {
      x.version.validation!.report.tests.push({ name: "unittest.loader._FailedTest.test_helpers", status: "error", detail: "ImportError: No module named helpers" });
    }));
    expect(byId(flow, "tests")!.state).toBe("failed");
    expect(byId(flow, "tests")!.results).toContainEqual(expect.objectContaining({ name: "unittest.loader._FailedTest.test_helpers", unmatched: true, status: "error" }));
  });
});

it("typeOf renders JSON-Schema types without translating them", () => {
  expect(typeOf({ type: "array", items: { type: "object" } })).toBe("array<object>");
  expect(typeOf({ type: "object", additionalProperties: { type: "string" } })).toBe("object<string>");
  expect(typeOf({ type: ["string", "null"] })).toBe("string|null");
  expect(typeOf({})).toBe("any");
});
