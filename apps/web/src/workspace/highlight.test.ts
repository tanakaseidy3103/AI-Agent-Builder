import { expect, it } from "vitest";
import { highlightLine, langOf } from "./highlight";

const kinds = (line: string, lang: ReturnType<typeof langOf>) =>
  highlightLine(line, lang).filter((t) => t.kind).map((t) => `${t.kind}:${t.text}`);

it("python: keywords, calls, strings, numbers, comments; text is never lost", () => {
  const line = 'def run(data): return {"n": len(x), "k": 3}  # done';
  expect(highlightLine(line, "py").map((t) => t.text).join("")).toBe(line);
  expect(kinds(line, "py")).toEqual(["kw:def", "fn:run", "kw:return", 'str:"n"', "fn:len", 'str:"k"', "num:3", "com:# done"]);
});

it("json keys vs string values, and file languages", () => {
  expect(kinds('  "name": "x", "n": 2, "ok": true', "json")).toEqual(['key:"name"', 'str:"x"', 'key:"n"', "num:2", 'key:"ok"', "num:true"]);
  expect([langOf("scripts/main.py"), langOf("evals/cases.json"), langOf("SKILL.md"), langOf("a.tsx"), langOf("LICENSE")])
    .toEqual(["py", "json", "md", "js", "text"]);
});
