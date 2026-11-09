import { expect, it } from "vitest";
import { errorText } from "./api";

it("turns FastAPI field errors into readable text instead of raw JSON", () => {
  const body = { detail: [{ type: "string_too_short", loc: ["body", "prompt"], msg: "String should have at least 10 characters" }] };
  expect(errorText(422, body)).toBe("prompt: String should have at least 10 characters");
  expect(errorText(409, { detail: "version is 'validation_failed'" })).toBe("version is 'validation_failed'");
  expect(errorText(500, {})).toBe("HTTP 500");
});
