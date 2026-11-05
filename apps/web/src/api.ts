export const API = "/api";

export type StageStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export interface Stage { name: string; status: StageStatus; detail?: string; duration_ms?: number }
export interface Job {
  id: string; prompt: string; requested_kind: string | null;
  status: "draft" | "generating" | "completed" | "failed"; stage: string | null; stages: Stage[];
  error: string | null; provider: string | null; skill_version_id: string | null;
}
export type VersionStatus = "validation_failed" | "validated" | "verified";
export interface Check { id: string; status: "pass" | "fail" | "warn"; message: string }
export interface TestResult { name: string; status: "pass" | "fail" | "error" | "skip"; detail: string }
export interface Report {
  status: VersionStatus; duration_ms: number;
  static: { passed: number; failed: number; warnings: number; checks: Check[] };
  tests: TestResult[];
  sandbox: { status: "ran" | "error" | "unavailable" | "not_run"; error?: string | null; duration_ms?: number; limits?: { memory_mb: number; timeout_s: number } };
}
export interface VersionSummary { id: string; slug: string; version: string; kind: string; status: VersionStatus; file_count: number }
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
export interface Integration { id: string; label: string; scope: string; notes: string }
export interface InstallInfo {
  zip: string; version: string; status: VersionStatus; note: string;
  install: { bash: string; powershell: string };
  replace: { bash: string; powershell: string; warning: string };
  target: { label: string; notes: string };
}
export interface ApiKeyRow { id: string; name: string; prefix: string; created_at: string; revoked_at: string | null }

async function detail(r: Response): Promise<string> {
  try {
    const d = (await r.json()).detail;
    return typeof d === "string" ? d : d?.message ?? JSON.stringify(d);
  } catch {
    return `HTTP ${r.status}`;
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
