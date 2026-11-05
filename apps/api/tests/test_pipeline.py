"""Generation pipeline with a deterministic fake LLM. The sandbox is mocked here; real sandbox in test_sandbox.py."""
import pytest

from app.llm import LLMError
from app.models import GenerationJob, SkillVersion, ValidationRun
from app.skills import sandbox, storage
from app.skills.pipeline import STAGES, run_generation
from tests.fixtures import CODE_FILES, SPEC_CODE, SPEC_INSTR


@pytest.fixture
def sbx_pass(monkeypatch):
    calls = []
    def fake_tests(files, test_dir, timeout, mem):
        calls.append(files)
        return sandbox.SandboxResult(True, {"tests": [{"name": "t1", "status": "pass", "detail": ""}]}, duration_ms=5)
    monkeypatch.setattr(sandbox, "run_tests", fake_tests)
    return calls


def _run(factory, fake, prompt="Create a skill that analyzes React projects"):
    with factory() as s:
        job = GenerationJob(prompt=prompt)
        s.add(job)
        s.commit()
        jid = job.id
    run_generation(jid, factory, fake)
    with factory() as s:
        job = s.get(GenerationJob, jid)
        v = s.get(SkillVersion, job.skill_version_id) if job.skill_version_id else None
        return job, v


def test_code_skill_end_to_end_is_verified(factory, fake, sbx_pass):
    fake.responses = [SPEC_CODE, {"code": CODE_FILES["script"], "usage": "x"}, {"code": CODE_FILES["tests"]}]
    job, v = _run(factory, fake)
    assert job.status == "completed", job.error
    assert [st["name"] for st in job.stages] == STAGES
    assert all(st["status"] == "passed" for st in job.stages), job.stages
    assert v.status == "verified" and v.kind == "code"
    files = storage.read_package(v.storage_key)
    assert {"SKILL.md", "manifest.json", "README.md", "scripts/main.py", "scripts/cli.py",
            "tests/test_main.py", "docs/usage.md"} <= set(files)
    assert files["SKILL.md"].startswith("---\nname: react-performance-analyzer\n")
    assert "scripts/cli.py --dir" in files["SKILL.md"]
    assert len(sbx_pass) == 1  # tests ran in the sandbox, not in-process


def test_instruction_skill_has_no_code_and_is_only_validated(factory, fake, sbx_pass):
    fake.responses = [SPEC_INSTR]
    job, v = _run(factory, fake, "Write commit messages from diffs please")
    assert job.status == "completed"
    assert v.status == "validated" and v.kind == "instructions"
    assert not any(p.endswith(".py") for p in storage.read_package(v.storage_key))
    st = {x["name"]: x["status"] for x in job.stages}
    assert st["test_generation"] == "skipped" and st["sandbox_tests"] == "skipped"
    assert sbx_pass == []


def test_llm_unavailable_fails_honestly(factory, fake):
    fake.responses = [LLMError("Ollama unreachable at http://localhost:11434: ConnectError")]
    job, v = _run(factory, fake)
    assert job.status == "failed" and v is None
    assert "unreachable" in job.error
    assert {x["name"]: x["status"] for x in job.stages}["analyze"] == "failed"


def test_bad_code_gets_one_repair_then_stays_unverified(factory, fake, sbx_pass):
    bad = {"code": "import subprocess\ndef run(d):\n    return {}"}
    fake.responses = [SPEC_CODE, bad, bad]
    job, v = _run(factory, fake)
    assert job.status == "completed"
    assert v.status == "generated"  # stored for inspection, NOT validated
    st = {x["name"]: x for x in job.stages}
    assert st["static_validation"]["status"] == "failed" and "subprocess" in st["static_validation"]["detail"]
    assert "1 repair" in st["generate_files"]["detail"]
    assert len(fake.calls) == 3 and "failed these checks" in fake.calls[2][1]
    assert sbx_pass == []


def test_repair_that_succeeds_verifies(factory, fake, sbx_pass):
    fake.responses = [SPEC_CODE, {"code": "def nope(): pass"}, {"code": CODE_FILES["script"]}, {"code": CODE_FILES["tests"]}]
    _, v = _run(factory, fake)
    assert v.status == "verified"


def test_failing_sandbox_tests_leave_validated(factory, fake, monkeypatch):
    monkeypatch.setattr(sandbox, "run_tests", lambda *a: sandbox.SandboxResult(
        True, {"tests": [{"name": "t", "status": "fail", "detail": "AssertionError"}]}))
    fake.responses = [SPEC_CODE, {"code": CODE_FILES["script"]}, {"code": CODE_FILES["tests"]}]
    job, v = _run(factory, fake)
    assert v.status == "validated"
    assert {x["name"]: x["status"] for x in job.stages}["sandbox_tests"] == "failed"


def test_sandbox_unavailable_is_reported_not_faked(factory, fake, monkeypatch):
    def unavailable(*a):
        raise sandbox.SandboxUnavailable("Docker daemon is not running")
    monkeypatch.setattr(sandbox, "run_tests", unavailable)
    fake.responses = [SPEC_CODE, {"code": CODE_FILES["script"]}, {"code": CODE_FILES["tests"]}]
    job, v = _run(factory, fake)
    assert v.status == "validated"
    sbx = {x["name"]: x for x in job.stages}["sandbox_tests"]
    assert sbx["status"] == "skipped" and "Docker" in sbx["detail"]
    with factory() as s:
        assert s.query(ValidationRun).one().report["sandbox"]["status"] == "unavailable"


def test_invalid_output_schema_gets_spec_repair(factory, fake, sbx_pass):
    bad_spec = SPEC_CODE | {"output_schema": {"type": "array"}}
    fake.responses = [bad_spec, SPEC_CODE, {"code": CODE_FILES["script"]}, {"code": CODE_FILES["tests"]}]
    job, v = _run(factory, fake)
    assert "schema repair" in job.stages[1]["detail"]
    assert v.status == "verified"


def test_user_requested_kind_overrides_model(factory, fake, sbx_pass):
    fake.responses = [SPEC_INSTR | {"name": "Counter"}, {"code": CODE_FILES["script"]}, {"code": CODE_FILES["tests"]}]
    with factory() as s:
        job = GenerationJob(prompt="count things in files", requested_kind="code")
        s.add(job)
        s.commit()
        jid = job.id
    run_generation(jid, factory, fake)
    with factory() as s:
        job = s.get(GenerationJob, jid)
        assert "overridden to code" in job.stages[0]["detail"]
        assert 'kind="code"' in fake.calls[0][1]
        assert s.get(SkillVersion, job.skill_version_id).kind == "code"


def test_same_name_creates_new_version_not_overwrite(factory, fake, sbx_pass):
    fake.responses = [SPEC_INSTR, SPEC_INSTR]
    _, v1 = _run(factory, fake, "commit messages one two")
    _, v2 = _run(factory, fake, "commit messages three four")
    assert (v1.version, v2.version) == ("0.1.0", "0.2.0")
    assert v1.skill_id == v2.skill_id and v1.storage_key != v2.storage_key
