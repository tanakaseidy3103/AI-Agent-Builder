"""Expert adapters: the only way the workflow reaches project files.

The interface follows the public Uliya contract: an operation is a documented CLI capability + Action
(`cli.invoke --cli <CLI> --action <ACTION>`), the result is the catalog envelope (`{"ok": true, "data": ...}` or
`{"ok": false, "error": ...}`) plus one of the five public delegation states.

- LocalSimulationAdapter: SIMULATION. Serves four documented READ actions from one authorized local folder fixed at
  construction. It cannot be pointed at another folder by a caller, and it has no write path at all.
- UliyaAdapter: the real target. On a UGREEN AI NAS, a Skill's delegations are executed by the platform experts inside
  Uliya; the Skill Kit documents no API for calling them from outside the device. So this adapter refuses with an
  explanation instead of pretending. It exists to keep the boundary explicit for the device test.
"""
from dataclasses import dataclass, field

from app.nas.evidence import collect_evidence
from app.nas.scope import AuthorizedFolder, ScopeError

STATES = ("completed", "failed", "cancelled", "waiting_user", "waiting_approval")

# Documented read actions this adapter serves: (cli, action) -> (registered expert, accepted parameters).
# Names checked against the official catalog 2.0.0 by tests/test_nas_adapters.py when the kit is available.
LOCAL_ACTIONS: dict[tuple[str, str], tuple[str, set[str]]] = {
    ("ug-filesystem", "ls"): ("file-agent", {"path", "recursive", "max-depth", "limit"}),
    ("ug-filesystem", "find"): ("file-agent", {"path", "pattern", "type"}),
    ("ug-filesystem", "cat"): ("file-agent", {"path", "offset", "length"}),
    ("ug-knowledge", "collect-evidence"): ("knowledge-agent", {"query", "path"}),
}


@dataclass
class Result:
    state: str
    ok: bool
    data: object = None
    error: dict | None = None
    agent: str | None = None
    mode: str = "SIMULATION"
    meta: dict = field(default_factory=dict)

    def envelope(self) -> dict:
        return {"ok": True, "data": self.data} if self.ok else {"ok": False, "error": self.error}


class IntegrationUnavailable(RuntimeError):
    pass


def _failed(code: str, message: str, agent: str | None = None) -> Result:
    return Result("failed", False, error={"code": code, "message": message}, agent=agent)


class LocalSimulationAdapter:
    mode = "SIMULATION"

    def __init__(self, folder: AuthorizedFolder):
        self._folder = folder  # fixed: no method changes it

    @property
    def folder(self) -> AuthorizedFolder:
        return self._folder

    def invoke(self, cli: str, action: str, params: dict | None = None) -> Result:
        params = dict(params or {})
        spec = LOCAL_ACTIONS.get((cli, action))
        if spec is None:
            return _failed("ACTION_NOT_AVAILABLE",
                           f"{cli} {action} is not available in SIMULATION (read actions only: "
                           f"{', '.join(f'{c} {a}' for c, a in LOCAL_ACTIONS)})")
        agent, accepted = spec
        unknown = set(params) - accepted
        if unknown:
            return _failed("PARAMETER_UNSUPPORTED", f"unsupported parameters: {sorted(unknown)}", agent)
        try:
            data = self._run(cli, action, params)
        except ScopeError as e:
            return _failed("SCOPE_DENIED", str(e), agent)
        except (TypeError, ValueError) as e:
            return _failed("PARAMETER_INVALID", str(e), agent)
        return Result("completed", True, data=data, agent=agent)

    def _run(self, cli: str, action: str, p: dict):
        f = self._folder
        if (cli, action) == ("ug-filesystem", "ls"):
            return [e.__dict__ for e in f.ls(p.get("path", ""), bool(p.get("recursive")),
                                             None if p.get("max-depth") is None else int(p["max-depth"]),
                                             int(p.get("limit", 500)))]
        if (cli, action) == ("ug-filesystem", "find"):
            return [e.__dict__ for e in f.find(p.get("path", ""), p.get("pattern", "*"), p.get("type", "documents"))]
        if (cli, action) == ("ug-filesystem", "cat"):
            if not p.get("path"):
                raise ValueError("path is required")
            return f.cat(p["path"], int(p.get("offset", 0)), None if p.get("length") is None else int(p["length"]))
        if not p.get("query"):
            raise ValueError("query is required")
        r = collect_evidence(f, p["query"], p.get("path", ""))
        return {"passages": [x.__dict__ for x in r.passages], "documents_read": r.documents_read,
                "unreadable": r.unreadable, "warnings": r.warnings}


class UliyaAdapter:
    mode = "UGREEN_NAS"

    def invoke(self, cli: str, action: str, params: dict | None = None) -> Result:
        raise IntegrationUnavailable(
            "Delegations to UGREEN experts run inside Uliya on the NAS. The Skill Kit documents no off-device API, so "
            "AI-Agent-Builder cannot call them. Install the Skill package on the NAS and run it there.")
