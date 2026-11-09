import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { EvalVersion } from "../api";
import { LangProvider } from "../i18n";
import { VersionChart, passShare } from "./VersionChart";

afterEach(cleanup);

const v = (version: string, status: EvalVersion["status"], tp: number, tt: number, ep: number, et: number, at: string): EvalVersion => ({
  version_id: version, version, status, kind: "code", origin: "generated", model: "m", runs: 1, tests_total: tt, tests_passed: tp,
  evals_total: et, evals_passed: ep, success_rate: null, duration_ms: 1, validated_at: at, criteria: [], repair_rounds: 0,
});

it("share of real checks passed; null when nothing ran (never shown as 0%)", () => {
  expect(passShare(v("0.1.0", "validated", 2, 3, 1, 3, "a"))).toBe(0.5);
  expect(passShare(v("0.1.0", "validation_failed", 0, 0, 0, 0, "a"))).toBeNull();
});

it("bars in version order, with a table view carrying the same numbers and plain status labels", () => {
  render(<LangProvider lang="en"><VersionChart name="Python Code Analysis" versions={[
    v("0.2.0", "verified", 3, 3, 3, 3, "2026-11-09T02:00:00Z"), v("0.1.0", "validated", 1, 3, 0, 3, "2026-11-08T02:00:00Z"),
  ]} /></LangProvider>);
  expect(screen.getByRole("figure", { name: "Python Code Analysis: checks passed per version" })).toBeTruthy();
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.textContent);
  expect(rows).toEqual(["v0.1.017%1/30/3Validated · not verified", "v0.2.0100%3/33/3Verified"]);
});
