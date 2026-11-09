"""Skill generation pipeline.

prompt → spec → plan → files → static validation → tests → sandbox → evaluation → report → package,
with a bounded repair loop that feeds real failures (static checks, test tracebacks, eval reasons) back to the model.

Every stage is persisted on the GenerationJob. LLM failures abort honestly. Validation failures do not abort:
the package is stored as `validation_failed` so the user can inspect it. Status is decided only by
app.skills.evaluation.full_validation, never by the model.
"""
import hashlib
import json
import re
import time
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.llm import LLMError, LLMProvider, usage_summary
from app.models import GenerationJob, Skill, SkillVersion, ValidationRun, audit, emit_event
from app.skills import storage
from app.skills.evaluation import failures_text, full_validation
from app.skills.package import Manifest, manifest_json, render_skill_md, slugify
from app.skills.templates import CLI, how_to_run
from app.skills.validation import MIN_EVAL_CASES, _schema_ok

STAGES = ["analyze", "specify", "plan", "generate_files", "static_validation",
          "test_generation", "sandbox_tests", "evaluate", "report", "package"]

# Pipeline roles shown in the office view. Each stage is performed by exactly one role.
STAGE_ROLE = {"analyze": "architect", "specify": "architect", "plan": "architect",
              "generate_files": "coder", "static_validation": "reviewer", "test_generation": "tester",
              "sandbox_tests": "tester", "evaluate": "tester", "report": "reviewer", "package": "packager"}
STAGE_STATE = {"analyze": "planning", "specify": "planning", "plan": "planning", "generate_files": "working",
               "static_validation": "testing", "test_generation": "working", "sandbox_tests": "testing",
               "evaluate": "testing", "report": "working", "package": "working"}

# Fails that rewriting code/tests cannot fix: stop repairing instead of burning model calls.
# code.evals: the repair prompt only rewrites main.py/tests, so bad eval cases can never be fixed by it.
UNREPAIRABLE = ("structure.", "manifest.", "skill_md.", "code.evals")
# Test-file failures that justify accepting rewritten tests during repair; otherwise tests stay frozen.
BROKEN_TESTS = ("python.syntax:tests", "python.policy:tests", "python.api:tests", "code.tests")

SPEC_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "description": {"type": "string"},
        "kind": {"type": "string", "enum": ["instructions", "code"]},
        "instructions": {"type": "string"},
        "tools": {"type": "array", "items": {"type": "string"}},
        "permissions": {"type": "array", "items": {"type": "string"}},
        "external_services": {"type": "array", "items": {"type": "string"}},
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
    },
    "required": ["name", "description", "kind", "instructions", "input_schema", "output_schema"],
}
def cases_schema(input_schema: dict, output_schema: dict | None = None) -> dict:
    """Structured-output schema for eval cases. Embeds the Skill's real input_schema so constrained decoding
    cannot emit inputs of the wrong shape (benchmark 20261105-121419: 10/15 llama failures were e.g. files as a list),
    and shapes expect.contains like a subset of the output (benchmark 20261106-075956: 5/30 runs wrote a single
    finding object where the output is {findings: [...]})."""
    props = (output_schema or {}).get("properties")
    contains = ({"type": "object", "properties": props, "additionalProperties": False}  # subset: nothing required
                if isinstance(props, dict) and props else {"type": "object"})
    return {
        "type": "object",
        "properties": {"cases": {"type": "array", "minItems": MIN_EVAL_CASES + 1, "items": {
            "type": "object", "properties": {"name": {"type": "string"}, "input": input_schema,
                                             "expect": {"type": "object", "properties": {"contains": contains},
                                                        "required": ["contains"]}},
            "required": ["name", "input", "expect"]}}},
        "required": ["cases"],
    }

SPEC_SYSTEM = """You design AI Skills: reusable capabilities for AI coding agents (Claude Code, Codex, Cursor).
Return JSON only. Fields:
- name: short title. description: one sentence saying what it does AND when to use it.
- kind: "code" if the task needs deterministic computation over input data (parsing, counting, static analysis,
  checking rules); "instructions" if it is judgement/writing guidance for the agent.
- instructions: markdown steps the agent should follow.
- tools: agent tools needed, e.g. ["Read","Grep"]. permissions: subset of ["compute","read-input-files","llm"].
- external_services: internet APIs or programs the Skill would need (empty if none). Code Skills cannot use any.
- input_schema/output_schema: JSON Schema. Both MUST be {"type":"object","properties":{...},"required":[...]};
  wrap lists in a property, e.g. {"type":"object","properties":{"findings":{"type":"array"},"count":{"type":"integer"}}}.
  For Skills that analyze a project, input is {"files": object mapping path -> source text}.
Code Skills run offline with the Python standard library only: no network, no file writes, no subprocess."""

CODE_SYSTEM = """You write one PYTHON 3.12 module for a Skill. Never JavaScript, even if the Skill analyzes JS/TS:
source files arrive as plain strings in data["files"], analyze them with `re` and string methods.
Rules: define top-level `def run(data: dict) -> dict` returning a dict that matches output_schema.
Standard library only. Forbidden: subprocess, socket, urllib, http, importlib, os.system, os.environ, eval, exec,
open() for writing, printing results. Deterministic (no randomness, no time).
Reply with ONLY one fenced code block:
```python
import re


def run(data: dict) -> dict:
    findings = []
    for path, text in data.get("files", {}).items():
        for i, line in enumerate(text.splitlines(), 1):
            ...
    return {"findings": findings, "count": len(findings)}
```"""

TESTS_SYSTEM = """You write unittest tests from a Skill's SPECIFICATION. You have NOT seen the implementation; it will be
importable as `from main import run` and must return output matching output_schema.
Rules: `import unittest`; one TestCase class; at least 3 test_ methods; every method calls self.assert...;
inputs match input_schema; assert behaviour the specification requires (what must be found, counts, required keys),
using small inputs whose correct answer is unambiguous; stdlib only; no files, no network.
Reply with ONLY one fenced ```python code block."""

# Benchmark C1: correct react-a11y code (right file and line) failed 0/3 eval cases only because expectations demanded
# the case writer's prose, e.g. "img tags without alt attributes" vs "img tag without alt attribute".
CASES_SYSTEM = """Write 3 realistic test cases for this Skill from its SPEC (no code exists yet).
Each case: an input matching input_schema exactly, and the output a CORRECT implementation must contain.
Use expect.contains with only facts that follow unambiguously from the input (e.g. exact counts, file names, line
numbers); a subset of the output is enough. Include at least one case where something must be found.
NEVER put descriptive text in an expectation (rule names, messages, explanations): a correct implementation cannot
know your exact wording. For each expected finding give only its identifying facts, e.g. {"file": "a.tsx", "line": 3}.
Return JSON: {"cases": [{"name": "short-name", "input": {...}, "expect": {"contains": {...}}}, ...]}."""

FIX_SYSTEM = """You repair a generated Skill. You get the spec, the current module (scripts/main.py),
the current tests (tests/test_main.py) and the exact failures from static checks and an isolated sandbox.
Fix the module. The tests are FROZEN unless the failures show the test file itself is broken (syntax, policy, too few tests).
Keep all rules: Python 3.12 stdlib only, def run(data: dict) -> dict, ≥3 tests each with an assertion.
Reply with exactly TWO fenced ```python blocks: first the full scripts/main.py, then the full tests/test_main.py."""

_BLOCK_RE = re.compile(r"```[ \t]*(?:python|py|python3)?[ \t]*\n(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_blocks(text: str) -> list[str]:
    """Deterministically pull code out of a model reply. No guessing beyond fenced blocks / bare code."""
    blocks = [b.strip("\n") + "\n" for b in _BLOCK_RE.findall(text or "")]
    if blocks:
        return blocks
    t = (text or "").strip()
    return [t + "\n"] if t and ("def " in t or "import " in t) else []


class Tracker:
    def __init__(self, session: Session, job: GenerationJob):
        self.s, self.job = session, job
        self.job.stages = [{"name": n, "status": "pending"} for n in STAGES]
        self._t: dict[str, float] = {}

    def start(self, name: str, detail: str = "") -> None:
        self._t[name] = time.monotonic()
        self.job.stage = name
        self._set(name, status="running", detail=detail)
        emit_event(self.s, self.job.id, STAGE_ROLE[name], STAGE_STATE[name], f"{name}: started" + (f" ({detail})" if detail else ""))
        self.s.commit()

    def done(self, name: str, status: str = "passed", detail: str = "") -> None:
        ms = int((time.monotonic() - self._t.get(name, time.monotonic())) * 1000)
        self._set(name, status=status, detail=detail, duration_ms=ms)
        state = "failed" if status == "failed" else "idle"
        emit_event(self.s, self.job.id, STAGE_ROLE[name], state, f"{name}: {status}" + (f" — {detail[:200]}" if detail else ""))
        self.s.commit()

    def _set(self, name: str, **fields) -> None:
        self.job.stages = [{**st, **fields} if st["name"] == name else st for st in self.job.stages]


def build_manifest(spec: dict, slug: str, version: str) -> Manifest:
    kind = spec.get("kind")
    perms = list(spec.get("permissions") or ["compute"])
    if spec.get("external_services") and "network" not in perms:
        perms.append("network")  # truthfully declared: validation will reject it for sandboxed code
    return Manifest(
        id=slug, name=str(spec.get("name", slug))[:80], description=str(spec.get("description", ""))[:1024],
        version=version, kind=kind, tools=list(spec.get("tools") or []), permissions=perms,
        input_schema=spec.get("input_schema") or {"type": "object"},
        output_schema=spec.get("output_schema") or {"type": "object"},
        execution={"entrypoint": "scripts/main.py"} if kind == "code" else None,
        tests={"path": "tests"} if kind == "code" else None,
    )


def render_readme(m: Manifest, cases: list | None) -> str:
    """Deterministic, portable README: what it does, how to install and run it, one real example input."""
    lines = [f"# {m.name}", "", m.description, "",
             f"Version {m.version} · kind `{m.kind}` · origin `{m.origin}` · generated by AI Agent Builder.",
             "Check the Studio's validation report for its status (validated / verified) before relying on it.", "",
             "## Install", "", "Copy this folder into your agent's skills directory, for example "
             "`~/.claude/skills/` (Claude Code) or `~/.agents/skills/` (Codex). The agent reads `SKILL.md`.", ""]
    if m.kind == "code":
        visible = [c for c in cases or [] if isinstance(c, dict) and not c.get("holdout") and "input" in c]
        lines += ["## Run it yourself", "", "Python 3.12, standard library only, no network:", "", "```bash",
                  "python scripts/cli.py input.json      # prints the JSON result"]
        if "files" in m.input_schema.get("properties", {}):
            lines.append("python scripts/cli.py --dir ./my-project   # reads source files from a folder")
        lines += ["```", ""]
        if visible:
            lines += ["Example `input.json`:", "", "```json", json.dumps(visible[0]["input"], indent=2, ensure_ascii=False)[:2000], "```", ""]
        lines += ["Input and output contracts: `manifest.json` (`input_schema`, `output_schema`). Tests: `python -m unittest` "
                  "from `tests/` with `scripts/` on the path.", ""]
    else:
        lines += ["## Use", "", "This is an instruction-only Skill: there is no code to run. Ask your agent to apply it.", ""]
    return "\n".join(lines)


def render_files(m: Manifest, instructions: str, code: str | None, usage: str, tests: str | None,
                 cases: list | None = None) -> dict[str, str]:
    body = instructions.strip()
    if m.kind == "code":
        body += "\n\n" + how_to_run(m.input_schema)
    files = {
        "SKILL.md": render_skill_md(m, body),
        "manifest.json": manifest_json(m),
        "README.md": render_readme(m, cases),
    }
    if m.kind == "code":
        files["scripts/main.py"] = code or ""
        files["scripts/cli.py"] = CLI
        files["docs/usage.md"] = f"# Usage\n\n{usage or 'Call run(data) with input matching manifest.json input_schema.'}\n\n" \
                                 f"## Input schema\n\n```json\n{json.dumps(m.input_schema, indent=2)}\n```\n"
        if tests:
            files["tests/test_main.py"] = tests
        if cases is not None:
            files["evals/cases.json"] = json.dumps(cases, indent=2, ensure_ascii=False) + "\n"
    return files


def round_summary(rnd: int, status: str, report: dict) -> dict:
    # include messages: a different error in the same check is a change, not a lack of progress
    failing = sorted(f"{c['id']}: {c['message']}" for c in report["static"]["checks"] if c["status"] == "fail")
    failing += sorted(f"test:{x['name']}:{x['status']}" for x in report["tests"] if x["status"] != "pass")
    failing += sorted(f"eval:{e['name']}:{';'.join(e['reasons'])}" for e in report["evals"] if e["status"] != "pass")
    sm = report["summary"]
    return {"round": rnd + 1, "status": status, "tests": f"{sm['tests_passed']}/{sm['tests_total']}",
            "evals": f"{sm['evals_passed']}/{sm['evals_total']}", "failing": failing[:20],
            "signature": hashlib.sha256("|".join(failing).encode()).hexdigest()[:12]}


def plan_spec(provider: LLMProvider, prompt: str, kind: str | None) -> dict:
    """analyze + schema repair. Used by the pipeline and by the plan-review endpoint."""
    hint = f'\nThe user requires kind="{kind}".' if kind else ""
    spec = provider.complete_json(SPEC_SYSTEM, f"Skill request:\n{prompt}{hint}", SPEC_SCHEMA)
    if kind:
        spec["kind"] = kind
    bad = [k for k in ("input_schema", "output_schema") if not _schema_ok(spec.get(k))]
    if bad:
        fixed = provider.complete_json(SPEC_SYSTEM, f"Skill request:\n{prompt}{hint}\n\nYour previous spec:\n{json.dumps(spec)}\n\n"
                                       f"Invalid: {bad} must be type object with required ⊆ properties. Return the corrected full spec.",
                                       SPEC_SCHEMA)
        spec = {**fixed, "kind": spec["kind"], "_schema_repaired": True}
    return spec


def run_generation(job_id: str, session_factory: Callable[[], Session], provider: LLMProvider) -> None:
    with session_factory() as s:
        job = s.get(GenerationJob, job_id)
        job.status, job.provider = "generating", provider.name
        t = Tracker(s, job)
        try:
            _pipeline(s, job, t, provider)
        except Exception as e:  # any failure must end the job as failed, never leave it 'generating'
            s.rollback()
            job = s.get(GenerationJob, job_id)
            failed = job.stage or "analyze"
            job.stages = [{**st, "status": "failed", "detail": str(e)[:500]} if st["name"] == failed else st for st in job.stages]
            job.status, job.error = "failed", f"{failed}: {e}"[:2000]
            audit(s, "skill.generate.failed", job_id, stage=failed, error=str(e)[:300])
            emit_event(s, job_id, STAGE_ROLE.get(failed, "architect"), "failed", f"generation failed at {failed}: {str(e)[:200]}")
            s.commit()


def _pipeline(s: Session, job: GenerationJob, t: Tracker, provider: LLMProvider) -> None:
    t.start("analyze")
    if job.approved_spec:
        spec = dict(job.approved_spec)
        t.done("analyze", detail="using the plan approved by the user")
    else:
        spec = plan_spec(provider, job.prompt, job.requested_kind)
        t.done("analyze", detail=f"kind={spec.get('kind')} name={spec.get('name')!r}"
               + ("; 1 schema repair" if spec.get("_schema_repaired") else ""))

    t.start("specify")
    slug = slugify(str(spec.get("name") or "skill"))
    skill = s.scalar(select(Skill).where(Skill.slug == slug))
    version = "0.1.0" if skill is None else f"0.{len(skill.versions) + 1}.0"  # new version, never overwrite
    m = build_manifest(spec, slug, version)
    instructions = str(spec.get("instructions") or m.description)
    t.done("specify", detail=f"{m.id}@{m.version}; kind={m.kind}; permissions={m.permissions}")

    t.start("plan")
    files = render_files(m, instructions, None, "", None)
    plan = list(files) + (["scripts/main.py", "tests/test_main.py", "evals/cases.json"] if m.kind == "code" else [])
    t.done("plan", detail=", ".join(dict.fromkeys(plan)))

    ctx = (f"Skill: {m.name}\nDescription: {m.description}\nInstructions:\n{instructions}\n"
           f"input_schema: {json.dumps(m.input_schema)}\noutput_schema: {json.dumps(m.output_schema)}")
    code = tests = None
    cases: list = []
    t.start("generate_files")
    if m.kind == "code":
        # cases first, from the spec only; the code model then sees example INPUTS (never expectations)
        try:
            cases = provider.complete_json(CASES_SYSTEM, ctx, cases_schema(m.input_schema, m.output_schema)).get("cases", [])
        except LLMError as e:
            cases = []  # validation will report missing eval cases; keep the honest failure visible
            t._set("generate_files", detail=f"eval cases not generated: {e}")
        if len(cases) > MIN_EVAL_CASES:
            cases[-1]["holdout"] = True  # never shown to the model: catches code special-cased to visible cases
        examples = [c["input"] for c in cases if isinstance(c, dict) and not c.get("holdout") and "input" in c]
        code_ctx = ctx + (f"\nExample inputs your run() must handle:\n{json.dumps(examples, ensure_ascii=False)[:3000]}"
                          if examples else "")
        blocks = extract_blocks(provider.complete(CODE_SYSTEM, code_ctx))
        code = blocks[0] if blocks else ""
    files = render_files(m, instructions, code, "", None, cases if m.kind == "code" else None)
    t.done("generate_files", detail=f"{len(files)} files" + (f"; {len(cases)} eval cases" if m.kind == "code" else ""))

    t.start("test_generation")
    if m.kind == "code":
        # spec + visible example inputs only: tests that see the code end up asserting the code's own bugs
        tb = extract_blocks(provider.complete(TESTS_SYSTEM, code_ctx))
        tests = tb[0] if tb else ""
        files = render_files(m, instructions, code, "", tests, cases)
        t.done("test_generation", detail="tests/test_main.py")
    else:
        t.done("test_generation", "skipped", "instruction-only Skill")

    max_rounds = settings.max_repair_rounds if m.kind == "code" else 0
    status, report, rounds, tests_rewritten = "validation_failed", {}, 0, 0
    history: list[dict] = []  # one entry per validation round: what failed, so progress is traceable
    for rnd in range(max_rounds + 1):
        rounds = rnd
        label = f"round {rnd + 1}/{max_rounds + 1}" if m.kind == "code" else ""
        t.start("static_validation", label)

        def static_finished(st: dict, label: str = label) -> None:
            # reviewer hands over to the tester only when static checks are really done
            t.done("static_validation", "passed" if st["failed"] == 0 else "failed",
                   f"{label}: {st['passed']} passed, {st['failed']} failed".strip(": "))
            if m.kind == "code" and st["failed"] == 0:
                t.start("sandbox_tests", label)

        status, report = full_validation(files, provider.name, on_static=static_finished)
        if m.kind == "code":
            sbx, summ = report["sandbox"], report["summary"]
            if sbx["status"] == "ran":
                ok = summ["tests_total"] >= 3 and summ["tests_passed"] == summ["tests_total"]
                t.done("sandbox_tests", "passed" if ok else "failed", f"{label}: {summ['tests_passed']}/{summ['tests_total']} tests passed")
                t.start("evaluate", label)
                ok = summ["evals_total"] > 0 and summ["evals_passed"] == summ["evals_total"]
                t.done("evaluate", "passed" if ok else "failed", f"{label}: {summ['evals_passed']}/{summ['evals_total']} eval cases passed")
            else:
                t.done("sandbox_tests", "skipped", sbx.get("error") or "static validation failed")
                t.start("evaluate")
                t.done("evaluate", "skipped", "sandbox did not run")
        history.append(round_summary(rnd, status, report))
        if status == "verified" or m.kind != "code" or rnd == max_rounds:
            break
        if len(history) >= 2 and history[-1]["signature"] == history[-2]["signature"]:
            history[-1]["stopped"] = "no progress: identical failures in two consecutive rounds"
            break  # another identical repair prompt would most likely return the same code
        hard = [c["id"] for c in report["static"]["checks"] if c["status"] == "fail" and c["id"].startswith(UNREPAIRABLE)]
        if hard or report["sandbox"].get("status") == "unavailable":
            break  # rewriting code cannot fix these; do not pretend
        t.start("generate_files", f"repair {rnd + 1}")
        fix = extract_blocks(provider.complete(FIX_SYSTEM, f"{ctx}\n\nscripts/main.py:\n```python\n{code}```\n\n"
                                               f"tests/test_main.py:\n```python\n{tests}```\n\nFailures:\n{failures_text(report)}"))
        if fix:
            code = fix[0]
            broken = any(c["status"] == "fail" and c["id"].startswith(BROKEN_TESTS) for c in report["static"]["checks"])
            if len(fix) > 1 and broken:  # passing-but-failing assertions can't be rewritten away
                tests, tests_rewritten = fix[1], tests_rewritten + 1
        files = render_files(m, instructions, code, "", tests, cases)
        t.done("generate_files", detail=f"repair {rnd + 1}: {'updated' if fix else 'model returned no code'}")
    if m.kind != "code":
        t.start("sandbox_tests")
        t.done("sandbox_tests", "skipped", "instruction-only Skill")
        t.start("evaluate")
        t.done("evaluate", "skipped", "instruction-only Skill: nothing executable to evaluate")

    t.start("report")
    crit = ", ".join(f"{c['id']}={'pass' if c['passed'] else 'fail'}" for c in report["criteria"])
    report["llm"] = usage_summary(getattr(provider, "usage", []))  # measured, not estimated; None for the test provider
    report["repair_rounds"] = rounds
    report["repair_history"] = history
    report["tests_rewritten_in_repair"] = tests_rewritten
    t.done("report", detail=f"status={status}; {crit}; repair rounds={rounds}")

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
    s.add(ValidationRun.from_report(sv.id, status, report))
    job.skill_version_id, job.status, job.stage = sv.id, "completed", None
    audit(s, "skill.generated", sv.id, slug=slug, version=m.version, status=status, model=provider.name)
    t.done("package", detail=f"{slug}@{m.version} stored ({len(files)} files), status {status}")
    emit_event(s, job.id, "packager", "completed", f"{slug}@{m.version} is {status}")
    s.commit()


def fail_interrupted_jobs(s: Session) -> int:
    """Background jobs run inside the API process; after a restart nothing will ever finish them."""
    stale = list(s.scalars(select(GenerationJob).where(GenerationJob.status.in_(("draft", "generating")))))
    for job in stale:
        job.status, job.stage = "failed", None
        job.error = "interrupted: the API restarted while this job was running. Create the request again."
        audit(s, "skill.generate.interrupted", job.id)
    s.commit()
    return len(stale)
