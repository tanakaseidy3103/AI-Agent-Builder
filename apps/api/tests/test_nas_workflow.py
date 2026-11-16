"""NAS Project Memory: adapters, documented capabilities, workflow and API.

MOCKED ENVIRONMENT (SIMULATION): a local copy of hackathons/ugreen-2026/tests/fixtures stands in for a NAS folder and
LocalSimulationAdapter stands in for the platform experts. Passing here is not NAS validation.
The catalog test is real: it reads the official capability catalog from the Uliya Skill Kit when it is available.
"""
import importlib.util
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.nas.adapters import LOCAL_ACTIONS, IntegrationUnavailable, LocalSimulationAdapter, UliyaAdapter
from app.nas.scope import AuthorizedFolder
from app.nas.workflow import run, run_local

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "hackathons" / "ugreen-2026" / "tests" / "fixtures"
pytestmark = pytest.mark.skipif(not FIXTURES.is_dir(), reason="UGREEN fixtures not present")
QUESTION = ("Analyze this project and tell me the current development status, completed decisions, pending tasks, "
            "responsible people, deadlines, risks, and contradictions between documents.")


@pytest.fixture
def nas(tmp_path) -> Path:
    shutil.copytree(FIXTURES, tmp_path / "volume1", ignore=shutil.ignore_patterns("README.md"))
    return tmp_path / "volume1"


@pytest.fixture
def answer(nas) -> dict:
    return run_local(str(nas / "apollo-project"), QUESTION)


def texts(claims):
    return [c["text"] for c in claims]


# ---------------------------------------------------------------- documented capabilities (real catalog)

def _catalog() -> dict | None:
    script = REPO / "hackathons" / "ugreen-2026" / "scripts" / "build_submission.py"
    if not script.is_file():
        return None
    spec = importlib.util.spec_from_file_location("build_submission", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    kit = mod.kit_dir()
    return None if kit is None else json.loads((kit / "data" / "capability-catalog.json").read_text(encoding="utf-8"))


def test_local_adapter_serves_only_documented_read_actions():
    catalog = _catalog()
    if catalog is None:
        pytest.skip("official Uliya Skill Kit not available")
    by = {(c["name"], a["name"]): (c["agent"], a) for c in catalog["clis"] for a in c["actions"]}
    for (cli, action), (agent, params) in LOCAL_ACTIONS.items():
        assert (cli, action) in by, f"{cli} {action} is not in the official catalog"
        official_agent, spec = by[(cli, action)]
        assert official_agent == agent
        assert spec["effect"] == "read" and spec["approval"] == "none"
        assert params <= {p["name"] for p in spec["parameters"]}, (cli, action)


# ---------------------------------------------------------------- adapters

def test_write_and_unknown_actions_are_refused(nas):
    a = LocalSimulationAdapter(AuthorizedFolder(nas / "apollo-project"))
    for cli, action in [("ug-filesystem", "del"), ("ug-filesystem", "echo"), ("ug-knowledge", "save-text"),
                        ("ug-photo", "albums"), ("shell", "exec")]:
        r = a.invoke(cli, action, {"path": "x"})
        assert r.state == "failed" and r.error["code"] == "ACTION_NOT_AVAILABLE"
    assert (nas / "apollo-project" / "x").exists() is False


def test_adapter_scope_cannot_be_widened_by_parameters(nas):
    a = LocalSimulationAdapter(AuthorizedFolder(nas / "apollo-project"))
    r = a.invoke("ug-filesystem", "cat", {"path": "../private-hr/salaries.md"})
    assert r.state == "failed" and r.error["code"] == "SCOPE_DENIED"
    r = a.invoke("ug-filesystem", "find", {"path": "", "root": str(nas)})
    assert r.error["code"] == "PARAMETER_UNSUPPORTED"
    assert not hasattr(a, "folder") or isinstance(type(a).folder, property)  # read-only, no setter
    with pytest.raises(AttributeError):
        a.folder = AuthorizedFolder(nas)


def test_results_use_the_public_envelope_and_states(nas):
    a = LocalSimulationAdapter(AuthorizedFolder(nas / "apollo-project"))
    ok = a.invoke("ug-filesystem", "find", {"path": "", "type": "documents"})
    assert ok.state == "completed" and ok.envelope()["ok"] is True and ok.mode == "SIMULATION"
    assert ok.agent == "file-agent"
    bad = a.invoke("ug-filesystem", "cat", {})
    assert bad.envelope() == {"ok": False, "error": {"code": "PARAMETER_INVALID", "message": "path is required"}}


def test_uliya_adapter_does_not_pretend():
    with pytest.raises(IntegrationUnavailable, match="inside Uliya on the NAS"):
        UliyaAdapter().invoke("ug-filesystem", "find", {"path": "/"})


# ---------------------------------------------------------------- workflow: the Round 2 question

def test_answer_is_labelled_simulation_and_traced(answer):
    assert answer["mode"] == "SIMULATION"
    assert [t["agent"] for t in answer["trace"]] == ["planner", "researcher", "analyst", "reviewer"]
    assert answer["review"]["rejected"] == []
    assert answer["review"]["checked"] > 0


def test_contradiction_resolved_by_later_document(answer):
    pay = next(c for c in answer["conflicts"] if c["topic"] == "payment provider")
    assert [s["value"] for s in pay["statements"]] == ["Provider A", "Provider B"]
    assert pay["current"]["value"] == "Provider B" and pay["current"]["doc_date"] == "2026-04-14"
    assert "Current payment provider: Provider B (stated 2026-04-14)." in texts(answer["inferences"])
    assert any(t.startswith("Decision (superseded): The payment provider is Provider A") for t in texts(answer["confirmed"]))


def test_owners_and_deadlines_are_taken_or_reported_unknown(answer):
    tasks = {c["text"]: c for c in answer["confirmed"] if c["category"] == "task"}
    sandbox = next(c for t, c in tasks.items() if "payment sandbox" in t)
    assert sandbox["owner"] == "Ren Ito" and sandbox["due"] == "2026-03-20"
    invoices = next(c for t, c in tasks.items() if "legacy invoices" in t)
    assert invoices["owner"] is None
    assert any("legacy invoices" in t and t.startswith("Owner of") for t in texts(answer["unknowns"]))


def test_duplicates_are_reported_once_with_all_sources(answer):
    rq2 = [c for c in answer["confirmed"] if "RQ2" in c["text"]]
    assert len(rq2) == 1
    assert {s["path"] for s in rq2[0]["sources"]} == {"plans/project-plan-v1.md", "plans/requirements-copy.md"}


def test_injected_text_is_a_warning_and_never_a_claim(answer):
    assert {w["path"] for w in answer["warnings"]} == {"notes-from-vendor.md"}
    everything = json.dumps([answer["confirmed"], answer["inferences"], answer["unknowns"]]).lower()
    assert "example.invalid" not in everything and "approved" not in everything


def test_out_of_scope_secret_never_reaches_the_answer(answer):
    assert "CONFIDENTIAL-MARKER-7731" not in json.dumps(answer)
    assert all(not d["path"].startswith("..") for d in answer["documents"])


def test_every_confirmed_claim_cites_an_exact_line(answer, nas):
    root = nas / "apollo-project"
    for c in answer["confirmed"]:
        for s in c["sources"]:
            assert (root / s["path"]).read_text(encoding="utf-8").splitlines()[s["line"] - 1].strip() == s["quote"]


def test_reviewer_removes_a_claim_whose_source_changed(nas, monkeypatch):
    """If a document changes between reading and review, the stale claim is dropped, not kept."""
    import app.nas.workflow as wf
    real = wf.extract

    def tampered(path, text):
        items = real(path, text)
        for it in items:
            if "Provider A" in it.quote:
                it.quote = it.quote.replace("Provider A", "Provider Z")
        return items
    monkeypatch.setattr(wf, "extract", tampered)
    r = run_local(str(nas / "apollo-project"), "which payment provider was decided?")
    codes = [x["code"] for x in r["review"]["rejected"]]
    assert codes and set(codes) == {"source.quote_not_found"}
    assert not any("Provider Z" in c["sources"][0]["quote"] for c in r["confirmed"])


def test_empty_folder_returns_an_empty_answer(nas):
    r = run_local(str(nas / "empty-project"), QUESTION)
    assert r["documents"] == [] and r["confirmed"] == [] and r["conflicts"] == []


def test_failed_discovery_stops_the_workflow(nas):
    class Broken(LocalSimulationAdapter):
        def invoke(self, cli, action, params=None):
            from app.nas.adapters import Result
            return Result("waiting_user", False, error={"code": "NEEDS_INPUT"})
    from app.nas.workflow import WorkflowStopped
    with pytest.raises(WorkflowStopped) as e:
        run(Broken(AuthorizedFolder(nas / "apollo-project")), QUESTION)
    assert e.value.result.state == "waiting_user"


def test_question_scopes_the_answer(nas):
    r = run_local(str(nas / "apollo-project"), "What are the risks?")
    assert r["intents"] == ["risks"]
    assert {c["category"] for c in r["confirmed"]} == {"risk"}


# ---------------------------------------------------------------- API

@pytest.fixture
def client(nas, monkeypatch):
    monkeypatch.setattr(settings, "project_memory_folders", f"apollo={nas / 'apollo-project'};empty={nas / 'empty-project'}")
    return TestClient(app)


def test_api_is_off_without_an_allowlist(monkeypatch):
    monkeypatch.setattr(settings, "project_memory_folders", "")
    assert TestClient(app).get("/studio/project-memory/folders").status_code == 404


def test_api_lists_ids_not_paths(client, nas):
    r = client.get("/studio/project-memory/folders")
    assert r.json() == {"mode": "SIMULATION", "folders": ["apollo", "empty"]}
    assert str(nas) not in r.text


def test_api_answers_by_folder_id(client):
    r = client.post("/studio/project-memory/ask", json={"folder_id": "apollo", "question": QUESTION})
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "SIMULATION" and body["folder_id"] == "apollo"
    assert any(c["topic"] == "payment provider" for c in body["conflicts"])


@pytest.mark.parametrize("fid", ["../private-hr", "C:/Windows", "private-hr", "apollo/../private-hr"])
def test_api_never_accepts_a_path(client, fid):
    r = client.post("/studio/project-memory/ask", json={"folder_id": fid, "question": QUESTION})
    assert r.status_code == 404
    assert "CONFIDENTIAL" not in r.text


def test_api_refuses_non_loopback_and_cross_site(client, monkeypatch):
    remote = TestClient(app, client=("203.0.113.9", 5555))
    assert remote.get("/studio/project-memory/folders").status_code == 403
    r = client.get("/studio/project-memory/folders", headers={"origin": "https://evil.example", "sec-fetch-site": "cross-site"})
    assert r.status_code == 403
    monkeypatch.setattr(settings, "studio_local_only", False)  # the Studio switch does not open this feature
    assert remote.get("/studio/project-memory/folders").status_code == 403


def test_api_has_no_write_routes():
    from app.api.project_memory import router
    routes = router.routes
    assert {m for r in routes for m in r.methods} <= {"GET", "POST", "HEAD"}
    assert {r.path for r in routes} == {"/studio/project-memory/folders", "/studio/project-memory/ask"}


def test_demo_app_does_not_expose_project_memory():
    import inspect

    import app.demo.factory as factory
    import app.demo.routes as routes
    assert "project_memory" not in inspect.getsource(factory) + inspect.getsource(routes)
