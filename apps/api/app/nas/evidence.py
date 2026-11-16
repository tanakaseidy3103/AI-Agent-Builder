"""Evidence collection and untrusted-text detection over an authorized folder.

`collect_evidence` is a deterministic, keyword-based local stand-in for `ug-knowledge collect-evidence`: it returns
passages with their file and line range, so every later claim can point at an exact source. Text that looks like an
instruction to an assistant is reported as a warning and kept as data; it is never acted on.
"""
import re
from dataclasses import dataclass, field

from app.nas.scope import TEXT_SUFFIXES, AuthorizedFolder, ScopeError

_WORD = re.compile(r"[\w\-]+", re.UNICODE)
_STOP = {"the", "a", "an", "of", "and", "or", "to", "in", "on", "is", "are", "what", "which", "who", "did", "we",
         "this", "that", "for", "me", "tell", "about", "with", "by", "be", "it", "do", "does", "how", "when"}

# Phrases addressed to an AI system rather than to a human reader. Heuristic: a hit is a warning, not proof.
_INJECTION = [
    re.compile(p, re.IGNORECASE) for p in (
        r"ignore (all |any )?(your |the )?(previous|prior|above) instructions",
        r"\b(assistant|ai|model|agent)\s*:\s*\w",
        r"disregard (the |your )?(system|previous)",
        r"(send|upload|post|forward) (every|all|each) (file|document)s?",
        r"you are now\b",
        r"do not (tell|inform) the user",
    )
]


@dataclass(frozen=True)
class Passage:
    path: str
    line_start: int  # 1-based, inclusive
    line_end: int
    text: str
    score: int


@dataclass
class EvidenceResult:
    query: str
    passages: list[Passage] = field(default_factory=list)
    documents_read: list[str] = field(default_factory=list)
    unreadable: list[str] = field(default_factory=list)  # found, but not a format the harness reads
    warnings: list[dict] = field(default_factory=list)  # {"path", "line", "reason"}


def terms(query: str) -> list[str]:
    return [w for w in (m.lower() for m in _WORD.findall(query)) if w not in _STOP and len(w) > 1]


def injection_warnings(path: str, text: str) -> list[dict]:
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        for rx in _INJECTION:
            if rx.search(line):
                out.append({"path": path, "line": i, "reason": "text addressed to an AI assistant; treated as data"})
                break
    return out


def collect_evidence(folder: AuthorizedFolder, query: str, path: str = "", max_passages: int = 40) -> EvidenceResult:
    res = EvidenceResult(query=query)
    keys = terms(query)
    for entry in folder.find(path, "*", "documents"):
        if entry.path.rsplit(".", 1)[-1].lower() not in {s[1:] for s in TEXT_SUFFIXES}:
            res.unreadable.append(entry.path)
            continue
        try:
            text = folder.cat(entry.path)
        except ScopeError:
            res.unreadable.append(entry.path)
            continue
        res.documents_read.append(entry.path)
        res.warnings.extend(injection_warnings(entry.path, text))
        for i, line in enumerate(text.splitlines(), 1):
            low = line.lower()
            score = sum(1 for k in keys if k in low) if keys else (1 if line.strip() else 0)
            if score:
                res.passages.append(Passage(entry.path, i, i, line.strip(), score))
    res.passages.sort(key=lambda p: (-p.score, p.path, p.line_start))
    res.passages = res.passages[:max_passages]
    return res
