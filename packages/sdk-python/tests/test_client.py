import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from agent_builder import SkillClient, SkillError

SEEN = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        SEEN.append(("GET", self.path, self.headers.get("Authorization"), None))
        if self.headers.get("Authorization") != "Bearer aab_good":
            return self._send(401, {"detail": "invalid or revoked API key"})
        self._send(200, [{"slug": "x"}] if self.path == "/v1/skills" else {"slug": "x", "path": self.path})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append(("POST", self.path, self.headers.get("Authorization"), body))
        if body["input"].get("bad"):
            return self._send(422, {"detail": {"message": "input does not match input_schema", "errors": ["x"]}})
        self._send(200, {"run_id": "r1", "status": "completed", "output": {"n": len(body["input"].get("files", {}))}})


@pytest.fixture(scope="module")
def base():
    srv = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_rejects_non_aab_key():
    with pytest.raises(ValueError):
        SkillClient(api_key="sk-123")


def test_list_and_get_send_bearer(base):
    c = SkillClient("aab_good", base)
    assert c.list() == [{"slug": "x"}]
    assert c.get("x", version="0.1.0")["path"] == "/v1/skills/x?version=0.1.0"
    assert SEEN[-1][2] == "Bearer aab_good"


def test_run_with_project_path_collects_files_and_skips_node_modules(base, tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "App.tsx").write_text("x")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "dep.js").write_text("x")
    (tmp_path / "logo.png").write_bytes(b"\x89PNG")
    r = SkillClient("aab_good", base).run("x", project_path=str(tmp_path), task="Analyze performance issues")
    assert r["status"] == "completed"
    sent = SEEN[-1][3]["input"]
    assert list(sent["files"]) == ["src/App.tsx"] and sent["task"] == "Analyze performance issues"


def test_errors_are_typed(base):
    with pytest.raises(SkillError) as e:
        SkillClient("aab_bad", base).list()
    assert e.value.status == 401 and "revoked" in e.value.message
    with pytest.raises(SkillError) as e:
        SkillClient("aab_good", base).run("x", {"bad": True})
    assert e.value.status == 422 and e.value.detail["errors"] == ["x"]


def test_unreachable_server():
    with pytest.raises(SkillError) as e:
        SkillClient("aab_good", "http://127.0.0.1:9", timeout=2).list()
    assert e.value.status == 0


def test_bad_project_path(base):
    with pytest.raises(ValueError):
        SkillClient("aab_good", base).run("x", project_path="/no/such/dir")
