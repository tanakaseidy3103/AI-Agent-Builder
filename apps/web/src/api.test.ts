import { expect, it } from "vitest";
import { ApiError, errorText, parseTime, shouldRetry } from "./api";

it("turns FastAPI field errors into readable text instead of raw JSON", () => {
  const body = { detail: [{ type: "string_too_short", loc: ["body", "prompt"], msg: "String should have at least 10 characters" }] };
  expect(errorText(422, body)).toBe("prompt: String should have at least 10 characters");
  expect(errorText(409, { detail: "version is 'validation_failed'" })).toBe("version is 'validation_failed'");
  expect(errorText(500, {})).toBe("HTTP 500");
});

it("does not retry answers that cannot change (404, 409, 422) but retries outages and throttling", () => {
  for (const s of [400, 401, 403, 404, 409, 413, 422]) expect(shouldRetry(0, new ApiError("x", s)), String(s)).toBe(false);
  for (const s of [408, 429, 500, 502, 503]) expect(shouldRetry(0, new ApiError("x", s)), String(s)).toBe(true);
  expect(shouldRetry(0, new TypeError("Failed to fetch"))).toBe(true); // network down
  expect(shouldRetry(3, new ApiError("x", 503))).toBe(false);          // still bounded
});


it("reads an offset-less API timestamp as UTC and keeps explicit offsets", () => {
  expect(parseTime("2026-11-14T02:22:15")).toBe(Date.UTC(2026, 10, 14, 2, 22, 15));
  expect(parseTime("2026-11-14T02:22:15Z")).toBe(Date.UTC(2026, 10, 14, 2, 22, 15));
  expect(parseTime("2026-11-14T11:22:15+09:00")).toBe(Date.UTC(2026, 10, 14, 2, 22, 15));
});
