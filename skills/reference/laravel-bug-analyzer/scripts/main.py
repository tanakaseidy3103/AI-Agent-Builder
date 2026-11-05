"""Laravel bug/security pattern scanner. Entry point: run(data) -> dict."""
import re

LINE_RULES = [
    ("sql-injection", "high",
     re.compile(r"(DB::(select|statement|unprepared|insert|update|delete|raw)|->(whereRaw|selectRaw|orderByRaw|havingRaw))\(\s*(\"[^\"]*\$\w+|[^)]*[\"']\s*\.\s*\$\w+)"),
     "SQL built from a variable; use bindings: DB::select('... where id = ?', [$id])"),
    ("unvalidated-mass-assignment", "high",
     re.compile(r"::(create|update|insert)\(\s*\$request->all\(\)\s*\)|->(update|fill)\(\s*\$request->all\(\)\s*\)"),
     "persisting $request->all(); validate first and use $request->validated()"),
    ("mass-assignment-unguarded", "medium",
     re.compile(r"protected\s+\$guarded\s*=\s*\[\s*\]"),
     "$guarded = [] allows mass assignment of every column; declare $fillable"),
    ("debug-left", "low",
     re.compile(r"(?<![\w>:$])(dd|dump|var_dump|ray)\s*\("),
     "debug helper left in code; remove before deploying"),
]
ENV_RE = re.compile(r"(?<![\w>:$])env\s*\(")
FORM_RE = re.compile(r"<form\b[^>]*method\s*=\s*[\"']?(post|put|patch|delete)", re.IGNORECASE)


def _scan(path, src):
    out = []
    for i, line in enumerate(src.splitlines(), 1):
        code = line.split("//", 1)[0] if not path.endswith(".blade.php") else line
        for rule, sev, rx, msg in LINE_RULES:
            if rx.search(code):
                out.append({"file": path, "line": i, "rule": rule, "severity": sev, "message": msg})
        if ENV_RE.search(code) and not path.startswith("config/") and "/config/" not in path:
            out.append({"file": path, "line": i, "rule": "env-outside-config", "severity": "medium",
                        "message": "env() returns null once config is cached; read it in config/*.php and use config()"})
    if path.endswith(".blade.php"):
        for m in FORM_RE.finditer(src):
            end = src.find("</form>", m.end())
            body = src[m.end(): end if end >= 0 else len(src)]
            if "@csrf" not in body and "csrf_field()" not in body and "_token" not in body:
                out.append({"file": path, "line": src.count("\n", 0, m.start()) + 1, "rule": "missing-csrf",
                            "severity": "high", "message": "state-changing form without @csrf; Laravel will reject it (419)"})
    return out


def run(data: dict) -> dict:
    findings = []
    for path in sorted(data.get("files", {})):
        if path.endswith(".php"):
            findings += _scan(path, data["files"][path])
    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: (order[f["severity"]], f["file"], f["line"], f["rule"]))
    by = {s: sum(f["severity"] == s for f in findings) for s in ("high", "medium", "low")}
    return {"findings": findings, "count": len(findings), "by_severity": by}
