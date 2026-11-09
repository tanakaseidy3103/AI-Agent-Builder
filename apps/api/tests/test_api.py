import io
import zipfile

import pytest

from app.api import studio
from app.auth import _hits
from app.config import settings
from app.skills import sandbox
from app.skills.package import parse_frontmatter
from tests.fixtures import CODE_RESPONSES, CODE_TEST, SPEC_CODE, SPEC_INSTR, fenced
from tests.test_pipeline import _evals_from_code, _pass_tests


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    _hits.clear()


@pytest.fixture
def sbx(monkeypatch):
    monkeypatch.setattr(sandbox, "run_tests", lambda *a: _pass_tests())
    monkeypatch.setattr(sandbox, "run_evals", _evals_from_code)
    def fake_run(files, entry, data, t, m):
        ns = {}
        exec(files[entry], ns)  # test double only; production uses the Docker sandbox
        return sandbox.SandboxResult(True, {"ok": True, "output": ns["run"](data)})
    monkeypatch.setattr(sandbox, "run_entrypoint", fake_run)


def _generate(client, fake, responses, prompt="Analyze React projects for performance"):
    fake.responses = list(responses)
    job = client.post("/studio/skills/generate", json={"prompt": prompt}).json()
    job = client.get(f"/studio/jobs/{job['id']}").json()  # TestClient runs background tasks before returning
    assert job["status"] == "completed", job["error"]
    return job["skill_version_id"]


@pytest.fixture
def code_version(client, fake, sbx):
    return _generate(client, fake, CODE_RESPONSES)


@pytest.fixture
def api_key(client):
    return client.post("/studio/api-keys", json={"name": "test"}).json()["key"]


def test_generate_validates_prompt(client):
    assert client.post("/studio/skills/generate", json={"prompt": "short"}).status_code == 422


def test_version_detail_and_file_preview(client, code_version):
    d = client.get(f"/studio/versions/{code_version}").json()
    assert d["status"] == "verified" and d["validation"]["status"] == "verified"
    assert any(f["path"] == "scripts/main.py" for f in d["files"])
    r = client.get(f"/studio/versions/{code_version}/files/SKILL.md")
    assert r.status_code == 200 and r.text.startswith("---")


@pytest.mark.parametrize("path", ["../manifest.json", "scripts/../../x.py", "%2e%2e/x.md"])
def test_file_preview_blocks_traversal(client, code_version, path):
    assert client.get(f"/studio/versions/{code_version}/files/{path}").status_code in (400, 404)


def test_revalidate_records_new_run(client, code_version):
    r = client.post(f"/studio/versions/{code_version}/validate").json()
    assert r["status"] == "verified" and r["report"]["static"]["failed"] == 0


@pytest.mark.parametrize("target,expected", [
    ("claude-code", "react-performance-analyzer/SKILL.md"),
    ("codex", "react-performance-analyzer/SKILL.md"),
    ("cursor", "react-performance-analyzer/SKILL.md"),
    ("canonical", "react-performance-analyzer/manifest.json"),
])
def test_export_zip_layouts(client, code_version, target, expected):
    r = client.get(f"/studio/versions/{code_version}/export/{target}")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = z.namelist()
    assert expected in names
    assert all(not n.startswith("/") and ".." not in n.split("/") for n in names)
    fm = parse_frontmatter(z.read("react-performance-analyzer/SKILL.md").decode())
    assert fm["name"] == "react-performance-analyzer" and fm["description"]


@pytest.mark.parametrize("target,root", [("claude-code", "$HOME/.claude/skills"), ("codex", "$HOME/.agents/skills"),
                                         ("cursor", ".cursor/skills")])
def test_install_roots_follow_official_docs(client, code_version, target, root):
    assert f'DEST="{root}"' in client.get(f"/studio/versions/{code_version}/install/{target}").json()["install"]["bash"]


def test_export_installs_into_fake_home_and_runs_cli(client, code_version, tmp_path):
    """Extract like the install command does, then run the shipped CLI against a real folder."""
    import subprocess, sys
    z = zipfile.ZipFile(io.BytesIO(client.get(f"/studio/versions/{code_version}/export/claude-code").content))
    dest = tmp_path / ".claude" / "skills"
    z.extractall(dest)
    proj = tmp_path / "proj" / "src"
    proj.mkdir(parents=True)
    (proj / "App.tsx").write_text("<button onClick={() => go()} />")
    out = subprocess.run([sys.executable, str(dest / "react-performance-analyzer/scripts/cli.py"), "--dir", str(proj.parent)],
                         capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    assert '"count": 1' in out.stdout


def test_export_blocked_for_unvalidated(client, fake, sbx):
    bad = fenced("import socket\ndef run(d):\n    return {}\n")
    vid = _generate(client, fake, [SPEC_CODE, {"cases": []}, bad, fenced(CODE_TEST)] + [bad + fenced(CODE_TEST)] * 3)
    assert client.get(f"/studio/versions/{vid}").json()["status"] == "validation_failed"
    assert client.get(f"/studio/versions/{vid}/export/claude-code").status_code == 409


def test_install_instructions_never_overwrite(client, code_version):
    r = client.get(f"/studio/versions/{code_version}/install/claude-code").json()
    assert "already exists" in r["install"]["bash"] and "if [ -e" in r["install"]["bash"]
    assert "Test-Path" in r["install"]["powershell"]
    assert ".bak-" in r["replace"]["bash"] and "cannot confirm" in r["note"]


def test_unknown_target(client, code_version):
    assert client.get(f"/studio/versions/{code_version}/export/vscode").status_code == 404


def test_v1_requires_valid_key(client, code_version):
    assert client.get("/v1/skills").status_code == 401
    assert client.get("/v1/skills", headers={"Authorization": "Bearer aab_wrong"}).status_code == 401


def test_v1_list_get_run(client, code_version, api_key):
    h = {"Authorization": f"Bearer {api_key}"}
    skills = client.get("/v1/skills", headers=h).json()
    assert [s["slug"] for s in skills] == ["react-performance-analyzer"]
    assert client.get("/v1/skills/react-performance-analyzer", headers=h).json()["status"] == "verified"
    r = client.post("/v1/skills/react-performance-analyzer/run", headers=h,
                    json={"input": {"files": {"A.tsx": "<b onClick={() => x()} />"}}}).json()
    assert r["status"] == "completed" and r["output"]["count"] == 1
    assert client.get(f"/v1/runs/{r['run_id']}", headers=h).json()["status"] == "completed"


def test_v1_input_validation(client, code_version, api_key):
    h = {"Authorization": f"Bearer {api_key}"}
    r = client.post("/v1/skills/react-performance-analyzer/run", headers=h, json={"input": {"files": "nope"}})
    assert r.status_code == 422 and "expected object" in str(r.json())
    r = client.post("/v1/skills/react-performance-analyzer/run", headers=h, json={"input": {}})
    assert r.status_code == 422 and "missing required" in str(r.json())


def test_v1_runs_are_private_to_key(client, code_version, api_key):
    other = client.post("/studio/api-keys", json={"name": "other"}).json()["key"]
    r = client.post("/v1/skills/react-performance-analyzer/run", headers={"Authorization": f"Bearer {api_key}"},
                    json={"input": {"files": {}}}).json()
    assert client.get(f"/v1/runs/{r['run_id']}", headers={"Authorization": f"Bearer {other}"}).status_code == 404


def test_revoked_key_rejected(client, code_version):
    k = client.post("/studio/api-keys", json={"name": "x"}).json()
    assert client.delete(f"/studio/api-keys/{k['id']}").status_code == 204
    assert client.get("/v1/skills", headers={"Authorization": f"Bearer {k['key']}"}).status_code == 401
    listed = client.get("/studio/api-keys").json()
    assert listed[0]["revoked_at"] and "key" not in listed[0]  # plaintext never returned again


def test_rate_limit(client, code_version, api_key, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 2)
    h = {"Authorization": f"Bearer {api_key}"}
    codes = [client.get("/v1/skills", headers=h).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_unverified_code_skill_not_runnable(client, fake, api_key, monkeypatch):
    monkeypatch.setattr(sandbox, "run_tests", lambda *a: sandbox.SandboxResult(
        True, {"tests": [{"name": "t", "status": "fail", "detail": "boom"}] * 3}))
    monkeypatch.setattr(sandbox, "run_evals", _evals_from_code)
    _generate(client, fake, CODE_RESPONSES + [fenced("def run(d):\n    return {}\n") + fenced(CODE_TEST)] * 3)
    r = client.post("/v1/skills/react-performance-analyzer/run", headers={"Authorization": f"Bearer {api_key}"},
                    json={"input": {"files": {}}})
    assert r.status_code == 409


def test_instruction_skill_runs_via_llm(client, fake, api_key):
    _generate(client, fake, [SPEC_INSTR], "Write commit messages from diffs")
    fake.responses = ["feat(api): add run endpoint"]
    r = client.post("/v1/skills/commit-message-writer/run", headers={"Authorization": f"Bearer {api_key}"},
                    json={"input": {"task": "added endpoint"}}).json()
    assert r["output"] == {"text": "feat(api): add run endpoint"}
    assert "type(scope)" in fake.calls[-1][0]  # system prompt = SKILL.md body


def test_studio_is_local_only():
    from fastapi import HTTPException, Request
    req = Request({"type": "http", "client": ("203.0.113.5", 1234), "headers": []})
    with pytest.raises(HTTPException) as e:
        studio.require_local(req)
    assert e.value.status_code == 403


def test_audit_log_records_operations(client, code_version, api_key):
    client.get(f"/studio/versions/{code_version}/export/claude-code")
    actions = {a["action"] for a in client.get("/studio/audit").json()}
    assert {"skill.generate.requested", "skill.generated", "skill.exported", "api_key.created"} <= actions


def test_revalidation_during_sandbox_outage_keeps_verified(client, code_version, api_key, monkeypatch):
    def down(*a, **k):
        raise sandbox.SandboxUnavailable("Docker daemon is not running")
    monkeypatch.setattr(sandbox, "run_tests", down)
    r = client.post(f"/studio/versions/{code_version}/validate")
    assert r.status_code == 503 and "status unchanged: verified" in r.json()["detail"]
    assert client.get(f"/studio/versions/{code_version}").json()["status"] == "verified"
    assert client.get("/v1/skills/react-performance-analyzer", headers={"Authorization": f"Bearer {api_key}"}).status_code == 200


@pytest.mark.parametrize("host,code", [("localhost:5173", 200), ("127.0.0.1:8000", 200), ("evil.example", 400),
                                       ("127.0.0.1.evil.example", 400)])
def test_dns_rebinding_hosts_are_rejected(client, host, code):
    assert client.get("/studio/skills", headers={"Host": host}).status_code == code


def test_concurrent_generations_are_limited(client, factory, monkeypatch):
    from app.models import GenerationJob
    monkeypatch.setattr(settings, "max_concurrent_generations", 2)
    with factory() as s:
        s.add_all([GenerationJob(prompt="x" * 12, status="generating"), GenerationJob(prompt="y" * 12, status="draft")])
        s.commit()
    r = client.post("/studio/skills/generate", json={"prompt": "Analyze React projects for performance"})
    assert r.status_code == 429 and r.headers["retry-after"] == "30"


def test_models_lists_installed_ollama_models(client, monkeypatch):
    from app import llm
    monkeypatch.setattr(llm, "installed_models", lambda: ["llama3.2:3b", "qwen2.5-coder:latest"])
    body = client.get("/studio/models").json()
    assert body["installed"] == ["llama3.2:3b", "qwen2.5-coder:latest"] and body["error"] is None


def test_models_reports_ollama_down_instead_of_hiding_it(client, monkeypatch):
    from app import llm
    def down():
        raise llm.LLMError("Ollama unreachable at http://127.0.0.1:11434: ConnectError")
    monkeypatch.setattr(llm, "installed_models", down)
    assert client.get("/studio/models").json()["error"].startswith("Ollama unreachable")


def test_generate_rejects_a_model_that_is_not_installed(client, monkeypatch):
    from app import llm
    monkeypatch.setattr(llm, "installed_models", lambda: ["qwen2.5-coder:latest"])
    r = client.post("/studio/skills/generate", json={"prompt": "Count words in a text file please", "model": "evil; rm -rf /"})
    assert r.status_code == 422 and "not installed" in r.json()["detail"]


def _git_project(tmp_path):
    import subprocess
    root = tmp_path / "shop"
    root.mkdir()
    (root / "package.json").write_text('{"dependencies": {"react": "^18.3.1", "react-dom": "^18.3.1"}}')
    for args in (["init", "-q", "-b", "main"], ["add", "."],
                 ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "init"]):
        subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)
    return root


def test_project_plan_is_read_only_and_describes_exact_files(client, code_version, tmp_path):
    root = _git_project(tmp_path)
    before = sorted(p.as_posix() for p in root.rglob("*") if ".git" not in p.parts)
    plan = client.post(f"/studio/versions/{code_version}/project/plan", json={"path": str(root), "target": "claude-code"}).json()
    assert plan["analysis"]["languages"] == ["JavaScript/TypeScript"] and plan["analysis"]["frameworks"] == ["React"]
    assert plan["analysis"]["git"]["branch"] == "main" and plan["analysis"]["git"]["dirty"] is False
    assert plan["dest"] == ".claude/skills/react-performance-analyzer"
    assert ".claude/skills/react-performance-analyzer/SKILL.md" in [f["path"] for f in plan["files"]]
    assert plan["blockers"] == [] and plan["branch"].startswith("aab/react-performance-analyzer-")
    assert sorted(p.as_posix() for p in root.rglob("*") if ".git" not in p.parts) == before  # nothing written


def test_project_apply_needs_the_plan_token_creates_a_branch_and_never_overwrites(client, code_version, tmp_path):
    import subprocess
    root = _git_project(tmp_path)
    url = f"/studio/versions/{code_version}/project"
    body = {"path": str(root), "target": "claude-code"}
    assert client.post(f"{url}/apply", json=body).status_code == 400                      # no approval
    assert client.post(f"{url}/apply", json={**body, "token": "0" * 32}).status_code == 409  # stale/forged plan
    plan = client.post(f"{url}/plan", json=body).json()
    out = client.post(f"{url}/apply", json={**body, "token": plan["token"]}).json()
    assert (root / ".claude/skills/react-performance-analyzer/SKILL.md").is_file()
    assert len(out["created"]) == len(plan["files"])
    branch = subprocess.run(["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True).stdout.strip()
    assert branch == plan["branch"] and "git branch -D" in out["rollback"]["bash"]
    again = client.post(f"{url}/plan", json=body).json()                                  # second install is blocked
    assert any("already exists" in b for b in again["blockers"])
    assert client.post(f"{url}/apply", json={**body, "token": again["token"]}).status_code == 409


def test_project_install_refuses_dirty_trees_bad_paths_and_failed_skills(client, code_version, fake, sbx, tmp_path):
    root = _git_project(tmp_path)
    (root / "wip.txt").write_text("uncommitted")
    plan = client.post(f"/studio/versions/{code_version}/project/plan", json={"path": str(root), "target": "claude-code"}).json()
    assert any("uncommitted" in b for b in plan["blockers"])
    assert client.post(f"/studio/versions/{code_version}/project/plan", json={"path": "relative/dir", "target": "claude-code"}).status_code == 400
    assert client.post(f"/studio/versions/{code_version}/project/plan", json={"path": str(root), "target": "canonical"}).status_code == 409
    bad = fenced("import socket\ndef run(d):\n    return {}\n")
    vid = _generate(client, fake, [SPEC_CODE, {"cases": []}, bad, fenced(CODE_TEST)] + [bad + fenced(CODE_TEST)] * 3)
    assert client.post(f"/studio/versions/{vid}/project/plan", json={"path": str(root), "target": "claude-code"}).status_code == 409


def test_delete_skill_removes_versions_records_and_package_but_keeps_job_history(client, code_version, factory):
    from app.models import AuditEvent, GenerationJob, Skill, SkillVersion, ValidationRun
    from app.skills import storage
    with factory() as s:
        v = s.get(SkillVersion, code_version)
        skill_id, key = v.skill_id, v.storage_key
    client.get(f"/studio/versions/{code_version}/export/claude-code")   # creates an ExportRecord
    assert storage.read_package(key)
    assert client.delete(f"/studio/skills/{skill_id}").status_code == 204
    assert client.get(f"/studio/versions/{code_version}").status_code == 404
    assert storage.read_package(key) == {}
    with factory() as s:
        assert s.get(Skill, skill_id) is None
        assert s.query(ValidationRun).filter_by(skill_version_id=code_version).count() == 0
        assert all(j.skill_version_id != code_version for j in s.query(GenerationJob))
        assert s.query(AuditEvent).filter_by(action="skill.deleted", target=skill_id).count() == 1
    assert client.delete(f"/studio/skills/{skill_id}").status_code == 404


def test_storage_refuses_to_delete_outside_its_root():
    from app.skills import storage
    for bad in ("", "..", "../x", "a/b"):
        with pytest.raises(ValueError):
            storage.delete_package(bad)


def test_project_analyze_is_read_only(client, tmp_path):
    root = _git_project(tmp_path)
    r = client.post("/studio/projects/analyze", json={"path": str(root)}).json()
    assert r["languages"] == ["JavaScript/TypeScript"] and r["git"]["branch"] == "main"
    assert client.post("/studio/projects/analyze", json={"path": "relative"}).status_code == 400


def test_plan_rejects_a_model_that_is_not_installed(client, monkeypatch):
    from app import llm
    monkeypatch.setattr(llm, "installed_models", lambda: ["qwen2.5-coder:latest"])
    r = client.post("/studio/skills/plan", json={"prompt": "Count words in a text file please", "model": "nope:1b"})
    assert r.status_code == 422
