"""Static Python defect finder (stdlib ast). Entry point: run(data) -> dict."""
import ast

MAX_FUNCTION_LINES = 50


def _finding(path, node, rule, message):
    return {"file": path, "line": getattr(node, "lineno", 1), "rule": rule, "message": message}


def _names_used(tree):
    used = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            used.add(node.id)
        elif isinstance(node, ast.Attribute):
            base = node
            while isinstance(base, ast.Attribute):
                base = base.value
            if isinstance(base, ast.Name):
                used.add(base.id)
    # names re-exported via __all__ count as used
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in node.targets):
            if isinstance(node.value, (ast.List, ast.Tuple)):
                used |= {e.value for e in node.value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)}
    return used


def analyze(path, source):
    tree = ast.parse(source, filename=path)
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            out.append(_finding(path, node, "bare-except", "bare 'except:' also catches KeyboardInterrupt/SystemExit; catch Exception or a specific error"))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.args.defaults + node.args.kw_defaults:
                if isinstance(d, (ast.List, ast.Dict, ast.Set)):
                    out.append(_finding(path, d, "mutable-default", f"function '{node.name}' uses a mutable default argument; use None and create it inside"))
            length = (node.end_lineno or node.lineno) - node.lineno + 1
            if length > MAX_FUNCTION_LINES:
                out.append(_finding(path, node, "long-function", f"function '{node.name}' is {length} lines (> {MAX_FUNCTION_LINES}); split it"))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not node.name.startswith("_"):
            if ast.get_docstring(node) is None and node in tree.body:
                out.append(_finding(path, node, "missing-docstring", f"public '{node.name}' has no docstring"))
    used = _names_used(tree)
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                name = (alias.asname or alias.name).split(".")[0]
                if name != "*" and name not in used and not path.endswith("__init__.py"):
                    out.append(_finding(path, node, "unused-import", f"'{name}' is imported but never used"))
    return out


def run(data: dict) -> dict:
    findings, parse_errors = [], []
    for path in sorted(data.get("files", {})):
        if not path.endswith(".py"):
            continue
        try:
            findings += analyze(path, data["files"][path])
        except SyntaxError as e:
            parse_errors.append(f"{path}:{e.lineno}: {e.msg}")
    findings.sort(key=lambda f: (f["file"], f["line"], f["rule"]))
    return {"findings": findings, "count": len(findings), "parse_errors": parse_errors}
