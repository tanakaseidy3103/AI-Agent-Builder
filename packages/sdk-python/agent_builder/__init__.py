"""AI Agent Builder Python SDK (stdlib only, Python 3.8+).

    from agent_builder import SkillClient
    client = SkillClient(api_key=os.environ["AAB_API_KEY"])
    result = client.run("react-performance-analyzer", project_path="./my-project")

Keep the API key on the server side; never ship it to a browser.
"""
import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

__all__ = ["SkillClient", "SkillError"]
__version__ = "0.1.0"

TEXT_EXT = {".js", ".jsx", ".ts", ".tsx", ".py", ".json", ".md", ".css", ".html", ".txt", ".csv"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv"}
MAX_FILE_BYTES = 200_000
MAX_FILES = 500


class SkillError(Exception):
    def __init__(self, status: int, message: str, detail: Any = None):
        super().__init__(f"{status}: {message}")
        self.status, self.message, self.detail = status, message, detail


def collect_files(root: str) -> Dict[str, str]:
    """Read text sources under root into {relative_path: text}, skipping vendored/build dirs."""
    files: Dict[str, str] = {}
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for n in names:
            p = os.path.join(d, n)
            if os.path.splitext(n)[1] in TEXT_EXT and os.path.getsize(p) <= MAX_FILE_BYTES:
                if len(files) >= MAX_FILES:
                    return files
                with open(p, encoding="utf-8", errors="replace") as f:
                    files[os.path.relpath(p, root).replace(os.sep, "/")] = f.read()
    return files


class SkillClient:
    def __init__(self, api_key: str, base_url: str = "http://localhost:8000", timeout: float = 120):
        if not api_key or not api_key.startswith("aab_"):
            raise ValueError("api_key must be an AI Agent Builder key (aab_...)")
        self._key, self._base, self._timeout = api_key, base_url.rstrip("/"), timeout

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self._base + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self._key}", "Content-Type": "application/json",
            "User-Agent": f"agent-builder-python/{__version__}"})
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                detail = json.loads(raw).get("detail", raw)
            except ValueError:
                detail = raw
            msg = detail.get("message", str(detail)) if isinstance(detail, dict) else str(detail)
            raise SkillError(e.code, msg, detail) from None
        except urllib.error.URLError as e:
            raise SkillError(0, f"cannot reach {self._base}: {e.reason}") from None

    def list(self) -> List[dict]:
        return self._request("GET", "/v1/skills")

    def get(self, skill: str, version: Optional[str] = None) -> dict:
        q = f"?version={version}" if version else ""
        return self._request("GET", f"/v1/skills/{skill}{q}")

    def run(self, skill: str, input: Optional[dict] = None, *, project_path: Optional[str] = None,
            task: Optional[str] = None, version: Optional[str] = None) -> dict:
        """Run a Skill. project_path fills input["files"]; task fills input["task"]."""
        data = dict(input or {})
        if project_path is not None:
            if not os.path.isdir(project_path):
                raise ValueError(f"project_path is not a directory: {project_path}")
            data["files"] = collect_files(project_path)
        if task is not None:
            data["task"] = task
        body: Dict[str, Any] = {"input": data}
        if version:
            body["version"] = version
        return self._request("POST", f"/v1/skills/{skill}/run", body)

    def get_run(self, run_id: str) -> dict:
        return self._request("GET", f"/v1/runs/{run_id}")
