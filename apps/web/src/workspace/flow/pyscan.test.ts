import { describe, expect, it } from "vitest";
import bugFinder from "./__fixtures__/python-bug-finder.json";
import a11y from "./__fixtures__/react-accessibility-analyzer.json";
import { findLine, lineText, maskPython, scanPython } from "./pyscan";

const pairs = (s: ReturnType<typeof scanPython>) => s.calls.map((c) => `${c.from}>${c.to}`);

describe("scanPython on real stored Skills", () => {
  // Ground truth: Python's own ast (FunctionDef.lineno / end_lineno) run on the same fixture files on 2026-11-14.
  const AST: [Record<string, string>, string, [string, number, number][]][] = [
    [a11y.files, "scripts/main.py", [["_has", 8, 9], ["_check", 12, 26], ["run", 29, 41]]],
    [a11y.files, "scripts/cli.py", [["collect", 14, 23], ["main", 26, 34]]],
    [a11y.files, "tests/test_main.py", [["rules", 6, 7], ["test_img_without_alt", 11, 13], ["test_clickable_div", 15, 17], ["test_anchor_href", 19, 21],
      ["test_input_label", 23, 26], ["test_line_numbers_and_non_frontend_files", 28, 31]]],
    [bugFinder.files, "scripts/main.py", [["_finding", 15, 17], ["_check", 20, 39], ["run", 42, 54]]],
    [bugFinder.files, "scripts/cli.py", [["collect", 14, 23], ["main", 26, 34]]],
    [bugFinder.files, "tests/test_main.py", [["test_bare_except_is_reported_with_line_and_suggestion", 7, 12], ["test_mutable_default_and_none_comparison", 14, 17],
      ["test_clean_file_has_no_findings", 19, 21], ["test_syntax_error_is_reported_not_raised", 23, 26], ["test_non_python_files_are_ignored", 28, 29]]],
  ];
  it.each(AST.map(([files, path, want], i) => [i, path, files, want] as const))("function ranges match Python's ast (%i: %s)", (_i, path, files, want) => {
    expect(scanPython(files[path]).functions.map((f) => [f.name, f.line, f.end])).toEqual(want);
  });

  it("reference Skill: the calls between helpers; the docstring 'run(data)' is not a call", () => {
    const s = scanPython(a11y.files["scripts/main.py"]);
    expect(s.imports.map((i) => [i.line, i.module, i.names])).toEqual([[2, null, [{ name: "re" }]]]);
    expect(new Set(pairs(s))).toEqual(new Set(["_check>_has", "run>_check"]));
    expect(s.calls.find((c) => c.to === "run")).toBeUndefined(); // only in the docstring
    expect(s.warnings).toEqual([]);
  });

  it("generated Skill: strings in the RULES table are ignored; run → _check → _finding", () => {
    const s = scanPython(bugFinder.files["scripts/main.py"]);
    expect(s.functions.map((f) => f.name)).toEqual(["_finding", "_check", "run"]);
    expect(new Set(pairs(s))).toEqual(new Set(["_check>_finding", "run>_check"]));
    const run = s.functions.find((f) => f.name === "run")!;
    expect(lineText(bugFinder.files["scripts/main.py"], run.line)).toBe("def run(data: dict) -> dict:");
    expect(run.params).toBe("data: dict");
  });

  it("test files: test methods are found inside their class, and `from main import run` is an import of module main", () => {
    const s = scanPython(bugFinder.files["tests/test_main.py"]);
    const tests = s.functions.filter((f) => f.parentKind === "class" && f.name.startsWith("test"));
    expect(tests.map((f) => f.qualname)).toContain("TestPythonBugFinder.test_bare_except_is_reported_with_line_and_suggestion");
    expect(tests).toHaveLength(5);
    expect(s.imports.find((i) => i.module === "main")?.names).toEqual([{ name: "run" }]);
  });
});

describe("scanPython edge cases", () => {
  const SRC = [
    "import os",                       // 1
    "from x import (",                 // 2
    "    a,",                          // 3
    "    b as c,",                     // 4
    ")",                               // 5
    "",                                // 6
    "@decor",                          // 7
    "@other(1)",                       // 8
    "def multi(",                      // 9
    "    x,",                          // 10
    "    y=helper(),",                 // 11
    "):",                              // 12
    "    def inner():",                // 13
    "        return helper()",         // 14
    "    s = \"def fake(): helper()\"", // 15
    "    # helper() in a comment",     // 16
    "    return inner()",              // 17
    "",                                // 18
    "async def helper():",             // 19
    "    return 1",                    // 20
    "",                                // 21
    "class K:",                        // 22
    "    def method(self):",           // 23
    "        return self.helper()",    // 24
    "",                                // 25
    "if __name__ == '__main__':",      // 26
    "    multi(1)",                    // 27
  ].join("\n");
  const s = scanPython(SRC);

  it("decorators, multi-line signature, nested and async functions, methods", () => {
    const multi = s.functions.find((f) => f.name === "multi")!;
    expect([multi.start, multi.line, multi.end]).toEqual([7, 9, 17]);
    expect(multi.decorators).toEqual(["@decor", "@other(1)"]);
    expect(multi.params).toBe("x, y=helper(),");
    expect(s.functions.find((f) => f.name === "inner")).toMatchObject({ qualname: "multi.inner", parent: "multi", parentKind: "function", line: 13, end: 14 });
    expect(s.functions.find((f) => f.name === "helper")).toMatchObject({ isAsync: true, line: 19, end: 20, parent: null });
    expect(s.functions.find((f) => f.name === "method")).toMatchObject({ qualname: "K.method", parentKind: "class" });
    expect(s.classes).toEqual([{ name: "K", qualname: "K", line: 22, end: 24, indent: 0 }]);
  });

  it("calls: strings, comments, attribute calls and non-top-level targets are not calls", () => {
    expect(s.calls.map((c) => `${c.from}>${c.to}@${c.line}`)).toEqual(["multi>helper@11", "multi.inner>helper@14", "<module>>multi@27"]);
  });

  it("parenthesised imports with aliases", () => {
    expect(s.imports).toEqual([
      { line: 1, end: 1, module: null, names: [{ name: "os" }], text: "import os" },
      { line: 2, end: 5, module: "x", names: [{ name: "a" }, { name: "b", alias: "c" }], text: "from x import ( a, b as c, )" },
    ]);
  });

  it("CRLF line endings give the same lines", () => {
    expect(scanPython(SRC.replace(/\n/g, "\r\n")).functions.map((f) => [f.name, f.line, f.end]))
      .toEqual(s.functions.map((f) => [f.name, f.line, f.end]));
  });

  it("reports what it cannot read instead of guessing", () => {
    expect(scanPython('x = """never closed\ndef f():\n    pass\n').warnings).toContain("unterminated_string");
    expect(scanPython('x = """never closed\ndef f():\n    pass\n').functions).toEqual([]); // inside the open string
    const broken = scanPython("def f(a, b:\n    pass\n");
    expect(broken.warnings).toContain("unbalanced_brackets");
    expect(broken.functions).toEqual([]);
  });

  it("masking keeps every position and line", () => {
    const src = "a = 'x#y'  # c\nb = \"\"\"q\nr\"\"\"\n";
    const { text } = maskPython(src);
    expect(text).toHaveLength(src.length);
    expect(text.split("\n")).toHaveLength(src.split("\n").length);
    expect(text).not.toContain("#");
    expect(text).toContain("a = '   '");
  });
});

it("findLine / lineText", () => {
  expect(findLine('{\n  "input_schema": {}\n}', '"input_schema"')).toBe(2);
  expect(findLine("a\nb", /^b$/)).toBe(2);
  expect(findLine(undefined, "x")).toBeUndefined();
  expect(lineText("a\n  b  \n", 2)).toBe("b");
});
