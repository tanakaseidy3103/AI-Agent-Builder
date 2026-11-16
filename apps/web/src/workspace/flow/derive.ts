/**
 * deriveFlow(): turns a stored Skill version (manifest, file list, validation report) and the text of its files into
 * the nodes and edges of the Visual Skill Builder. Rules:
 * - a node exists only for something present in the package, the manifest or the report (or a documented platform
 *   step, marked source "platform"); an absent but expected part is a node in state "missing", never silently dropped;
 * - an edge exists only with evidence (file + line); no evidence, no edge;
 * - pass/fail comes only from the stored report; without one, everything that would have run is "not_executed";
 * - text-scan findings (functions, calls, imports) are "scanned": they show the code exists, not that it ran.
 * Platform facts encoded here (from apps/api): input is checked against input_schema only by the API run endpoint
 * (api/public.py); output is checked against output_schema by the API run endpoint (code Skills) and by the evaluation
 * harness (skills/evaluation.py); eval-case inputs are checked statically (check `code.evals`). The exported ZIP runs
 * scripts directly, so none of these checks is necessarily part of it.
 */
import type { Check, EvalResult, Manifest, Report, TestResult, VersionDetail } from "../../api";
import { findLine, lineText, scanPython, type PyScan } from "./pyscan";
import type { Fact, FileRef, Flow, FlowEdge, FlowNode, FlowWarning, NodeState, ResultItem, Source } from "./types";

/** The manifest as stored; fields the shared type does not list are read defensively. */
type StoredManifest = Omit<Partial<Manifest>, "execution"> & {
  execution?: { entrypoint?: string; runtime?: string; timeout_seconds?: number; memory_mb?: number } | null;
  tests?: { framework?: string; path?: string } | null;
  input_schema?: unknown; output_schema?: unknown;
};

export interface FlowInput {
  version: Pick<VersionDetail, "kind" | "status" | "files" | "validation"> & { manifest: StoredManifest };
  /** text of the files loaded so far; a path absent here was not loaded */
  files: Record<string, string | undefined>;
  /** paths whose download failed */
  failed?: string[];
}

const EVALS = "evals/cases.json";
const MANIFEST = "manifest.json";
const SKILL = "SKILL.md";

/** The package files deriveFlow reads, in the order they matter. Only paths that exist in the package. */
export function flowFiles(v: Pick<VersionDetail, "files"> & { manifest: StoredManifest }): string[] {
  const have = new Set(v.files.map((f) => f.path));
  const entry = v.manifest.execution?.entrypoint;
  const testsDir = `${(v.manifest.tests?.path ?? "tests").replace(/\/$/, "")}/`;
  const wanted = [
    MANIFEST, SKILL, ...(entry ? [entry] : []), EVALS,
    ...v.files.map((f) => f.path).filter((p) => (p.startsWith("scripts/") || p.startsWith(testsDir)) && p.endsWith(".py")),
  ];
  return [...new Set(wanted)].filter((p) => have.has(p));
}

// ---------- small helpers ----------

type Schema = { type?: unknown; properties?: Record<string, Schema>; required?: unknown; items?: Schema; additionalProperties?: unknown };
const asSchema = (s: unknown): Schema => (s && typeof s === "object" ? (s as Schema) : {});

/** "string", "array<object>", "object<string>", "string|null"; raw JSON-Schema words, not translated */
export function typeOf(s: Schema): string {
  const base = Array.isArray(s.type) ? s.type.join("|") : typeof s.type === "string" ? s.type : "any";
  if (base === "array" && s.items) return `array<${typeOf(asSchema(s.items))}>`;
  if (base === "object" && s.additionalProperties && typeof s.additionalProperties === "object")
    return `object<${typeOf(asSchema(s.additionalProperties))}>`;
  return base;
}

function schemaFacts(schema: unknown, ref: FileRef): Fact[] {
  const s = asSchema(schema);
  const req = new Set(Array.isArray(s.required) ? s.required.filter((x): x is string => typeof x === "string") : []);
  return Object.entries(s.properties ?? {}).map(([name, p]) =>
    ({ key: "property" as const, value: name, detail: typeOf(asSchema(p)), required: req.has(name), source: "manifest" as const, ref }));
}

const hasProps = (schema: unknown) => Object.keys(asSchema(schema).properties ?? {}).length > 0;

/** path of a check id "python.syntax:scripts/main.py" */
const checkPath = (c: Check) => (c.id.includes(":") ? c.id.slice(c.id.indexOf(":") + 1) : undefined);
const checkItem = (c: Check): ResultItem => {
  const path = checkPath(c);
  const line = Number(/\bline (\d+)/.exec(c.message)?.[1]) || undefined;
  return { name: c.id, status: c.status, detail: c.message, source: "static", ...(path ? { ref: { path, start: line, end: line } } : {}) };
};

const CRASH = /^(raised |did not complete)/;
const SCHEMA = /^output schema:/;

function node(n: Omit<FlowNode, "refs" | "facts" | "results"> & Partial<Pick<FlowNode, "refs" | "facts" | "results">>): FlowNode {
  return { refs: [], facts: [], results: [], ...n };
}

/** worst-first summary of result items: failed > passed > not executed */
function stateOf(items: ResultItem[], ran: boolean): NodeState {
  if (items.some((i) => i.status === "fail" || i.status === "error")) return "failed";
  if (!ran || items.length === 0 || items.every((i) => i.status === "not_executed")) return "not_executed";
  return "passed";
}

// ---------- the derivation ----------

export function deriveFlow({ version: v, files, failed = [] }: FlowInput): Flow {
  const m = v.manifest;
  const kind: Flow["kind"] = (m.kind ?? v.kind) === "instructions" ? "instructions" : "code";
  const report: Report | undefined = v.validation?.report;
  const have = new Set(v.files.map((f) => f.path));
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const warnings = new Set<FlowWarning>();
  const checks = report?.static.checks ?? [];
  const check = (id: string) => checks.find((c) => c.id === id);
  const manifestText = files[MANIFEST];
  const mref = (needle: string): FileRef => {
    const line = findLine(manifestText, `"${needle}"`);
    return { path: MANIFEST, start: line, end: line };
  };
  const edge = (from: string, to: string, reason: FlowEdge["reason"], source: Source, ref: FileRef) => {
    if (!nodes.some((n) => n.id === from) || !nodes.some((n) => n.id === to)) return;
    // no evidence, no edge: when the file's text is loaded the evidence must be a real line in it
    // (if the file could not be loaded, the edge keeps the file as evidence without a line; the flow warns)
    if (files[ref.path] !== undefined && !ref.start) return;
    const text = lineText(files[ref.path], ref.start);
    edges.push({ from, to, reason, source, evidence: { ...ref, ...(text ? { text } : {}) } });
  };

  if (!report) warnings.add("no_report");
  if (v.status === "validation_failed") warnings.add("validation_failed");
  if (failed.length) warnings.add("file_unavailable");
  const scans = new Map<string, PyScan>();
  const scan = (p: string) => {
    const t = files[p];
    if (t === undefined) return undefined;
    if (!scans.has(p)) scans.set(p, scanPython(t));
    return scans.get(p)!;
  };

  const sandbox = report?.sandbox;
  const ran = sandbox?.status === "ran";
  if (kind === "code" && report && (sandbox?.status === "not_run" || sandbox?.status === "unavailable")) warnings.add("sandbox_not_run");
  if (kind === "code" && sandbox?.status === "error") warnings.add("sandbox_error");

  // ---- Input ----
  const inRef = mref("input_schema");
  nodes.push(node({
    id: "input", kind: "input", title: null, lane: "main", source: "manifest",
    state: hasProps(m.input_schema) ? "info" : "unspecified", refs: [inRef], facts: schemaFacts(m.input_schema, inRef),
  }));

  // ---- Platform validation (never claimed for the Skill's own code) ----
  const io = check("manifest.io_schemas");
  const evalsCheck = check("code.evals");
  nodes.push(node({
    id: "validation", kind: "validation", title: null, lane: "main", source: "platform",
    state: io?.status === "fail" ? "failed" : "info",
    refs: [inRef, mref("output_schema")],
    facts: [
      { key: "platform_input_check", value: "api_run", source: "platform" },
      { key: "platform_output_check", value: kind === "code" ? "api_run_and_evaluation" : "none", source: "platform" },
      { key: "not_in_zip", value: "true", source: "platform" },
      ...(kind === "code" && evalsCheck ? [{ key: "eval_inputs_checked" as const, value: evalsCheck.status, source: "static" as const, ref: { path: EVALS } }] : []),
    ],
    results: [io, kind === "code" ? evalsCheck : undefined].filter((c): c is Check => !!c).map((c) => checkItem(c)),
  }));
  edge("input", "validation", "platform_check", "platform", inRef);

  // ---- Static checks (side) ----
  nodes.push(node({
    id: "checks", kind: "checks", title: null, lane: "side", source: "static",
    state: !report ? "not_executed" : checks.some((c) => c.status === "fail") ? "failed" : "passed",
    results: checks.map((c) => checkItem(c)),
  }));

  // ---- Docs (side) ----
  const docPaths = [...have].filter((p) => p === SKILL || p === "README.md" || (p.startsWith("docs/") && p.endsWith(".md"))).sort();
  if (docPaths.length) nodes.push(node({ id: "docs", kind: "docs", title: null, lane: "side", source: "manifest", state: "info", refs: docPaths.map((path) => ({ path })) }));

  const outRef = mref("output_schema");

  if (kind === "instructions") {
    const skillText = files[SKILL];
    const steps = (skillText ?? "").split(/\r?\n/).filter((l) => /^\s*\d+\.\s+\S/.test(l)).length;
    nodes.push(node({
      id: "instructions", kind: "instructions", title: SKILL, lane: "main", source: have.has(SKILL) ? "scanned" : "manifest",
      state: have.has(SKILL) ? "info" : "missing", refs: [{ path: SKILL }],
      facts: skillText !== undefined ? [{ key: "steps", value: String(steps), source: "scanned", ref: { path: SKILL } }] : [],
    }));
    nodes.push(node({
      id: "output", kind: "output", title: null, lane: "main", source: "platform", state: "info", refs: [outRef],
      // the API run endpoint returns {"text": <model answer>} for instructions Skills and does not check output_schema
      facts: [{ key: "output_shape", value: "text", source: "platform" }, ...schemaFacts(m.output_schema, outRef)],
    }));
    edge("validation", "instructions", "contract", "platform", { path: SKILL, start: 1, end: 1 });
    edge("instructions", "output", "contract", "platform", { path: SKILL, start: 1, end: 1 });
    pushEvaluation(false);
    return finish();
  }

  // ---- Code Skill ----
  const entry = m.execution?.entrypoint;
  const entryPresent = !!entry && have.has(entry);
  const entryText = entry ? files[entry] : undefined;
  const entryScan = entryPresent ? scan(entry!) : undefined;
  if (entryPresent && entryText === undefined) warnings.add("file_unavailable");

  const entryChecks = entry ? [check("code.entrypoint"), check(`python.syntax:${entry}`), check(`python.policy:${entry}`), check(`python.api:${entry}`)]
    .filter((c): c is Check => !!c) : [check("code.entrypoint")].filter((c): c is Check => !!c);
  const crashes = (report?.evals ?? []).filter((e) => e.reasons.some((r) => CRASH.test(r)));
  let execState: NodeState;
  if (!entry || !entryPresent) execState = "missing";
  else if (entryChecks.some((c) => c.status === "fail") || sandbox?.status === "error" || crashes.length) execState = "failed";
  else if (ran && (report?.evals?.length ?? 0) > 0) execState = "passed"; // run() was called by the eval harness
  else execState = "not_executed";
  const exRef = mref("entrypoint");
  nodes.push(node({
    id: "execution", kind: "execution", title: entry ?? null, lane: "main",
    source: execState === "passed" || crashes.length || sandbox?.status === "error" ? "executed" : entryChecks.length ? "static" : "manifest",
    state: execState,
    refs: entryPresent ? [{ path: entry! }, exRef] : [exRef],
    facts: [
      ...(entry ? [{ key: "entrypoint" as const, value: entry, source: "manifest" as const, ref: exRef }] : []),
      ...(m.execution?.runtime ? [{ key: "runtime" as const, value: m.execution.runtime, source: "manifest" as const, ref: mref("runtime") }] : []),
      ...(m.execution?.timeout_seconds !== undefined ? [{ key: "timeout_s" as const, value: String(m.execution.timeout_seconds), source: "manifest" as const, ref: mref("timeout_seconds") }] : []),
      ...(m.execution?.memory_mb !== undefined ? [{ key: "memory_mb" as const, value: String(m.execution.memory_mb), source: "manifest" as const, ref: mref("memory_mb") }] : []),
      ...(m.permissions ?? []).map((p) => ({ key: "permission" as const, value: p, source: "manifest" as const, ref: mref("permissions") })),
      ...(sandbox ? [{ key: "sandbox" as const, value: sandbox.status, source: "executed" as const }] : []),
      ...(sandbox?.error ? [{ key: "sandbox_error" as const, value: sandbox.error, source: "executed" as const }] : []),
      ...(entryScan ? [{ key: "function_count" as const, value: String(entryScan.functions.filter((f) => f.parent === null).length), source: "scanned" as const, ref: { path: entry! } }] : []),
    ],
    results: [
      ...entryChecks.map((c) => checkItem(c)),
      ...crashes.map((e): ResultItem => ({ name: e.name, status: "fail", detail: e.reasons.find((r) => CRASH.test(r)), source: "executed", input: e.input })),
    ],
  }));
  if (entry) edge("validation", "execution", "contract", "manifest", exRef); // only when the manifest names an entrypoint

  // ---- Functions of the entrypoint (scanned) ----
  const fnId = (name: string) => `fn:${name}`;
  const top = entryScan?.functions.filter((f) => f.parent === null) ?? [];
  for (const f of top) {
    const nested = entryScan!.functions.filter((g) => g.qualname.startsWith(`${f.name}.`));
    nodes.push(node({
      id: fnId(f.name), kind: "function", title: f.name, lane: "side", source: "scanned", state: "info",
      refs: [{ path: entry!, start: f.start, end: f.end }],
      facts: [
        { key: "params", value: f.params, source: "scanned" },
        ...f.decorators.map((d) => ({ key: "decorator" as const, value: d, source: "scanned" as const })),
        ...nested.map((g) => ({ key: "nested" as const, value: g.qualname, source: "scanned" as const, ref: { path: entry!, start: g.line, end: g.end } })),
      ],
    }));
  }
  // the platform harness calls run(data) in the entrypoint (sandbox eval mode / API run); drawn only if run is defined
  const run = top.find((f) => f.name === "run");
  if (run) edge("execution", fnId("run"), "contract", "scanned", { path: entry!, start: run.line, end: run.line });
  const seenCall = new Set<string>();
  for (const c of entryScan?.calls ?? []) {
    const from = c.from.split(".")[0];
    if (from === "<module>" || from === c.to) continue;
    const key = `${from}>${c.to}`;
    if (seenCall.has(key)) continue;
    seenCall.add(key);
    edge(fnId(from), fnId(c.to), "calls", "scanned", { path: entry!, start: c.line, end: c.line });
  }

  // ---- Dependencies (imports scanned + manifest + policy check) ----
  if (entryPresent) {
    const policy = check(`python.policy:${entry}`);
    const deps = check("manifest.dependencies");
    const imports = entryScan?.imports ?? [];
    nodes.push(node({
      id: "deps", kind: "dependencies", title: null, lane: "side", source: entryScan ? "scanned" : "manifest",
      state: policy?.status === "fail" || deps?.status === "fail" ? "failed" : "info",
      refs: imports.length ? [{ path: entry!, start: imports[0].line, end: imports.at(-1)!.end }] : [],
      facts: [
        ...imports.map((i) => ({ key: "import" as const, value: i.text, source: "scanned" as const, ref: { path: entry!, start: i.line, end: i.end } })),
        ...(m.dependencies ?? []).map((d) => ({ key: "manifest_dependency" as const, value: d, source: "manifest" as const, ref: mref("dependencies") })),
        ...(m.tools ?? []).map((d) => ({ key: "tool" as const, value: d, source: "manifest" as const, ref: mref("tools") })),
      ],
      results: [policy, deps].filter((c): c is Check => !!c).map((c) => checkItem(c)),
    }));
    if (imports.length) edge("deps", "execution", "imports", "scanned", { path: entry!, start: imports[0].line, end: imports[0].line });
  }

  // ---- Output ----
  const evals = report?.evals ?? [];
  const schemaFails = evals.filter((e) => e.reasons.some((r) => SCHEMA.test(r)));
  const outState: NodeState = schemaFails.length ? "failed"
    : !hasProps(m.output_schema) ? "unspecified"
    : ran && evals.length ? "passed" : "not_executed";
  nodes.push(node({
    id: "output", kind: "output", title: null, lane: "main", source: ran && evals.length ? "platform" : "manifest", state: outState,
    refs: [outRef], facts: schemaFacts(m.output_schema, outRef),
    // one item per eval case that produced an output: did it match output_schema (checked by the evaluation harness)?
    // a crashed case produced no output and is reported on the execution node instead
    results: evals.filter((e) => !e.reasons.some((r) => CRASH.test(r)) && e.actual !== null && e.actual !== undefined).map((e): ResultItem => {
      const bad = e.reasons.filter((r) => SCHEMA.test(r));
      return { name: e.name, status: bad.length ? "fail" : "pass", detail: bad.join("; ") || undefined, source: "platform", actual: e.actual };
    }),
  }));
  if (entry) edge("execution", "output", "contract", "manifest", outRef);

  // ---- Runner scripts that import the entrypoint (e.g. scripts/cli.py) ----
  const entryModule = entry?.split("/").pop()?.replace(/\.py$/, "");
  for (const p of [...have].filter((x) => x.startsWith("scripts/") && x.endsWith(".py") && x !== entry).sort()) {
    const s = scan(p);
    const imp = s?.imports.find((i) => i.module === entryModule);
    nodes.push(node({
      id: `runner:${p}`, kind: "runner", title: p, lane: "side", source: s ? "scanned" : "manifest", state: "info",
      refs: [{ path: p }],
      results: [check(`python.syntax:${p}`), check(`python.policy:${p}`), check(`python.api:${p}`)].filter((c): c is Check => !!c).map((c) => checkItem(c)),
    }));
    if (imp) {
      const target = imp.names.some((n) => n.name === "run") && run ? fnId("run") : "execution";
      edge(`runner:${p}`, target, "imports", "scanned", { path: p, start: imp.line, end: imp.line });
    }
  }
  // docs that name a script: SKILL.md / README / docs mention the path
  for (const d of docPaths) {
    for (const target of nodes.filter((n) => n.kind === "runner" || n.kind === "execution")) {
      const path = target.kind === "execution" ? entry : target.title;
      const line = path ? findLine(files[d], path) : undefined;
      if (line) edge("docs", target.id, "mentions", "scanned", { path: d, start: line, end: line });
    }
  }

  // ---- Unit tests ----
  const testsDir = `${(m.tests?.path ?? "tests").replace(/\/$/, "")}/`;
  const testFiles = [...have].filter((p) => p.startsWith(testsDir) && p.endsWith(".py")).sort();
  const defs = testFiles.flatMap((p) => {
    const s = scan(p);
    const mod = p.slice(testsDir.length).replace(/\.py$/, "").replace(/\//g, ".");
    return (s?.functions ?? []).filter((f) => f.parentKind === "class" && f.name.startsWith("test"))
      .map((f) => ({ id: `${mod}.${f.qualname}`, ref: { path: p, start: f.line, end: f.end } }));
  });
  const reported: TestResult[] = report?.tests ?? [];
  const byName = new Map(reported.map((r) => [r.name, r]));
  const testItems: ResultItem[] = [
    ...defs.map((d): ResultItem => {
      const r = byName.get(d.id);
      return r ? { name: d.id, status: r.status, detail: r.detail || undefined, source: "executed", ref: d.ref }
        : { name: d.id, status: "not_executed", source: "scanned", ref: d.ref };
    }),
    // report entries with no matching definition (e.g. a module that failed to import) are shown, never dropped
    ...reported.filter((r) => !defs.some((d) => d.id === r.name))
      .map((r): ResultItem => ({ name: r.name, status: r.status, detail: r.detail || undefined, source: "executed", unmatched: true })),
  ];
  const testsCheck = check("code.tests");
  nodes.push(node({
    id: "tests", kind: "tests", title: null, lane: "side", source: reported.length ? "executed" : "scanned",
    state: !testFiles.length ? "missing" : stateOf(testItems, ran),
    refs: testFiles.map((path) => ({ path })),
    results: [...testItems, ...(testsCheck ? [checkItem(testsCheck)] : [])],
  }));
  for (const p of testFiles) {
    const imp = scan(p)?.imports.find((i) => i.module === entryModule);
    if (imp) edge("tests", imp.names.some((n) => n.name === "run") && run ? fnId("run") : "execution", "imports", "scanned", { path: p, start: imp.line, end: imp.line });
  }

  pushEvaluation(true);
  return finish();

  // ---- Evaluation cases (both kinds; only code Skills are run by the platform) ----
  function pushEvaluation(runs: boolean) {
    if (!have.has(EVALS)) {
      if (kind === "code") nodes.push(node({ id: "evaluation", kind: "evaluation", title: EVALS, lane: "main", source: "manifest", state: "missing", refs: [{ path: EVALS }] }));
      return;
    }
    const text = files[EVALS];
    let cases: { name?: unknown; holdout?: unknown }[] = [];
    try { const parsed = text === undefined ? [] : JSON.parse(text); cases = Array.isArray(parsed) ? parsed : []; } catch { cases = []; }
    const results: EvalResult[] = runs ? report?.evals ?? [] : [];
    const caseLine = (name: string) => findLine(text, new RegExp(`"name"\\s*:\\s*${JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const items: ResultItem[] = [
      ...cases.filter((c) => typeof c.name === "string").map((c): ResultItem => {
        const name = c.name as string;
        const r = results.find((x) => x.name === name);
        const line = caseLine(name);
        const ref = { path: EVALS, start: line, end: line };
        return r ? { name, status: r.status, detail: r.reasons.join("; ") || undefined, source: "executed", ref, holdout: !!r.holdout, input: r.input, expected: r.expected, actual: r.actual }
          : { name, status: "not_executed", source: "scanned", ref, holdout: !!c.holdout };
      }),
      ...results.filter((r) => !cases.some((c) => c.name === r.name))
        .map((r): ResultItem => ({ name: r.name, status: r.status, detail: r.reasons.join("; ") || undefined, source: "executed", holdout: !!r.holdout, unmatched: true })),
    ];
    nodes.push(node({
      id: "evaluation", kind: "evaluation", title: EVALS, lane: "main", source: runs && results.length ? "executed" : "scanned",
      state: stateOf(items, runs && ran), refs: [{ path: EVALS }], results: items,
    }));
    if (runs) edge("output", "evaluation", "evaluates", "platform", { path: EVALS, start: 1, end: 1 });
  }

  function finish(): Flow {
    if ([...scans.values()].some((s) => s.warnings.length)) warnings.add("scan_approximate");
    return { kind, nodes, edges, warnings: [...warnings] };
  }
}
