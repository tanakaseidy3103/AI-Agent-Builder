"""Pipeline contract (2026-11-14), with the deterministic FakeProvider and a faked sandbox (mechanism only: this is not
evidence of model quality; the real-model run is in docs/evidence).

- the spec's rules and error_cases reach the code, tests and eval-case writers, and are documented in SKILL.md;
- tests whose inputs break input_schema (code.tests_inputs) can be rewritten by the repair step (RC-1a), while
  correct tests stay frozen.
"""
from app.models import ValidationRun
from app.skills import pipeline, storage
from tests.fixtures import CASES, CODE_SCRIPT, CODE_TEST, SPEC_CODE, fenced
from tests.test_pipeline import _run, sbx  # noqa: F401  (fixture)

SPEC = {**SPEC_CODE, "rules": ["Report each inline arrow handler once, with its file."],
        "error_cases": ["An empty files object returns no findings and count 0."]}

LIST_INPUT_TESTS = CODE_TEST.replace('run({"files": {"App.tsx": "<b onClick={() => go()} />"}})',
                                     'run([{"files": {"App.tsx": "<b onClick={() => go()} />"}}])')


def test_spec_rules_and_error_cases_reach_every_writer_and_skill_md(factory, fake, sbx):  # noqa: F811
    fake.responses = [SPEC, {"cases": CASES}, fenced(CODE_SCRIPT), fenced(CODE_TEST)]
    job, v = _run(factory, fake)
    assert job.status == "completed" and v.status == "verified"
    writers = {system: user for system, user in fake.calls}
    for system in (pipeline.CASES_SYSTEM, pipeline.CODE_SYSTEM, pipeline.TESTS_SYSTEM):
        assert "Rules:\n- Report each inline arrow handler once" in writers[system]
        assert "Error cases:\n- An empty files object returns no findings" in writers[system]
    skill_md = storage.read_package(v.storage_key)["SKILL.md"]
    assert "## Rules\n\n- Report each inline arrow handler once, with its file." in skill_md
    assert "## When the input is empty or invalid\n\n- An empty files object" in skill_md


def test_tests_with_schema_breaking_inputs_are_rewritten_by_repair(factory, fake, sbx):  # noqa: F811
    """RC-1a: the first tests call run([...]) while input_schema is an object. Static check code.tests_inputs fails, so
    the repair step may replace the test file; the corrected tests are accepted and the Skill reaches `verified`."""
    assert "run([" in LIST_INPUT_TESTS
    fake.responses = [SPEC_CODE, {"cases": CASES}, fenced(CODE_SCRIPT), fenced(LIST_INPUT_TESTS),
                      fenced(CODE_SCRIPT) + fenced(CODE_TEST)]
    job, v = _run(factory, fake)
    assert job.status == "completed" and v.status == "verified"
    with factory() as s:
        report = s.query(ValidationRun).filter_by(skill_version_id=v.id).one().report
    assert report["tests_rewritten_in_repair"] == 1
    first = report["repair_history"][0]
    assert any(f.startswith("code.tests_inputs: tests call run() with input that breaks input_schema") for f in first["failing"])
    assert storage.read_package(v.storage_key)["tests/test_main.py"] == CODE_TEST
    repair_prompt = next(u for sysmsg, u in fake.calls if sysmsg == pipeline.FIX_SYSTEM)
    assert "code.tests_inputs" in repair_prompt and "how to fix: Test inputs must match input_schema exactly" in repair_prompt


def test_correct_tests_stay_frozen_when_only_the_code_is_wrong(factory, fake, sbx):  # noqa: F811
    bad_code = CODE_SCRIPT.replace("findings.append", "pass  #")
    weakened = CODE_TEST.replace('self.assertEqual(out["count"], 1)', 'self.assertIn("count", out)')
    fake.responses = [SPEC_CODE, {"cases": CASES}, fenced(bad_code), fenced(CODE_TEST),
                      fenced(CODE_SCRIPT) + fenced(weakened)]
    job, v = _run(factory, fake)
    with factory() as s:
        report = s.query(ValidationRun).filter_by(skill_version_id=v.id).one().report
    assert report["tests_rewritten_in_repair"] == 0  # the model's weakened tests were not accepted
    assert storage.read_package(v.storage_key)["tests/test_main.py"] == CODE_TEST
