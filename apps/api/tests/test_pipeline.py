"""Generation pipeline with a deterministic fake LLM. Sandbox is faked here; real sandbox in test_evaluation.py."""
import json
import pytest

from app.llm import LLMError
from app.models import AgentEventRow, GenerationJob, SkillVersion, ValidationRun
from app.skills import sandbox, storage
from app.skills.pipeline import STAGES, extract_blocks, run_generation
from tests.fixtures import CASES, CODE_RESPONSES, CODE_SCRIPT, CODE_TEST, SPEC_CODE, SPEC_INSTR, fenced


def _pass_tests(n=3):
    return sandbox.SandboxResult(True, {"tests": [{"name": f"t{i}", "status": "pass", "detail": ""} for i in range(n)]}, duration_ms=5)


def _evals_from_code(files, entry, cases, t, m):
    ns = {}
    exec(files[entry], ns)  # test double only; production runs this inside the Docker sandbox
    return sandbox.SandboxResult(True, {"cases": [{"name": c["name"], "outputs": [ns["run"](c["input"])] * 2, "error": None,
                                                   "stdout": "", "duration_ms": 1} for c in cases]})


@pytest.fixture
def sbx(monkeypatch):
    calls = {"tests": 0, "evals": 0}

    def tests(*a):
        calls["tests"] += 1
        return _pass_tests()

    def evals(*a):
        calls["evals"] += 1
        return _evals_from_code(*a)
    monkeypatch.setattr(sandbox, "run_tests", tests)
    monkeypatch.setattr(sandbox, "run_evals", evals)
    return calls


def _run(factory, fake, prompt="Create a skill that analyzes React projects", **job_fields):
    with factory() as s:
        job = GenerationJob(prompt=prompt, **job_fields)
        s.add(job)
        s.commit()
        jid = job.id
    run_generation(jid, factory, fake)
    with factory() as s:
        job = s.get(GenerationJob, jid)
        v = s.get(SkillVersion, job.skill_version_id) if job.skill_version_id else None
        return job, v


def test_extract_blocks():
    assert extract_blocks("x\n```python\na = 1\n```\ny\n```py\nb = 2\n```") == ["a = 1\n", "b = 2\n"]
    assert extract_blocks("import re\ndef run(d): return {}") == ["import re\ndef run(d): return {}\n"]
    assert extract_blocks("Sorry, I cannot.") == []


def test_code_skill_end_to_end_is_verified(factory, fake, sbx):
    fake.responses = list(CODE_RESPONSES)
    job, v = _run(factory, fake)
    assert job.status == "completed", job.error
    assert [st["name"] for st in job.stages] == STAGES
    assert all(st["status"] == "passed" for st in job.stages), job.stages
    assert v.status == "verified" and v.kind == "code"
    files = storage.read_package(v.storage_key)
    assert {"SKILL.md", "manifest.json", "scripts/main.py", "scripts/cli.py", "tests/test_main.py", "evals/cases.json"} <= set(files)
    assert files["scripts/main.py"] == CODE_SCRIPT  # fenced block extracted exactly, no JSON escaping
    assert sbx == {"tests": 1, "evals": 1}
    with factory() as s:
        run = s.query(ValidationRun).one()
        assert (run.model, run.tests_total, run.tests_passed, run.evals_total, run.evals_passed) == ("fake", 3, 3, 2, 2)
        assert [c["id"] for c in run.report["criteria"]] == ["static", "unit_tests", "eval_cases"]


def test_events_mirror_real_stages(factory, fake, sbx):
    fake.responses = list(CODE_RESPONSES)
    job, _ = _run(factory, fake)
    with factory() as s:
        evs = s.query(AgentEventRow).filter_by(run_id=job.id).order_by(AgentEventRow.id).all()
    started = [e.message.split(":")[0] for e in evs if e.message.endswith("started") or "started (" in e.message]
    assert started[:4] == ["analyze", "specify", "plan", "generate_files"]
    assert {e.agent_id for e in evs} == {"architect", "coder", "reviewer", "tester", "packager"}
    assert evs[-1].agent_id == "packager" and evs[-1].state == "completed"


def test_tester_starts_only_after_the_reviewer_finished(factory, fake, sbx):
    # Agent Office derives who is working from these events: two roles must never look active at once
    bad = fenced("import subprocess\ndef run(d):\n    return {}\n")
    fake.responses = [SPEC_CODE, {"cases": CASES}, bad, fenced(CODE_TEST), fenced(CODE_SCRIPT) + fenced(CODE_TEST)]
    job, v = _run(factory, fake)
    assert v.status == "verified"
    with factory() as s:
        msgs = [e.message for e in s.query(AgentEventRow).filter_by(run_id=job.id).order_by(AgentEventRow.id)]
    r1 = [m for m in msgs if "round 1/" in m]
    assert r1[0].startswith("static_validation: started") and r1[1].startswith("static_validation: failed")
    assert not any(m.startswith("sandbox_tests: started (round 1/") for m in msgs)  # failed review: tester never started
    r2 = [m for m in msgs if "round 2/" in m]
    assert [m.split(" (")[0].split(" —")[0] for m in r2[:3]] == ["static_validation: started", "static_validation: passed", "sandbox_tests: started"]
    assert msgs[msgs.index(r1[1]) + 1].startswith("sandbox_tests: skipped")
    assert "generate_files: started (repair 1)" in msgs


def test_instruction_skill_has_no_code_and_is_only_validated(factory, fake, sbx):
    fake.responses = [SPEC_INSTR]
    job, v = _run(factory, fake, "Write commit messages from diffs please")
    assert job.status == "completed"
    assert v.status == "validated" and v.kind == "instructions"
    assert not any(p.endswith(".py") for p in storage.read_package(v.storage_key))
    st = {x["name"]: x["status"] for x in job.stages}
    assert st["test_generation"] == st["sandbox_tests"] == st["evaluate"] == "skipped"
    assert sbx == {"tests": 0, "evals": 0}


def test_llm_unavailable_fails_honestly(factory, fake):
    fake.responses = [LLMError("Ollama unreachable at http://localhost:11434: ConnectError")]
    job, v = _run(factory, fake)
    assert job.status == "failed" and v is None
    assert "unreachable" in job.error
    assert {x["name"]: x["status"] for x in job.stages}["analyze"] == "failed"


def test_bad_code_is_repaired_with_real_failure_feedback(factory, fake, sbx):
    bad = fenced("import subprocess\ndef run(d):\n    return {}\n")
    fake.responses = [SPEC_CODE, {"cases": CASES}, bad, fenced(CODE_TEST), fenced(CODE_SCRIPT) + fenced(CODE_TEST)]
    job, v = _run(factory, fake)
    assert v.status == "verified"
    fix_prompt = fake.calls[4][1]
    assert "python.policy:scripts/main.py" in fix_prompt and "subprocess" in fix_prompt
    with factory() as s:
        assert s.query(ValidationRun).one().report["repair_rounds"] == 1


def test_repair_budget_is_bounded_and_failure_is_kept(factory, fake, sbx, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "max_repair_rounds", 2)
    # a different failure each round, so the no-progress stop does not trigger and the budget is what ends the loop
    bad = [fenced(f"import {mod}\ndef run(d):\n    return {{}}\n") for mod in ("subprocess", "socket", "ctypes")]
    fake.responses = [SPEC_CODE, {"cases": CASES}, bad[0], fenced(CODE_TEST), bad[1] + fenced(CODE_TEST), bad[2] + fenced(CODE_TEST)]
    job, v = _run(factory, fake)
    assert job.status == "completed"
    assert v.status == "validation_failed"  # stored for inspection, never promoted
    assert len(fake.calls) == 6 and fake.responses == []
    assert {x["name"]: x["status"] for x in job.stages}["static_validation"] == "failed"


def test_sandbox_test_failure_traceback_reaches_the_model(factory, fake, monkeypatch):
    results = iter([
        sandbox.SandboxResult(True, {"tests": [{"name": "t", "status": "fail", "detail": "AssertionError: 2 != 1"}] * 3}),
        _pass_tests(),
    ])
    monkeypatch.setattr(sandbox, "run_tests", lambda *a: next(results))
    monkeypatch.setattr(sandbox, "run_evals", _evals_from_code)
    fake.responses = list(CODE_RESPONSES) + [fenced(CODE_SCRIPT) + fenced(CODE_TEST)]
    _, v = _run(factory, fake)
    assert v.status == "verified"
    assert "AssertionError: 2 != 1" in fake.calls[4][1]


def test_unrepairable_manifest_problem_stops_without_wasting_calls(factory, fake, sbx):
    fake.responses = [SPEC_CODE | {"external_services": ["GitHub API"]}, {"cases": CASES}, fenced(CODE_SCRIPT), fenced(CODE_TEST)]
    job, v = _run(factory, fake)
    assert v.status == "validation_failed"
    assert len(fake.calls) == 4  # no repair attempted: network permission can't be fixed by code
    assert "network" in v.manifest["permissions"]


def test_invalid_output_schema_gets_spec_repair(factory, fake, sbx):
    fake.responses = [SPEC_CODE | {"output_schema": {"type": "array"}}] + list(CODE_RESPONSES)
    job, v = _run(factory, fake)
    assert "schema repair" in job.stages[0]["detail"]
    assert v.status == "verified"


def test_user_requested_kind_overrides_model(factory, fake, sbx):
    fake.responses = [SPEC_INSTR | {"name": "Counter", "input_schema": SPEC_CODE["input_schema"],
                                    "output_schema": SPEC_CODE["output_schema"]}] + CODE_RESPONSES[1:]
    _, v = _run(factory, fake, "count things in files", requested_kind="code")
    assert 'kind="code"' in fake.calls[0][1]
    assert v.kind == "code"


def test_approved_plan_skips_analysis_call(factory, fake, sbx):
    fake.responses = CODE_RESPONSES[1:]
    job, v = _run(factory, fake, "analyze react", approved_spec=SPEC_CODE)
    assert job.stages[0]["detail"] == "using the plan approved by the user"
    assert v.status == "verified" and len(fake.calls) == 3


def test_same_name_creates_new_version_not_overwrite(factory, fake, sbx):
    fake.responses = [SPEC_INSTR, SPEC_INSTR]
    _, v1 = _run(factory, fake, "commit messages one two")
    _, v2 = _run(factory, fake, "commit messages three four")
    assert (v1.version, v2.version) == ("0.1.0", "0.2.0")
    assert v1.skill_id == v2.skill_id and v1.storage_key != v2.storage_key


def test_repair_cannot_replace_failing_assertions_with_trivial_tests(factory, fake, monkeypatch):
    monkeypatch.setattr(sandbox, "run_tests", lambda *a: sandbox.SandboxResult(
        True, {"tests": [{"name": "t", "status": "fail", "detail": "AssertionError"}] * 3}))
    monkeypatch.setattr(sandbox, "run_evals", _evals_from_code)
    trivial = ("import unittest\nclass T(unittest.TestCase):\n    def test_a(self): self.assertTrue(True)\n"
               "    def test_b(self): self.assertTrue(True)\n    def test_c(self): self.assertTrue(True)\n")
    fake.responses = list(CODE_RESPONSES) + [fenced(CODE_SCRIPT) + fenced(trivial)] * 3
    job, v = _run(factory, fake)
    assert v.status != "verified"
    assert storage.read_package(v.storage_key)["tests/test_main.py"] == CODE_TEST  # frozen
    with factory() as s:
        assert s.query(ValidationRun).one().report["tests_rewritten_in_repair"] == 0


def test_generated_eval_cases_without_expect_fail_and_are_not_repaired(factory, fake, sbx):
    no_expect = [{"name": c["name"], "input": c["input"]} for c in CASES]
    fake.responses = [SPEC_CODE, {"cases": no_expect}, fenced(CODE_SCRIPT), fenced(CODE_TEST)]
    job, v = _run(factory, fake)
    assert v.status == "validation_failed"
    assert len(fake.calls) == 4  # code.evals is unrepairable by the code-fix prompt
    with factory() as s:
        evals = next(c for c in s.query(ValidationRun).one().report["static"]["checks"] if c["id"] == "code.evals")
    assert "need expect.contains" in evals["message"]


def test_unexpected_exception_marks_job_failed(factory, fake, sbx, monkeypatch):
    def disk_full(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(storage, "write_package", disk_full)
    fake.responses = list(CODE_RESPONSES)
    job, v = _run(factory, fake)
    assert job.status == "failed" and "disk full" in job.error and v is None


def test_eval_case_schema_embeds_the_skill_input_schema(factory, fake, sbx):
    fake.responses = list(CODE_RESPONSES)
    _run(factory, fake)
    cases = fake.schemas[1]["properties"]["cases"]  # schemas[0] is the spec
    assert cases["items"]["properties"]["input"] == SPEC_CODE["input_schema"]
    assert cases["minItems"] == 3 and "expect" in cases["items"]["required"]  # 2 required + 1 holdout


def test_failed_eval_feedback_shows_input_expected_and_actual(factory, fake, sbx, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "max_repair_rounds", 1)
    wrong = [{**CASES[0], "expect": {"contains": {"count": 5}}}, CASES[1]]
    fake.responses = [SPEC_CODE, {"cases": wrong}, fenced(CODE_SCRIPT), fenced(CODE_TEST), fenced(CODE_SCRIPT)]
    _, v = _run(factory, fake)
    assert v.status == "validated"  # a wrong expectation is never "repaired" into verified
    fix_prompt = fake.calls[4][1]
    assert "eval inline: output does not contain expect.contains" in fix_prompt
    assert '"App.tsx"' in fix_prompt and 'expected: {"contains": {"count": 5}}' in fix_prompt
    assert 'actual: {"findings": [{"file": "App.tsx"' in fix_prompt and '"count": 1' in fix_prompt


def test_identical_failures_stop_the_repair_loop_and_history_is_recorded(factory, fake, sbx):
    bad = fenced("import subprocess\ndef run(d):\n    return {}\n")
    # budget allows 3 repairs, but round 2 fails exactly like round 1 -> stop after one repair
    fake.responses = [SPEC_CODE, {"cases": CASES}, bad, fenced(CODE_TEST), bad + fenced(CODE_TEST)] + [bad] * 5
    _, v = _run(factory, fake)
    assert v.status == "validation_failed"
    assert len(fake.calls) == 5  # spec, code, cases, tests, one repair
    with factory() as s:
        hist = s.query(ValidationRun).one().report["repair_history"]
    assert [h["round"] for h in hist] == [1, 2]
    assert hist[0]["signature"] == hist[1]["signature"] and "no progress" in hist[1]["stopped"]
    assert any("subprocess" in f for f in hist[0]["failing"])


def test_successful_repair_history_shows_progress(factory, fake, sbx):
    bad = fenced("import subprocess\ndef run(d):\n    return {}\n")
    fake.responses = [SPEC_CODE, {"cases": CASES}, bad, fenced(CODE_TEST), fenced(CODE_SCRIPT) + fenced(CODE_TEST)]
    _, v = _run(factory, fake)
    with factory() as s:
        hist = s.query(ValidationRun).one().report["repair_history"]
    assert [h["status"] for h in hist] == ["validation_failed", "verified"] and hist[1]["failing"] == []


HOLDOUT_CASES = CASES + [{"name": "other-file", "input": {"files": {"B.tsx": "<i onClick={() => x()} />"}},
                          "expect": {"contains": {"count": 1, "findings": [{"file": "B.tsx"}]}}}]


def test_coder_sees_visible_inputs_but_never_expectations_or_the_holdout(factory, fake, sbx):
    fake.responses = [SPEC_CODE, {"cases": HOLDOUT_CASES}, fenced(CODE_SCRIPT), fenced(CODE_TEST)]
    job, v = _run(factory, fake)
    assert v is not None, job.error
    code_prompt = fake.calls[2][1]
    assert "App.tsx" in code_prompt and "A.tsx" in code_prompt  # visible example inputs
    assert "B.tsx" not in code_prompt                            # holdout input hidden
    assert '"expect"' not in code_prompt and '"contains"' not in code_prompt
    stored = json.loads(storage.read_package(v.storage_key)["evals/cases.json"])
    assert stored[-1]["holdout"] is True and v.status == "verified"  # holdout still evaluated, and passes here


def test_code_fitted_to_visible_cases_fails_the_hidden_holdout(factory, fake, sbx, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "max_repair_rounds", 1)
    fitted = fenced("def run(data):\n    n = 1 if 'App.tsx' in data['files'] else 0\n    return {'findings': [{}] * n, 'count': n}\n")
    fake.responses = [SPEC_CODE, {"cases": HOLDOUT_CASES}, fitted, fenced(CODE_TEST), fitted]
    _, v = _run(factory, fake)
    assert v.status != "verified"
    fix_prompt = fake.calls[4][1]
    assert "eval other-file (holdout): failed; details withheld" in fix_prompt
    assert "B.tsx" not in fix_prompt


def test_repair_prompt_tells_the_model_how_to_fix_a_policy_violation(factory, fake, sbx):
    # regression: laravel-bug-analyzer@0.2.0 shelled out to PHPStan and repeated it unchanged
    phpstan = fenced("import subprocess\nimport phpstan\ndef run(d):\n    subprocess.run(['phpstan'])\n    return {}\n")
    fake.responses = [SPEC_CODE, {"cases": CASES}, phpstan, fenced(CODE_TEST), fenced(CODE_SCRIPT) + fenced(CODE_TEST)]
    _, v = _run(factory, fake)
    fix_prompt = fake.calls[4][1]
    assert "forbidden modules ['subprocess']" in fix_prompt and "'phpstan'" in fix_prompt
    assert "how to fix:" in fix_prompt and "cannot run external programs" in fix_prompt
    assert v.status == "verified"  # once the model follows the guidance, verification proceeds normally


def test_eval_expectations_are_shaped_like_the_output_schema(factory, fake, sbx):
    fake.responses = list(CODE_RESPONSES)
    _run(factory, fake)
    contains = fake.schemas[1]["properties"]["cases"]["items"]["properties"]["expect"]["properties"]["contains"]
    assert contains["properties"] == SPEC_CODE["output_schema"]["properties"]
    assert contains["additionalProperties"] is False and "required" not in contains  # a subset, nothing required


def test_cases_schema_falls_back_when_output_schema_has_no_properties():
    from app.skills.pipeline import cases_schema
    contains = cases_schema({"type": "object"}, {"type": "object"})["properties"]["cases"]["items"]["properties"]["expect"]["properties"]["contains"]
    assert contains == {"type": "object"}


def test_tests_are_written_from_the_spec_without_seeing_the_code_or_holdout(factory, fake, sbx):
    fake.responses = [SPEC_CODE, {"cases": HOLDOUT_CASES}, fenced(CODE_SCRIPT), fenced(CODE_TEST)]
    _run(factory, fake)
    tests_prompt = fake.calls[3][1]
    assert "findings.append" not in tests_prompt                          # the generated code is absent
    assert "re.search" not in tests_prompt                                 # implementation details absent
    assert "App.tsx" in tests_prompt and "B.tsx" not in tests_prompt       # visible inputs yes, holdout no
    assert "SPECIFICATION" in fake.calls[3][0]


def test_generated_readme_explains_install_run_and_shows_a_visible_example(factory, fake, sbx):
    fake.responses = [SPEC_CODE, {"cases": HOLDOUT_CASES}, fenced(CODE_SCRIPT), fenced(CODE_TEST)]
    _, v = _run(factory, fake)
    readme = storage.read_package(v.storage_key)["README.md"]
    assert "## Install" in readme and "~/.claude/skills/" in readme
    assert "python scripts/cli.py --dir ./my-project" in readme
    assert "App.tsx" in readme and "B.tsx" not in readme  # example from a visible case, never the holdout


def test_jobs_left_running_by_a_restart_are_marked_failed(factory):
    from app.skills.pipeline import fail_interrupted_jobs
    with factory() as s:
        s.add_all([GenerationJob(prompt="a", status="generating"), GenerationJob(prompt="b", status="draft"),
                   GenerationJob(prompt="c", status="completed")])
        s.commit()
        assert fail_interrupted_jobs(s) == 2
        statuses = sorted(j.status for j in s.query(GenerationJob))
        assert statuses == ["completed", "failed", "failed"]
        assert all("interrupted" in j.error for j in s.query(GenerationJob).filter_by(status="failed"))
