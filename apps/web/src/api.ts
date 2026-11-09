export const API = "/api";

export type StageStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export interface Stage { name: string; status: StageStatus; detail?: string; duration_ms?: number }
export interface Job {
  id: string; prompt: string; requested_kind: string | null;
  status: "draft" | "generating" | "completed" | "failed"; stage: string | null; stages: Stage[];
  error: string | null; provider: string | null; skill_version_id: string | null; created_at?: string;
}
export type VersionStatus = "validation_failed" | "validated" | "verified";
export interface Check { id: string; status: "pass" | "fail" | "warn"; message: string; hint?: string | null }
export interface TestResult { name: string; status: "pass" | "fail" | "error" | "skip"; detail: string }
export interface EvalResult {
  name: string; status: "pass" | "fail"; reasons: string[]; holdout?: boolean;
  input?: unknown; expected?: unknown; actual?: unknown;
}
export type FailureCategory =
  | "none" | "syntax" | "policy" | "hallucinated_api" | "unsafe_instructions" | "secrets" | "entrypoint" | "test_definition" | "spec_error"
  | "test_failure" | "eval_failure" | "execution_limit" | "infra" | "not_executable";
export interface Report {
  status: VersionStatus; duration_ms: number;
  static: { passed: number; failed: number; warnings: number; checks: Check[] };
  tests: TestResult[];
  evals?: EvalResult[];
  criteria?: { id: string; passed: boolean; detail: string }[];
  llm?: LlmUsage | null;
  failure_category?: FailureCategory;
  repair_rounds?: number;
  sandbox: { status: "ran" | "error" | "unavailable" | "not_run"; error?: string | null; duration_ms?: number; limits?: { memory_mb: number; timeout_s: number } };
}
export type AgentId = "architect" | "coder" | "reviewer" | "tester" | "packager";
export interface AgentEvent { id: number; agent_id: AgentId; run_id: string; state: string; message: string | null; at: string }
export interface VersionSummary { id: string; slug: string; version: string; kind: string; status: VersionStatus; file_count: number; created_at?: string }
export interface Manifest {
  id: string; name: string; description: string; version: string; kind: "code" | "instructions";
  tools: string[]; dependencies: string[]; permissions: string[];
  input_schema: object; output_schema: object; compatibility: string[];
  execution?: { entrypoint: string; timeout_seconds: number; memory_mb: number };
}
export interface VersionDetail extends VersionSummary {
  manifest: Manifest; files: { path: string; size: number }[];
  validation: { id: string; status: VersionStatus; report: Report } | null;
  versions: VersionSummary[];
}
export interface SkillRow { id: string; slug: string; name: string; description: string; latest: VersionSummary | null; versions: number }
export interface Criterion { id: string; passed: boolean; detail: string }
export interface EvalVersion {
  version_id: string; version: string; status: VersionStatus; kind: string; origin: string; model: string | null; runs: number;
  tests_total: number; tests_passed: number; evals_total: number; evals_passed: number; success_rate: number | null;
  duration_ms: number; validated_at: string; criteria: Criterion[]; repair_rounds: number | null;
}
export interface EvalSkill { slug: string; name: string; versions: EvalVersion[] }
export interface OfficeAgent { id: AgentId; name: string; role: string; state: string; current_run: string | null; runs: number; recent: AgentEvent[] }
export interface ProjectAnalysis { root: string; languages: string[]; frameworks: string[]; git: { branch: string | null; head: string | null; dirty: boolean } | null }
export interface Integration { id: string; label: string; scope: string; notes: string }
export interface InstallInfo {
  zip: string; version: string; status: VersionStatus; note: string;
  install: { bash: string; powershell: string };
  replace: { bash: string; powershell: string; warning: string };
  target: { label: string; notes: string };
}
export interface Models {
  default: string; installed: string[]; error: string | null;
  runtime?: { name: string; size: number; size_vram: number; gpu_percent: number | null }[]; // Ollama /api/ps: loaded now
}
/** Measured by Ollama during generation (stored in the report); absent for older reports. */
export interface LlmUsage { calls: number; prompt_tokens: number; output_tokens: number; model_seconds: number; load_seconds: number; tokens_per_second: number | null }
export interface ProjectPlan {
  analysis: ProjectAnalysis;
  target: string; dest: string; files: { path: string; bytes: number }[]; conflicts: string[]; blockers: string[];
  branch: string | null; token: string;
}
export interface ProjectResult { created: string[]; branch: string | null; original_branch: string | null; root: string; rollback: { bash: string; powershell: string } }
export interface ApiKeyRow { id: string; name: string; prefix: string; created_at: string; revoked_at: string | null }

/** A readable message from an API error body. FastAPI field errors arrive as a list; never show users raw JSON. */
export function errorText(status: number, body: unknown): string {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d.map((e: { loc?: unknown[]; msg?: string }) => {
      const field = (e.loc ?? []).filter((x) => x !== "body").join(".");
      return field ? `${field}: ${e.msg ?? "invalid"}` : e.msg ?? "invalid";
    }).join("; ");
  }
  if (d && typeof d === "object" && "message" in d) return String((d as { message: unknown }).message);
  return `HTTP ${status}`;
}

async function detail(r: Response): Promise<string> {
  try {
    return errorText(r.status, await r.json());
  } catch {
    return r.status === 502 || r.status === 504 ? "The API is not reachable. Start the backend (see README)." : `HTTP ${r.status}`;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!r.ok) throw new Error(await detail(r));
  if (r.status === 204) return undefined as T;
  const type = r.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? r.json() : r.text()) as Promise<T>;
}
