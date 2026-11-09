/**
 * Tiny per-line highlighter for the file types a Skill package contains. No dependency.
 * shortcut: line-based, so multi-line strings/docstrings are only coloured on lines where they open and close;
 * switch to a real grammar (e.g. a lazy-loaded highlighter) if packages start containing other languages.
 */
export type Token = { text: string; kind?: "kw" | "str" | "com" | "num" | "key" | "fn" };

const PY = new Set("def class return if elif else for while in not and or is None True False import from as with try except finally raise pass break continue lambda yield global nonlocal assert async await del".split(" "));
const JS = new Set("const let var function return if else for while of in new class extends import from export default async await try catch finally throw typeof instanceof null undefined true false this switch case break continue".split(" "));

export function langOf(path: string): "py" | "js" | "json" | "md" | "text" {
  if (path.endsWith(".py")) return "py";
  if (/\.(ts|tsx|js|jsx|mjs)$/.test(path)) return "js";
  if (path.endsWith(".json")) return "json";
  if (/\.(md|ya?ml|toml)$/.test(path)) return "md";
  return "text";
}

const PATTERN: Record<string, RegExp> = {
  py: /(#.*$)|("""|'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)/g,
  js: /(\/\/.*$)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g,
  json: /()("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g,
};

export function highlightLine(line: string, lang: ReturnType<typeof langOf>): Token[] {
  if (lang === "md") {
    if (/^\s*#/.test(line)) return [{ text: line, kind: "kw" }];                // headings
    if (/^\s*[\w-]+:\s/.test(line)) { const i = line.indexOf(":"); return [{ text: line.slice(0, i), kind: "key" }, { text: line.slice(i) }]; }
    return [{ text: line }];
  }
  const rx = PATTERN[lang];
  if (!rx) return [{ text: line }];
  const out: Token[] = [];
  let last = 0;
  for (const m of line.matchAll(rx)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index) });
    const [whole, com, a, b, c, d] = m;
    let kind: Token["kind"];
    if (lang === "json") kind = a ? "key" : b ? "str" : c ? "num" : undefined;
    else kind = com ? "com" : a ? "str" : b ? "num" : c ? (lang === "py" ? PY : JS).has(c) ? "kw" : "fn" : d && (lang === "py" ? PY : JS).has(d) ? "kw" : undefined;
    out.push({ text: whole, kind });
    last = m.index! + whole.length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}
