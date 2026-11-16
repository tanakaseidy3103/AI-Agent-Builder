"""NAS Project Memory, SIMULATION mode: ask a question about one allowlisted local folder.

Off unless PROJECT_MEMORY_FOLDERS lists folders. Loopback clients only, whatever STUDIO_LOCAL_ONLY says, and
same-origin only. A request names a folder by id; it can never pass a path. Read-only: no route writes anything.
Every response carries "mode": "SIMULATION" because no UGREEN NAS is involved.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import LOOPBACK, foreign_origin
from app.config import settings
from app.nas.scope import AuthorizedFolder, ScopeError
from app.nas.workflow import WorkflowStopped, run_local

router = APIRouter(prefix="/studio/project-memory", tags=["project-memory"])
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def allowlist() -> dict[str, str]:
    out = {}
    for part in filter(None, (p.strip() for p in settings.project_memory_folders.split(";"))):
        fid, sep, path = part.partition("=")
        fid = fid.strip().lower()
        if sep and _ID.match(fid) and path.strip():
            out[fid] = path.strip()
    return out


def local_only(request: Request) -> None:
    if request.client is None or request.client.host not in LOOPBACK:
        raise HTTPException(403, "Project Memory is available to the local machine only")
    if foreign_origin(request.headers.get("origin"), request.headers.get("sec-fetch-site")):
        raise HTTPException(403, "cross-site requests are refused")
    if not allowlist():
        raise HTTPException(404, "Project Memory is off: no folders are configured (PROJECT_MEMORY_FOLDERS)")


class Ask(BaseModel):
    folder_id: str = Field(min_length=1, max_length=40)
    question: str = Field(min_length=3, max_length=1000)


@router.get("/folders", dependencies=[Depends(local_only)])
def folders() -> dict:
    # ids only: configured paths are not echoed to the client
    return {"mode": "SIMULATION", "folders": sorted(allowlist())}


@router.post("/ask", dependencies=[Depends(local_only)])
def ask(body: Ask) -> dict:
    root = allowlist().get(body.folder_id.lower())
    if root is None:
        raise HTTPException(404, "unknown folder id")
    try:
        return {"folder_id": body.folder_id.lower(), **run_local(root, body.question)}
    except ScopeError:
        raise HTTPException(409, "the configured folder is not available") from None
    except WorkflowStopped as e:
        return {"mode": "SIMULATION", "folder_id": body.folder_id.lower(), "stopped": e.step,
                "state": e.result.state, "error": (e.result.error or {}).get("code")}
