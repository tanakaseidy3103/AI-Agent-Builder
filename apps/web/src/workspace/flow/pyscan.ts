/**
 * Approximate, dependency-free reader for the Python files of a Skill package. It is a TEXT scan, not a parser:
 * - string literals and comments are blanked first (positions and line numbers are preserved), so `run(` inside a
 *   docstring or a string is not mistaken for a call;
 * - `def` / `class` blocks end at the next non-blank line indented at or left of the header (multi-line signatures and
 *   decorators are handled);
 * - a call is `name(` where `name` is a function defined at module level in the same file and is not an attribute
 *   (`obj.name(` and `self.name(` are NOT counted).
 * Not detected: calls through variables, callbacks passed by name, getattr, imports re-exported elsewhere, code built
 * at run time. Everything it returns is "scanned": evidence that the text exists, never proof that it runs.
 */

export interface PyImport { line: number; end: number; module: string | null; names: { name: string; alias?: string }[]; text: string }
export interface PyFunction {
  name: string;
  /** dotted name including enclosing classes / functions, e.g. "TestA11y.test_img_without_alt" */
  qualname: string;
  parent: string | null;
  parentKind: "class" | "function" | null;
  /** line of the `def` keyword; `start` includes decorators */
  line: number; start: number; end: number;
  indent: number;
  params: string;
  decorators: string[];
  isAsync: boolean;
}
export interface PyClass { name: string; qualname: string; line: number; end: number; indent: number }
export interface PyCall { from: string; to: string; line: number; text: string }
export type PyScanWarning = "unterminated_string" | "unbalanced_brackets";
export interface PyScan { functions: PyFunction[]; classes: PyClass[]; imports: PyImport[]; calls: PyCall[]; warnings: PyScanWarning[] }

/** Blank out string contents and comments, keeping quotes, newlines and every character position. */
export function maskPython(src: string): { text: string; unterminated: boolean } {
  const out = src.split("");
  let i = 0;
  let unterminated = false;
  const blank = (k: number) => { if (out[k] !== "\n") out[k] = " "; };
  while (i < src.length) {
    const c = src[i];
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") blank(i++);
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      i += q.length;
      let closed = false;
      while (i < src.length) {
        if (src[i] === "\\") { blank(i); if (i + 1 < src.length) blank(i + 1); i += 2; continue; }
        if (src.startsWith(q, i)) { i += q.length; closed = true; break; }
        if (!triple && src[i] === "\n") break; // an unclosed single-quoted string ends at the line break
        blank(i++);
      }
      if (!closed) unterminated = true;
      continue;
    }
    i++;
  }
  return { text: out.join(""), unterminated };
}

const indentOf = (line: string) => line.length - line.trimStart().length;
const blankLine = (line: string) => line.trim() === "";

/** Index (in `text`) of the bracket closing the one at `open`, or -1. Works on masked text. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    const ch = text[k];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") { depth--; if (depth === 0) return k; }
  }
  return -1;
}

export function scanPython(src: string): PyScan {
  const source = src.replace(/\r\n?/g, "\n");
  const { text, unterminated } = maskPython(source);
  const lines = text.split("\n");
  const orig = source.split("\n");
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) { offsets.push(acc); acc += l.length + 1; }
  const lineAt = (pos: number) => { let lo = 0, hi = offsets.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const warnings = new Set<PyScanWarning>();
  if (unterminated) warnings.add("unterminated_string");

  /** last line (0-based) of the block whose header ends on `headerEnd` and is indented at `indent` */
  const blockEnd = (headerEnd: number, indent: number) => {
    let last = headerEnd;
    for (let j = headerEnd + 1; j < lines.length; j++) {
      if (blankLine(lines[j])) continue;
      if (indentOf(lines[j]) <= indent) break;
      last = j;
    }
    return last;
  };

  type Block = { kind: "class" | "function"; name: string; qualname: string; line: number; end: number; indent: number };
  const blocks: Block[] = [];
  const functions: PyFunction[] = [];
  const classes: PyClass[] = [];
  const parentOf = (line: number, indent: number) =>
    [...blocks].reverse().find((b) => b.line < line && b.end >= line && b.indent < indent) ?? null;

  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[i]);
    const cm = m ? null : /^(\s*)class\s+([A-Za-z_]\w*)\b/.exec(lines[i]);
    if (!m && !cm) continue;
    const indent = (m ?? cm)![1].length;
    // the header ends at the ':' after the signature's closing bracket (or on this line for a class without bases)
    let headerEnd = i;
    let params = "";
    if (m) {
      const open = offsets[i] + m[0].length - 1;
      const close = closing(text, open);
      if (close < 0) { warnings.add("unbalanced_brackets"); continue; }
      params = source.slice(open + 1, close).replace(/\s+/g, " ").trim();
      headerEnd = lineAt(close);
    } else {
      const open = lines[i].indexOf("(");
      if (open >= 0) {
        const close = closing(text, offsets[i] + open);
        if (close < 0) { warnings.add("unbalanced_brackets"); continue; }
        headerEnd = lineAt(close);
      }
    }
    const end = blockEnd(headerEnd, indent);
    const parent = parentOf(i, indent);
    const name = (m ? m[3] : cm![2]);
    const qualname = parent ? `${parent.qualname}.${name}` : name;
    blocks.push({ kind: m ? "function" : "class", name, qualname, line: i, end, indent });
    if (cm) { classes.push({ name, qualname, line: i + 1, end: end + 1, indent }); continue; }
    const decorators: string[] = [];
    let start = i;
    for (let k = i - 1; k >= 0 && lines[k].trimStart().startsWith("@") && indentOf(lines[k]) === indent; k--) {
      decorators.unshift(orig[k].trim());
      start = k;
    }
    functions.push({
      name, qualname, parent: parent?.qualname ?? null, parentKind: parent?.kind ?? null,
      line: i + 1, start: start + 1, end: end + 1, indent, params, decorators, isAsync: !!m![2],
    });
  }

  const imports: PyImport[] = [];
  for (let i = 0; i < lines.length; i++) {
    const im = /^\s*import\s+\S/.test(lines[i]);
    const fm = /^\s*from\s+([\w.]+)\s+import\s+/.exec(lines[i]);
    if (!im && !fm) continue;
    let end = i;
    const paren = lines[i].indexOf("(");
    if (paren >= 0) {
      const close = closing(text, offsets[i] + paren);
      if (close < 0) { warnings.add("unbalanced_brackets"); continue; }
      end = lineAt(close);
    } else {
      while (end < lines.length - 1 && lines[end].trimEnd().endsWith("\\")) end++;
    }
    const joined = orig.slice(i, end + 1).join(" ").replace(/\\\s/g, " ");
    const body = (fm ? joined.slice(joined.indexOf(" import ") + 8) : joined.replace(/^\s*import\s+/, ""))
      .replace(/[()]/g, " ").replace(/#.*$/, "");
    const names = body.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const [name, alias] = s.split(/\s+as\s+/);
      return alias ? { name: name.trim(), alias: alias.trim() } : { name: name.trim() };
    });
    imports.push({ line: i + 1, end: end + 1, module: fm ? fm[1] : null, names, text: orig.slice(i, end + 1).map((l) => l.trim()).join(" ") });
    i = end;
  }

  // calls to module-level functions of this file; each line is attributed to the innermost enclosing function
  const topLevel = new Set(functions.filter((f) => f.parent === null).map((f) => f.name));
  const calls: PyCall[] = [];
  const seen = new Set<string>();
  const innermost = (line: number) =>
    functions.filter((f) => f.line <= line && f.end >= line).sort((a, b) => b.indent - a.indent)[0] ?? null;
  for (let i = 0; i < lines.length; i++) {
    const re = /(?<![\w.])([A-Za-z_]\w*)\s*\(/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(lines[i]))) {
      const name = mm[1];
      if (!topLevel.has(name)) continue;
      if (/\b(def|class)\s+$/.test(lines[i].slice(0, mm.index))) continue; // the definition itself
      const owner = innermost(i + 1);
      // a call written in the owner's own signature (a default value) belongs to the enclosing scope; rare, ignored
      const from = owner?.qualname ?? "<module>";
      const key = `${from}>${name}>${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({ from, to: name, line: i + 1, text: orig[i].trim() });
    }
  }

  return { functions, classes, imports, calls, warnings: [...warnings] };
}

/** 1-based number of the first line containing `needle`, or undefined. */
export function findLine(text: string | undefined, needle: string | RegExp): number | undefined {
  if (!text) return undefined;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const i = lines.findIndex((l) => (typeof needle === "string" ? l.includes(needle) : needle.test(l)));
  return i >= 0 ? i + 1 : undefined;
}

/** The trimmed text of a 1-based line. */
export function lineText(text: string | undefined, line: number | undefined): string | undefined {
  if (!text || !line) return undefined;
  return text.replace(/\r\n?/g, "\n").split("\n")[line - 1]?.trim();
}
