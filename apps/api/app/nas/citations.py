"""Deterministic review of a Project Memory answer: every confirmed claim must be backed by a quote that really
exists in a file inside the authorized folder.

This is the "Reviewer" role of the workflow. It does not judge whether a claim is a good reading of the quote (that
needs a model or a human); it guarantees that cited sources and quotes are real, in scope, and that the answer keeps
confirmed facts, inferences and unknowns apart.
"""
import re
from dataclasses import dataclass

from app.nas.scope import AuthorizedFolder, ScopeError

KINDS = {"confirmed", "inference", "unknown"}


def _norm(s: str) -> str:
    s = s.replace("**", "").replace("__", "").replace("`", "")
    s = s.replace("–", "-").replace("—", "-").replace("’", "'")
    return re.sub(r"\s+", " ", s).strip().lower()


@dataclass(frozen=True)
class Issue:
    claim: int  # index in answer["claims"], -1 for answer-level issues
    code: str
    detail: str


def review(answer: dict, folder: AuthorizedFolder) -> list[Issue]:
    """answer = {"claims": [{"kind", "text", "sources": [{"path", "quote"}], "basis"?}], ...}"""
    issues: list[Issue] = []
    claims = answer.get("claims")
    if not isinstance(claims, list):
        return [Issue(-1, "answer.shape", "answer has no list of claims")]
    cache: dict[str, str | None] = {}

    def text_of(path: str) -> str | None:
        if path not in cache:
            try:
                cache[path] = _norm(folder.cat(path))
            except ScopeError:
                cache[path] = None
        return cache[path]

    for i, c in enumerate(claims):
        kind = c.get("kind") if isinstance(c, dict) else None
        if kind not in KINDS:
            issues.append(Issue(i, "claim.kind", f"kind must be one of {sorted(KINDS)}"))
            continue
        sources = c.get("sources") or []
        if kind == "confirmed" and not sources:
            issues.append(Issue(i, "confirmed.no_source", "a confirmed claim needs at least one quoted source"))
        if kind == "inference" and not (c.get("basis") or sources):
            issues.append(Issue(i, "inference.no_basis", "an inference must state what it is based on"))
        for s in sources:
            path, quote = (s.get("path") or ""), (s.get("quote") or "")
            body = text_of(path)
            if body is None:
                issues.append(Issue(i, "source.out_of_scope", f"cited file is not readable in the authorized folder: {path!r}"))
            elif not _norm(quote):
                issues.append(Issue(i, "source.no_quote", f"no quote given for {path!r}"))
            elif _norm(quote) not in body:
                issues.append(Issue(i, "source.quote_not_found", f"quote does not appear in {path!r}"))
    return issues
