"""Skill generation pipeline: prompt -> spec -> plan -> files -> validation -> sandbox tests -> report -> package.

Every stage is persisted on the GenerationJob so the UI shows the real state.
LLM failures abort the job honestly; validation failures do not abort: the package is still
stored (status 'generated') so the user can inspect what went wrong.
"""
import json
import time
from collections.abc import Callable

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.llm import LLMError, LLMProvider
from app.models import GenerationJob, Skill, SkillVersion, ValidationRun, audit
from app.skills import sandbox, storage
from app.skills.package import Manifest, manifest_json, render_skill_md, slugify
from app.skills.templates import CLI, how_to_run
from app.skills.validation import _schema_ok, summarize, validate_package

STAGES = ["analyze", "specify", "plan", "generate_files", "static_validation",
          "test_generation", "sandbox_tests", "report", "package"]

SPEC_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "description": {"type": "string"},
        "kind": {"type": "string", "enum": ["instructions", "code"]},
        "instructions": {"type": "string"},
        "tools": {"type": "array", "items": {"type": "string"}},
        "permissions": {"type": "array", "items": {"type": "string"}},
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
    },
    "required": ["name", "description", "kind", "instructions", "input_schema", "output_schema"],
}
CODE_SCHEMA = {"type": "object", "properties": {"code": {"type": "string"}, "usage": {"type": "string"}}, "required": ["code"]}
TESTS_SCHEMA = {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}

SPEC_SYSTEM = """You design AI Skills: reusable capabilities for AI coding agents (Claude Code, Codex, Cursor).
Return JSON only. Fields:
- name: short title. description: one sentence saying what it does AND when to use it.
- kind: "code" ONLY if the task needs deterministic computation over input data (parsing, counting, static analysis);
  otherwise "instructions".
- instructions: markdown steps the agent should follow.
- tools: agent tools needed, e.g. ["Read","Grep"]. permissions: subset of ["compute","read-input-files","llm"].
- input_schema/output_schema: JSON Schema objects ({"type":"object","properties":{...},"required":[...]}).
  Both MUST have "type":"object" at the top level; wrap lists in a property, e.g.
  {"type":"object","properties":{"findings":{"type":"array"},"count":{"type":"integer"}}}.
  For skills that analyze a project, use input {"files": object mapping path->source text}.
Code skills run offline with the Python standard library only: no network, no file writes, no subprocess."""

CODE_SYSTEM = """Write one PYTHON 3.12 module implementing the Skill. The code must be Python, never JavaScript,
even when the Skill analyzes JavaScript/TypeScript: source files arrive as plain text strings, so analyze them with
`re` and string methods. Do not import any third-party package or invent helper libraries.
Rules: define top-level `def run(data: dict) -> dict` that takes input matching input_schema and returns a dict matching
output_schema. Standard library only. Forbidden: subprocess, socket, urllib, http, os.system, os.environ, eval, exec,
open() for writing, network access. Must be deterministic.
Example shape (adapt to the Skill):
import re

PATTERN = re.compile(r"something")


def run(data: dict) -> dict:
    findings = []
    for path, text in data.get("files", {}).items():
        for i, line in enumerate(text.splitlines(), 1):
            if PATTERN.search(line):
                findings.append({"file": path, "line": i, "issue": "...", "recommendation": "..."})
    return {"findings": findings, "count": len(findings)}

Return JSON: {"code": "<module source>", "usage": "<one line>"}."""

TESTS_SYSTEM = """Write Python unittest tests for the module below. The module is importable as `from main import run`.
Rules: `import unittest`; a class extending unittest.TestCase; at least 3 test methods; only stdlib; inputs must match
input_schema; assert only behavior the code clearly implements (types, keys, obvious cases). No network or files.
Return JSON: {"code": "<test module source>"}."""


class Tracker:
    def __init__(self, session: Session, job: GenerationJob):
        self.s, self.job = session, job
        self.job.stages = [{"name": n, "status": "pending"} for n in STAGES]
        self._t = 0.0

    def start(self, name: str) -> None:
        self._t = time.monotonic()
        self.job.stage = name
        self._set(name, status="running")

    def done(self, name: str, status: str = "passed", detail: str = "") -> None:
        self._set(name, status=status, detail=detail, duration_ms=int((time.monotonic() - self._t) * 1000))

    def _set(self, name: str, **fields) -> None:
        # reassign list so SQLAlchemy detects the JSON change
        self.job.stages = [{**st, **fields} if st["name"] == name else st for st in self.job.stages]
        self.s.commit()


def build_manifest(spec: dict, slug: str, version: str) -> Manifest:
    kind = spec.get("kind")
    return Manifest(
        id=slug, name=str(spec.get("name", slug))[:80], description=str(spec.get("description", ""))[:1024],
        version=version, kind=kind, tools=list(spec.get("tools") or []),
        permissions=list(spec.get("permissions") or ["compute"]),
        input_schema=spec.get("input_schema") or {"type": "object"},
        output_schema=spec.get("output_schema") or {"type": "object"},
        execution={"entrypoint": "scripts/main.py"} if kind == "code" else None,
        tests={"path": "tests"} if kind == "code" else None,
    )


def render_files(m: Manifest, instructions: str, code: str | None, usage: str, tests: str | None) -> dict[str, str]:
    body = instructions.strip()
    if m.kind == "code":
        body += "\n\n" + how_to_run(m.input_schema)
    files = {
        "SKILL.md": render_skill_md(m, body),
        "manifest.json": manifest_json(m),
        "README.md": f"# {m.name}\n\n{m.description}\n\nVersion {m.version} · kind `{m.kind}`. "
                     "Generated by AI Agent Builder. See SKILL.md for agent instructions.\n",
    }
    if m.kind == "code":
        files["scripts/main.py"] = code or ""
        files["scripts/cli.py"] = CLI
        files["docs/usage.md"] = f"# Usage\n\n{usage or 'Call run(data) with input matching manifest.json input_schema.'}\n\n" \
                                 f"## Input schema\n\n```json\n{json.dumps(m.input_schema, indent=2)}\n```\n"
        if tests:
            files["tests/test_main.py"] = tests
    return files


def full_validation(files: dict[str, str]) -> tuple[str, dict]:
    """Static checks + sandboxed tests. Returns (version_status, report)."""
    t0 = time.monotonic()
    checks, manifest = validate_package(files)
    report = {"static": summarize(checks), "tests": [], "sandbox": {"status": "not_run"}}
    static_ok = report["static"]["failed"] == 0
    status = "validated" if static_ok else "generated"
    if static_ok and manifest and manifest.kind == "code":
        ex = manifest.execution
        try:
            r = sandbox.run_tests(files, manifest.tests.path if manifest.tests else "tests", ex.timeout_seconds, ex.memory_mb)
            report["sandbox"] = {"status": "ran" if r.ok else "error", "error": r.error, "duration_ms": r.duration_ms,
                                 "stderr_tail": r.stderr_tail[-1000:]}
            report["tests"] = r.data.get("tests", [])
            if r.ok and report["tests"] and all(t["status"] == "pass" for t in report["tests"]):
                status = "verified"
        except sandbox.SandboxUnavailable as e:
            report["sandbox"] = {"status": "unavailable", "error": str(e)}
    report["duration_ms"] = int((time.monotonic() - t0) * 1000)
    report["status"] = status
    return status, report


def _static_errors(files: dict[str, str], prefixes: str | tuple[str, ...]) -> list[str]:
    checks, _ = validate_package(files)
    return [f"{c.id}: {c.message}" for c in checks if c.status == "fail" and c.id.startswith(prefixes)]


def _gen_code(provider: LLMProvider, system: str, user: str, schema: dict, files_for: Callable[[str], dict], prefixes: tuple[str, ...]) -> tuple[dict, int]:
    """Ask the LLM, statically check, and allow ONE repair attempt with the error list."""
    out = provider.complete_json(system, user, schema)
    errors = _static_errors(files_for(out.get("code", "")), prefixes)
    if not errors:
        return out, 0
    fix = provider.complete_json(system, f"{user}\n\nYour previous code:\n{out.get('code','')}\n\nIt failed these checks:\n"
                                 + "\n".join(errors) + "\nReturn corrected JSON.", schema)
    return fix, 1


def run_generation(job_id: str, session_factory: Callable[[], Session], provider: LLMProvider) -> None:
    with session_factory() as s:
        job = s.get(GenerationJob, job_id)
        job.status, job.provider = "running", provider.name
        t = Tracker(s, job)
        try:
            _pipeline(s, job, t, provider)
        except (LLMError, ValidationError, ValueError) as e:
            s.rollback()
            job = s.get(GenerationJob, job_id)
            failed = job.stage
            job.stages = [{**st, "status": "failed", "detail": str(e)[:500]} if st["name"] == failed else st for st in job.stages]
            job.status, job.error = "failed", f"{failed}: {e}"[:2000]
            audit(s, "skill.generate.failed", job_id, stage=failed, error=str(e)[:300])
            s.commit()


def _pipeline(s: Session, job: GenerationJob, t: Tracker, provider: LLMProvider) -> None:
    t.start("analyze")
    hint = f"\nThe user requires kind=\"{job.requested_kind}\"." if job.requested_kind else ""
    spec = provider.complete_json(SPEC_SYSTEM, f"Skill request:\n{job.prompt}{hint}", SPEC_SCHEMA)
    detail = f"kind={spec.get('kind')} name={spec.get('name')!r}"
    if job.requested_kind and spec.get("kind") != job.requested_kind:
        detail += f" (overridden to {job.requested_kind} by user)"
        spec["kind"] = job.requested_kind
    t.done("analyze", detail=detail)

    t.start("specify")
    spec_note = ""
    bad = [k for k in ("input_schema", "output_schema") if not _schema_ok(spec.get(k))]
    if bad:  # one repair attempt for the I/O contract
        fixed = provider.complete_json(SPEC_SYSTEM, f"Skill request:\n{job.prompt}{hint}\n\nYour previous spec:\n"
                                       f"{json.dumps(spec)}\n\nInvalid: {bad} must be type object with required ⊆ properties. "
                                       "Return the corrected full spec.", SPEC_SCHEMA)
        spec = {**fixed, "kind": spec["kind"]}
        spec_note = "; 1 schema repair"
    slug = slugify(str(spec.get("name") or "skill"))
    skill = s.scalar(select(Skill).where(Skill.slug == slug))
    version = "0.1.0" if skill is None else f"0.{len(skill.versions) + 1}.0"  # new version, never overwrite
    m = build_manifest(spec, slug, version)
    instructions = str(spec.get("instructions") or m.description)
    t.done("specify", detail=f"{m.id}@{m.version}; permissions={m.permissions}{spec_note}")

    t.start("plan")
    plan = ["SKILL.md", "manifest.json", "README.md"]
    if m.kind == "code":
        plan += ["scripts/main.py", "scripts/cli.py", "docs/usage.md", "tests/test_main.py"]
    t.done("plan", detail=", ".join(plan))

    t.start("generate_files")
    code, usage, repairs = None, "", 0
    if m.kind == "code":
        ctx = f"Skill: {m.name}\nDescription: {m.description}\nInstructions:\n{instructions}\n" \
              f"input_schema: {json.dumps(m.input_schema)}\noutput_schema: {json.dumps(m.output_schema)}"
        out, repairs = _gen_code(provider, CODE_SYSTEM, ctx, CODE_SCHEMA,
                                 lambda c: render_files(m, instructions, c, "", None), ("python.", "code.entrypoint"))
        code, usage = str(out.get("code", "")), str(out.get("usage", ""))
    files = render_files(m, instructions, code, usage, None)
    t.done("generate_files", detail=f"{len(files)} files" + (f"; {repairs} repair attempt" if repairs else ""))

    t.start("static_validation")
    errs = [e for e in _static_errors(files, "") if not e.startswith("code.tests")]  # tests come next
    t.done("static_validation", "failed" if errs else "passed", "; ".join(errs)[:500] or "all static checks passed")

    t.start("test_generation")
    if m.kind == "code" and not errs:
        tctx = f"input_schema: {json.dumps(m.input_schema)}\nModule main.py:\n{code}"
        tout, r2 = _gen_code(provider, TESTS_SYSTEM, tctx, TESTS_SCHEMA,
                             lambda c: render_files(m, instructions, code, usage, c), ("python.syntax:tests", "python.policy:tests", "code.tests"))
        files = render_files(m, instructions, code, usage, str(tout.get("code", "")))
        t.done("test_generation", detail="tests/test_main.py" + (" (1 repair)" if r2 else ""))
    else:
        t.done("test_generation", "skipped", "instruction-only Skill" if m.kind != "code" else "static validation failed")

    t.start("sandbox_tests")
    status, report = full_validation(files)
    sbx = report["sandbox"]
    if sbx["status"] == "ran":
        n_pass = sum(x["status"] == "pass" for x in report["tests"])
        t.done("sandbox_tests", "passed" if status == "verified" else "failed", f"{n_pass}/{len(report['tests'])} tests passed")
    else:
        t.done("sandbox_tests", "skipped", sbx.get("error") or ("instruction-only Skill" if m.kind != "code" else "static validation failed"))

    t.start("report")
    t.done("report", detail=f"status={status}; {report['static']['passed']} passed, {report['static']['failed']} failed, "
                            f"{report['static']['warnings']} warnings")

    t.start("package")
    if skill is None:
        skill = Skill(slug=slug, name=m.name, description=m.description)
        s.add(skill)
        s.flush()
    sv = SkillVersion(skill_id=skill.id, version=m.version, kind=m.kind, status=status,
                      manifest=json.loads(files["manifest.json"]), storage_key="", file_count=len(files))
    s.add(sv)
    s.flush()
    sv.storage_key = sv.id
    storage.write_package(sv.storage_key, files)
    s.add(ValidationRun(skill_version_id=sv.id, status=status, report=report, duration_ms=report["duration_ms"]))
    job.skill_version_id, job.status, job.stage = sv.id, "completed", None
    audit(s, "skill.generated", sv.id, slug=slug, version=m.version, status=status)
    t.done("package", detail=f"{slug}@{m.version} stored ({len(files)} files)")
