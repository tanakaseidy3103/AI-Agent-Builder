import { expect, it } from "vitest";
import { reached } from "./evidence";

it("verified only when the backend says so, even if every criterion looks passed", () => {
  const all = [{ id: "static", passed: true, detail: "" }, { id: "unit_tests", passed: true, detail: "" }];
  expect(reached("validated", all, true).verified).toBe(false);
  expect(reached("verified", all, true).verified).toBe(true);
});

it("a failed static check stops the ladder at generated", () => {
  expect(reached("validation_failed", [{ id: "static", passed: false, detail: "" }], false))
    .toEqual({ generated: true, validated: false, tested: false, verified: false });
});
