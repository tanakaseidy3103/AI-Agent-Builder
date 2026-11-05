"""OpenAPI 3 → API test plan. Entry point: run(data) -> dict."""
import re

METHODS = ("get", "post", "put", "patch", "delete")
SAMPLE = {"string": "example", "integer": 1, "number": 1.5, "boolean": True, "array": [], "object": {}}


def _resolve(spec, node):
    ref = node.get("$ref") if isinstance(node, dict) else None
    if ref and ref.startswith("#/"):
        cur = spec
        for part in ref[2:].split("/"):
            cur = cur.get(part, {}) if isinstance(cur, dict) else {}
        return cur
    return node if isinstance(node, dict) else {}


def _sample_body(spec, schema):
    schema = _resolve(spec, schema)
    props = schema.get("properties", {})
    return {k: SAMPLE.get(_resolve(spec, v).get("type"), "example") for k, v in props.items()}


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def run(data: dict) -> dict:
    spec = data.get("openapi", {})
    tests, warnings = [], []
    if not str(spec.get("openapi", "")).startswith("3"):
        warnings.append("not an OpenAPI 3 document (missing or unsupported 'openapi' version)")
    global_security = bool(spec.get("security"))
    for path in sorted(spec.get("paths", {})):
        item = spec["paths"][path]
        for method in METHODS:
            op = item.get(method)
            if not isinstance(op, dict):
                continue
            op_id = op.get("operationId") or _slug(f"{method} {path}")
            if not op.get("operationId"):
                warnings.append(f"{method.upper()} {path}: no operationId")
            responses = op.get("responses", {})
            ok = sorted(c for c in responses if str(c).startswith("2"))
            if not ok:
                warnings.append(f"{method.upper()} {path}: no 2xx response declared")
            body_schema = _resolve(spec, op.get("requestBody", {})).get("content", {}).get("application/json", {}).get("schema")
            if op.get("requestBody", {}).get("required") and body_schema is None:
                warnings.append(f"{method.upper()} {path}: required body without application/json schema")
            body = _sample_body(spec, body_schema) if body_schema else None
            base = {"method": method.upper(), "path": path}
            tests.append({**base, "id": f"{op_id}:happy-path", "case": "happy-path",
                          "expect_status": ok[0] if ok else "2xx", "request": {"body": body} if body is not None else {}})
            required = _resolve(spec, body_schema).get("required", []) if body_schema else []
            if required:
                missing = {k: v for k, v in body.items() if k != required[0]}
                tests.append({**base, "id": f"{op_id}:missing-required-field", "case": "missing-required-field",
                              "expect_status": "422" if "422" in responses else "400",
                              "request": {"body": missing, "omitted": required[0]}})
            if "{" in path:
                tests.append({**base, "id": f"{op_id}:unknown-id", "case": "unknown-id", "expect_status": "404",
                              "request": {"path_params": {p: "does-not-exist" for p in re.findall(r"\{(\w+)\}", path)}}})
            secured = op.get("security", spec.get("security")) if "security" in op else global_security
            if secured:
                tests.append({**base, "id": f"{op_id}:no-auth", "case": "no-auth", "expect_status": "401",
                              "request": {"headers": {"Authorization": None}}})
    return {"tests": tests, "count": len(tests), "warnings": warnings}
