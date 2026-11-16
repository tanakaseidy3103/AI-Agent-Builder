/** Build-time configuration (Vite). Local development keeps the defaults: same-origin "/api" through the Vite proxy.
 * A public demo build sets VITE_API_BASE to the demo backend URL and VITE_DEMO_MODE=true. Never put secrets here:
 * everything in import.meta.env ends up in the public JavaScript bundle. */
export const API = String(import.meta.env.VITE_API_BASE || "/api").replace(/\/+$/, "");
export const DEMO = import.meta.env.VITE_DEMO_MODE === "true";
/** Pages the public demo does not offer: installing into a folder of the host machine. */
export const DEMO_HIDDEN = ["projects"];

/** The demo backend serves the visitor-safe subset of the Studio API under /demo/* (apps/api/app/demo/routes.py). */
export function apiPath(path: string): string {
  return DEMO ? path.replace(/^\/studio\//, "/demo/") : path;
}

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
  sandbox: { status: "ran" | "error" | "unavailable" | "not_run"; error?: string | null;
    kind?: "timeout" | "memory" | "no_result" | "malformed_result" | "load_error" | "infrastructure" | null; duration_ms?: number; limits?: { memory_mb: number; timeout_s: number } };
}
export type AgentId = "architect" | "coder" | "reviewer" | "tester" | "packager";
export interface AgentEvent { id: number; agent_id: AgentId; run_id: string; state: string; message: string | null; at: string }
export interface VersionSummary { id: string; slug: string; version: string; kind: string; status: VersionStatus; file_count: number; created_at?: string }
export interface Manifest {
  id: string; name: string; description: string; version: string; kind: "code" | "instructions";
  tools: string[]; dependencies: string[]; permissions: string[];
  input_schema: object; output_schema: object; compatibility: string[];
  execution?: { entrypoint: string; timeout_seconds: number; memory_mb: number };
  origin?: "generated" | "reference";
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
    // non-JSON error page: a proxy or tunnel answered because the backend is down (Cloudflare uses 52x/530)
    return [502, 503, 504, 520, 521, 522, 523, 524, 530].includes(r.status) ? OFFLINE : `HTTP ${r.status}`;
  }
}

/** An HTTP error from the API; `status` lets callers (and the retry policy) tell "not found" from "down". */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** Retry policy for queries: a 4xx answer (except 408/429) will not change by asking again. Before the 2026-11 audit
 * an unknown /#/code/<id> link showed "Loading…" for the whole default 3-retry backoff before the 404 message. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) return false;
  return failureCount < 3;
}

/** Shown when the server cannot be reached at all (network error, tunnel down, laptop off). */
export const OFFLINE = DEMO
  ? "The demo server cannot be reached. It runs on a personal laptop and may be offline right now; please try again later."
  : "The API is not reachable. Start the backend (see README).";

// ---- demo visitor session: an anonymous bearer token, kept per browser; created on first use
const TOKEN_KEY = "aab-demo-session";
let token: string | null = null;
let creating: Promise<string> | null = null;

function storedToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

async function demoToken(renew = false): Promise<string> {
  if (!renew) token ??= storedToken();
  if (token && !renew) return token;
  creating ??= (async () => {
    const r = await rawFetch("/demo/session", { method: "POST" });
    if (!r.ok) throw new ApiError(await detail(r), r.status);
    const t = ((await r.json()) as { token: string }).token;
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode: keep it in memory only */ }
    return t;
  })().finally(() => { creating = null; });
  token = await creating;
  return token;
}

// ---- presentation access code (DEMO_ACCESS_CODE on the server): typed by the visitor, kept for this tab only.
// It is a shared code the presenter announces, not a secret of the build: nothing is embedded in the bundle.
const CODE_KEY = "aab-demo-code";
export function demoCode(): string {
  try { return sessionStorage.getItem(CODE_KEY) ?? ""; } catch { return ""; }
}
export function setDemoCode(code: string): void {
  try { if (code) sessionStorage.setItem(CODE_KEY, code); else sessionStorage.removeItem(CODE_KEY); } catch { /* storage blocked */ }
}
/** What /demo/status tells every visitor (public, no session). */
export interface DemoStatus {
  model: string; model_ready: boolean; queue: number; queue_max: number; access_code_required?: boolean;
  limits: { generations_per_session: number; data_ttl_hours: number };
}

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(API + path, init);
  } catch {
    throw new ApiError(OFFLINE, 0);  // fetch only rejects on network failure (DNS, refused, CORS, offline)
  }
}

/** fetch() against the backend, with the demo session header when in demo mode (renewed once on 401). */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const p = apiPath(path);
  const send = async (renew: boolean) => {
    const headers = new Headers(init?.headers);
    if (init?.body) headers.set("Content-Type", "application/json");
    if (DEMO && p.startsWith("/demo/") && p !== "/demo/status") headers.set("X-Demo-Session", await demoToken(renew));
    if (DEMO && p.startsWith("/demo/") && demoCode()) headers.set("X-Demo-Code", demoCode());
    return rawFetch(p, { ...init, headers });
  };
  const r = await send(false);
  return DEMO && r.status === 401 ? send(true) : r;  // expired or unknown session: start a fresh one, once
}

/** Download a file through apiFetch (a plain <a href> cannot send the demo session header). */
export async function download(path: string, fallbackName: string): Promise<void> {
  const r = await apiFetch(path);
  if (!r.ok) throw new ApiError(await detail(r), r.status);
  const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) throw new ApiError(await detail(r), r.status);
  if (r.status === 204) return undefined as T;
  const type = r.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? r.json() : r.text()) as Promise<T>;
}

/** The API stores UTC; SQLite returns it without an offset ("2026-11-14T02:22:15"), which browsers would read as local time. */
export const parseTime = (iso: string) => Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`);
