/**
 * Visual Skill Builder: the data model of a Skill's flow. Produced by deriveFlow() from the real package files and the
 * stored validation report; never from guesses. Every node and edge says WHERE its information came from (`source`),
 * so the UI can tell real execution apart from static checks, text scanning and platform behaviour.
 * Strings here are identifiers and raw values (paths, function names, report messages); the UI translates the codes.
 */

/**
 * Where a piece of information comes from:
 * - executed: the sandbox ran it and the stored report has the result (unit tests, eval cases).
 * - static:   the platform's static validator checked it (report.static.checks); nothing was run.
 * - scanned:  found by reading the file text in the browser (approximate; see pyscan.ts). Not proof that it runs.
 * - manifest: declared in manifest.json.
 * - platform: done by AI Agent Builder itself (API run endpoint / evaluation harness), not by the Skill's own files,
 *             so it is not necessarily part of the exported ZIP.
 */
export type Source = "executed" | "static" | "scanned" | "manifest" | "platform";

/**
 * passed / failed:  a real result (executed or static check).
 * not_executed:     nothing ran (no report, sandbox not run or unavailable). Never shown as passed.
 * missing:          the manifest or validator expects it, but the file / field is absent.
 * unspecified:      present but empty (e.g. a schema with no properties).
 * info:             descriptive only (scanned or declared); carries no pass/fail claim.
 */
export type NodeState = "passed" | "failed" | "not_executed" | "missing" | "unspecified" | "info";

export type NodeKind =
  | "input" | "validation" | "runner" | "execution" | "function" | "dependencies" | "output"
  | "instructions" | "evaluation" | "tests" | "checks" | "docs";

/** A place in a package file. Lines are 1-based and inclusive. */
export interface FileRef { path: string; start?: number; end?: number }

/** Machine-readable facts about a node; the UI maps `key` to a translated label and shows `value` as-is. */
export type FactKey =
  | "property" | "required" | "type" | "entrypoint" | "runtime" | "timeout_s" | "memory_mb" | "permission" | "tool"
  | "manifest_dependency" | "import" | "function_count" | "sandbox" | "sandbox_error" | "steps" | "params"
  | "decorator" | "nested" | "file" | "platform_input_check" | "platform_output_check" | "not_in_zip"
  | "eval_inputs_checked" | "output_shape";

/** `detail` is a raw secondary value (e.g. a schema property's type); `required` marks required schema properties. */
export interface Fact { key: FactKey; value: string; detail?: string; required?: boolean; source: Source; ref?: FileRef }

/** One result line: a unit test, an eval case or a static check, exactly as the report recorded it. */
export interface ResultItem {
  name: string;
  status: "pass" | "fail" | "error" | "skip" | "warn" | "not_executed";
  detail?: string;
  source: Source;
  ref?: FileRef;
  holdout?: boolean;
  input?: unknown; expected?: unknown; actual?: unknown;
  /** report entry that could not be tied to a definition in the files (shown, never hidden or guessed) */
  unmatched?: boolean;
}

export interface FlowNode {
  id: string;
  kind: NodeKind;
  /** raw identifier: a function name, a file path, a schema name; null when the UI should use the kind's label */
  title: string | null;
  state: NodeState;
  source: Source;
  refs: FileRef[];
  facts: Fact[];
  results: ResultItem[];
  /** main column (input → … → evaluation) or the side column (tests, checks, docs, helpers, runner) */
  lane: "main" | "side";
}

/** Why an edge exists. Every edge carries the evidence that justifies it; no evidence, no edge. */
export type EdgeReason =
  | "contract"        // manifest declares it (input_schema → entrypoint → output_schema)
  | "platform_check"  // the platform validates the data at this step (API run / evaluation harness)
  | "imports"         // `from main import run` (or similar) in the file
  | "calls"           // a call to a function defined in the same file (text scan)
  | "mentions"        // a document names the file (e.g. SKILL.md mentions scripts/cli.py)
  | "evaluates";      // eval cases are run against the entrypoint by the platform harness

export interface FlowEdge {
  from: string;
  to: string;
  reason: EdgeReason;
  source: Source;
  /** where the evidence is; `text` is the evidence line, trimmed */
  evidence: FileRef & { text?: string };
}

export type FlowWarning =
  | "no_report"          // no stored validation report: every executed result is "not executed"
  | "sandbox_not_run"    // a report exists but the sandbox did not run (not_run / unavailable)
  | "sandbox_error"      // the sandbox failed to run the package
  | "scan_approximate"   // the Python scan hit something it cannot read reliably (see PyScan.warnings)
  | "file_unavailable"   // a file the flow needs could not be loaded
  | "validation_failed"; // the version failed validation; shown as-is

export interface Flow {
  kind: "code" | "instructions";
  nodes: FlowNode[];
  edges: FlowEdge[];
  warnings: FlowWarning[];
}
