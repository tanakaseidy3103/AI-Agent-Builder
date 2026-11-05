"""Objective validation + evaluation of a package. Decides the version status.

Status definitions (docs/skills.md §2 mirrors this):
  validation_failed  at least one static check failed (malformed, unsafe or incomplete package)
  validated          every static check passed; behaviour NOT proven by execution
                     (always the ceiling for instruction-only Skills)
  verified           code Skill, validated, AND in the sandbox:
                       - ≥3 unit tests ran and all passed
                       - ≥2 eval cases ran and each: raised no error, returned output conforming to
                         output_schema, returned identical output on two runs, and met its `expect` (if any)
The model never sets the status; only these checks do.
"""
import json
import time

from app.skills import sandbox
from app.skills.jsonschema_lite import contains, validate as schema_validate
from app.skills.validation import MIN_TESTS, load_cases, summarize, validate_package


def judge_case(case: dict, rec: dict, output_schema: dict) -> dict:
    reasons = []
    outs = rec.get("outputs", [])
    actual = outs[0] if outs else None
    if rec.get("error"):
        reasons.append(f"raised {rec['error']}")
    elif len(outs) < 2:
        reasons.append("did not complete both runs")
    else:
        if outs[0] != outs[1]:
            reasons.append("non-deterministic: two runs returned different output")
        reasons += [f"output schema: {e}" for e in schema_validate(output_schema, actual)][:5]
        exp = case.get("expect") or {}
        if "equals" in exp and actual != exp["equals"]:
            reasons.append("output != expect.equals")
        if "contains" in exp and not contains(exp["contains"], actual):
            reasons.append("output does not contain expect.contains")
    return {"name": case.get("name"), "input": case.get("input"), "expected": case.get("expect"),
            "actual": actual, "status": "fail" if reasons else "pass", "reasons": reasons,
            "duration_ms": rec.get("duration_ms", 0), "stdout": rec.get("stdout", ""), "trace": rec.get("trace")}


def full_validation(files: dict[str, str], model: str | None = None) -> tuple[str, dict]:
    t0 = time.monotonic()
    checks, manifest = validate_package(files)
    static = summarize(checks)
    report = {"model": model, "static": static, "tests": [], "evals": [],
              "sandbox": {"status": "not_run"}, "criteria": []}
    crit = report["criteria"]
    static_ok = static["failed"] == 0
    crit.append({"id": "static", "passed": static_ok,
                 "detail": f"{static['passed']} passed, {static['failed']} failed"})
    status = "validated" if static_ok else "validation_failed"

    if static_ok and manifest.kind == "code":
        ex = manifest.execution
        try:
            t = sandbox.run_tests(files, manifest.tests.path if manifest.tests else "tests", ex.timeout_seconds, ex.memory_mb)
            report["tests"] = t.data.get("tests", []) if t.ok else []
            e = sandbox.run_evals(files, ex.entrypoint, load_cases(files), ex.timeout_seconds, ex.memory_mb)
            report["sandbox"] = {"status": "ran" if (t.ok and e.ok) else "error",
                                 "error": t.error or e.error or e.data.get("load_error"),
                                 "duration_ms": t.duration_ms + e.duration_ms,
                                 "limits": {"network": "none", "memory_mb": ex.memory_mb, "timeout_s": ex.timeout_seconds}}
            cases = load_cases(files)
            recs = {r["name"]: r for r in e.data.get("cases", [])}
            report["evals"] = [judge_case(c, recs.get(c["name"], {"error": e.data.get("load_error") or e.error or "not run"}),
                                          manifest.output_schema) for c in cases]
        except sandbox.SandboxUnavailable as err:
            report["sandbox"] = {"status": "unavailable", "error": str(err)}

        tests, evals = report["tests"], report["evals"]
        tests_ok = len(tests) >= MIN_TESTS and all(x["status"] == "pass" for x in tests)
        evals_ok = bool(evals) and all(x["status"] == "pass" for x in evals)
        ran = report["sandbox"]["status"] == "ran"
        crit.append({"id": "unit_tests", "passed": ran and tests_ok,
                     "detail": report["sandbox"].get("error") if not ran else
                     f"{sum(x['status'] == 'pass' for x in tests)}/{len(tests)} passed (need ≥{MIN_TESTS}, all passing)"})
        crit.append({"id": "eval_cases", "passed": ran and evals_ok,
                     "detail": report["sandbox"].get("error") if not ran else
                     f"{sum(x['status'] == 'pass' for x in evals)}/{len(evals)} passed (schema, determinism, expectations)"})
        if all(c["passed"] for c in crit):
            status = "verified"

    report["summary"] = {
        "tests_total": len(report["tests"]), "tests_passed": sum(x["status"] == "pass" for x in report["tests"]),
        "evals_total": len(report["evals"]), "evals_passed": sum(x["status"] == "pass" for x in report["evals"]),
    }
    report["duration_ms"] = int((time.monotonic() - t0) * 1000)
    report["status"] = status
    return status, report


def _clip(value: object, limit: int = 600) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + "…"


def failures_text(report: dict) -> str:
    """Human/LLM-readable list of what failed, used by the repair loop and the UI."""
    lines = [f"- {c['id']}: {c['message']}" for c in report["static"]["checks"] if c["status"] == "fail"]
    lines += [f"- test {t['name']} {t['status']}:\n{t['detail'][-800:]}" for t in report["tests"] if t["status"] != "pass"]
    for e in report["evals"]:
        if e["status"] == "pass":
            continue
        # concrete evidence: the model can only fix behaviour it can see (input → expected vs actual)
        lines.append(f"- eval {e['name']}: {'; '.join(e['reasons'])}\n"
                     f"  input: {_clip(e.get('input'))}\n  expected: {_clip(e.get('expected'))}\n"
                     f"  actual: {_clip(e.get('actual'))}" + (f"\n{e['trace'][-600:]}" if e.get("trace") else ""))
    if report["sandbox"].get("status") == "error":
        lines.append(f"- sandbox error: {report['sandbox'].get('error')}")
    return "\n".join(lines)
