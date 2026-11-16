"""Homelab mode of the demo (2026-11-14): one process serves the built frontend and the demo API on one origin, so a
single Cloudflare Quick Tunnel carries both; and an optional presentation access code for the actions that run the
model or the sandbox. Real demo app, SQLite, FakeProvider and a faked sandbox (see tests/test_demo.py)."""
import pytest

from app.demo.config import DemoConfigError, DemoSettings
from tests.test_demo import PROMPT, make, session  # noqa: F401  (fixture)

CODE = "hackathon-2026"


@pytest.fixture
def site(tmp_path):
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<!doctype html><title>AI Agent Builder</title><div id=root></div>", encoding="utf-8")
    (d / "assets" / "app.js").write_text("console.log('app')", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("outside the site", encoding="utf-8")
    return d


def test_one_origin_serves_the_site_and_the_api(make, site):  # noqa: F811
    client, _, _ = make(static_dir=site)
    home = client.get("/")
    assert home.status_code == 200 and "AI Agent Builder" in home.text
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/demo/status").json()["model_ready"] is True  # API routes win over the site
    assert client.get("/health").json()["mode"] == "demo"
    assert home.headers["x-content-type-options"] == "nosniff" and home.headers["x-frame-options"] == "DENY"


@pytest.mark.parametrize("path", ["/studio/skills", "/v1/skills", "/docs", "/openapi.json", "/studio/api-keys",
                                  "/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"])
def test_studio_admin_and_files_outside_the_site_are_not_reachable(make, site, path):  # noqa: F811
    client, _, _ = make(static_dir=site)
    r = client.get(path)
    assert r.status_code == 404 and "outside the site" not in r.text


def test_writes_to_the_site_are_refused(make, site):  # noqa: F811
    client, _, _ = make(static_dir=site)
    assert client.post("/index.html", content=b"x").status_code in (404, 405)
    assert client.post("/studio/skills/generate", json={"prompt": PROMPT}).status_code in (404, 405)


def test_static_dir_must_contain_a_built_site(tmp_path):
    with pytest.raises(DemoConfigError, match="index.html"):
        DemoSettings(database_url="sqlite:///x_demo.db", storage_dir=tmp_path / "s", static_dir=tmp_path).check_isolated()


def test_access_code_gates_generation_and_test_runs_but_not_browsing(make):  # noqa: F811
    client, app, _ = make(access_code=CODE)
    assert client.get("/demo/status").json()["access_code_required"] is True
    h = session(client)
    assert client.get("/demo/skills", headers=h).status_code == 200  # browsing stays open
    body = {"prompt": PROMPT, "kind": "code"}
    assert client.post("/demo/skills/generate", json=body, headers=h).status_code == 403
    assert client.post("/demo/skills/generate", json=body, headers={**h, "X-Demo-Code": "wrong-code"}).status_code == 403
    ok = client.post("/demo/skills/generate", json=body, headers={**h, "X-Demo-Code": CODE})
    assert ok.status_code == 202
    app.state.worker.join()
    vid = client.get(f"/demo/jobs/{ok.json()['id']}", headers=h).json()["skill_version_id"]
    assert client.post(f"/demo/versions/{vid}/validate", headers=h).status_code == 403
    assert client.post(f"/demo/versions/{vid}/validate", headers={**h, "X-Demo-Code": CODE}).status_code == 200


def test_wrong_codes_are_rate_limited(make):  # noqa: F811
    client, _, _ = make(access_code=CODE)
    h = session(client)
    codes = [client.post("/demo/skills/generate", json={"prompt": PROMPT}, headers={**h, "X-Demo-Code": f"guess-{i}"}).status_code
             for i in range(12)]
    assert codes[:10] == [403] * 10 and codes[10:] == [429, 429]


def test_without_a_code_nothing_changes(make):  # noqa: F811
    client, _, _ = make()
    assert client.get("/demo/status").json()["access_code_required"] is False
    assert client.post("/demo/skills/generate", json={"prompt": PROMPT, "kind": "code"}, headers=session(client)).status_code == 202


def test_short_access_codes_are_refused(tmp_path):
    with pytest.raises(DemoConfigError, match="at least 6"):
        DemoSettings(database_url="sqlite:///x_demo.db", storage_dir=tmp_path / "s", access_code="123").check_isolated()
