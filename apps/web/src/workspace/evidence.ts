/** The four evidence levels, from stored validation data only. Same meaning as the Inspector's ladder. */
import type { Criterion, VersionStatus } from "../api";

export type Level = "generated" | "validated" | "tested" | "verified";
export const LEVELS: Level[] = ["generated", "validated", "tested", "verified"];

export function reached(status: VersionStatus, criteria: Criterion[], sandboxRan: boolean): Record<Level, boolean> {
  return {
    generated: true,
    validated: criteria.some((c) => c.id === "static" && c.passed),
    tested: sandboxRan,
    verified: status === "verified", // only the backend's verdict, never inferred here
  };
}
