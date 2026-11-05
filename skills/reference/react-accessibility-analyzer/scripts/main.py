"""Pattern-based accessibility checks for JSX/TSX/HTML. Entry point: run(data) -> dict."""
import re

EXTENSIONS = (".jsx", ".tsx", ".js", ".html")
TAG_RE = re.compile(r"<(img|div|span|a|input)\b((?:[^>{}]|\{[^{}]*\})*)/?>", re.DOTALL)


def _has(attrs, *names):
    return any(re.search(r"(?<![\w-])" + re.escape(n) + r"\s*=", attrs) for n in names)


def _check(tag, attrs):
    if tag == "img" and not _has(attrs, "alt") and "{..." not in attrs:
        return "img-alt", 'add alt="..." (or alt="" if purely decorative)'
    if tag in ("div", "span") and _has(attrs, "onClick"):
        if not _has(attrs, "role") or not _has(attrs, "onKeyDown", "onKeyUp", "onKeyPress"):
            return "click-without-keyboard", 'use <button>, or add role="button", tabIndex={0} and onKeyDown'
    if tag == "a":
        href = re.search(r"(?<![\w-])href\s*=\s*([\"'{])([^\"'}]*)", attrs)
        if href is None or href.group(2).strip() in ("", "#"):
            return "anchor-href", "give the link a real href, or use <button> for actions"
    if tag == "input":
        t = re.search(r"(?<![\w-])type\s*=\s*[\"']([^\"']+)", attrs)
        if not (t and t.group(1).lower() in ("hidden", "submit", "button")) and not _has(attrs, "aria-label", "aria-labelledby", "id"):
            return "input-label", "add aria-label, or an id referenced by <label htmlFor>"
    return None


def run(data: dict) -> dict:
    findings, scanned = [], 0
    for path in sorted(data.get("files", {})):
        if not path.endswith(EXTENSIONS):
            continue
        scanned += 1
        src = data["files"][path]
        for m in TAG_RE.finditer(src):
            res = _check(m.group(1), m.group(2))
            if res:
                line = src.count("\n", 0, m.start()) + 1
                findings.append({"file": path, "line": line, "rule": res[0], "element": m.group(1), "fix": res[1]})
    return {"findings": findings, "count": len(findings), "files_scanned": scanned}
