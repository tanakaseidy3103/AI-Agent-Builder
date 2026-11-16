"""An authorized folder: the only place the workflow may read, and it may only read.

Mirrors the parameters of the documented read actions of `ug-filesystem` (ls: path/recursive/max-depth/limit,
find: path/pattern/type, cat: path/offset/length). Paths are relative to the authorized root; anything that resolves
outside it (`..`, absolute paths, drive letters, symlinks or junctions pointing elsewhere) is refused, not clamped.
"""
import fnmatch
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

# Text formats the local harness can read. On a NAS, document-agent also reads PDF/Office files; locally those are
# listed but reported as unsupported instead of being parsed badly.
TEXT_SUFFIXES = {".md", ".txt", ".csv", ".json", ".yaml", ".yml"}
DOCUMENT_SUFFIXES = TEXT_SUFFIXES | {".pdf", ".docx", ".doc", ".xlsx", ".pptx", ".odt"}
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_LIST = 500


class ScopeError(ValueError):
    """The request names something outside the authorized folder, or something it may not read."""


@dataclass(frozen=True)
class Entry:
    path: str  # POSIX, relative to the authorized root
    kind: str  # "file" | "dir"
    size: int
    mtime: float


class AuthorizedFolder:
    def __init__(self, root: str | Path):
        r = Path(root)
        if not r.is_dir():
            raise ScopeError("authorized folder does not exist or is not a folder")
        self.root = r.resolve(strict=True)

    # ---------------------------------------------------------------- path guard

    def resolve(self, rel: str = "") -> Path:
        if rel is None or "\x00" in rel:
            raise ScopeError("invalid path")
        rel = rel.replace("\\", "/").strip()
        p = PurePosixPath(rel) if rel not in ("", ".", "/") else PurePosixPath()
        if p.is_absolute() or ":" in rel or any(part == ".." for part in p.parts):
            raise ScopeError(f"outside the authorized folder: {rel!r}")
        target = self.root.joinpath(*p.parts)
        try:
            real = target.resolve(strict=True)
        except (FileNotFoundError, OSError):
            raise ScopeError(f"not found in the authorized folder: {rel!r}") from None
        if real != self.root and self.root not in real.parents:  # symlink / junction escape
            raise ScopeError(f"outside the authorized folder: {rel!r}")
        return real

    def rel(self, p: Path) -> str:
        return p.relative_to(self.root).as_posix()

    def _entry(self, p: Path) -> Entry:
        st = p.stat()
        return Entry(self.rel(p), "dir" if p.is_dir() else "file", 0 if p.is_dir() else st.st_size, st.st_mtime)

    def _walk(self, start: Path, max_depth: int | None):
        base = len(start.relative_to(self.root).parts)
        for p in sorted(start.rglob("*")):
            try:
                real = p.resolve(strict=True)
            except OSError:
                continue
            if real != self.root and self.root not in real.parents:
                continue  # link leading out of scope: never listed
            if any(part.startswith(".") for part in p.relative_to(self.root).parts):
                continue  # hidden files and folders are not project documents
            if max_depth is not None and len(p.relative_to(self.root).parts) - base > max_depth:
                continue
            yield p

    # ---------------------------------------------------------------- documented read actions (local equivalents)

    def ls(self, path: str = "", recursive: bool = False, max_depth: int | None = None, limit: int = MAX_LIST) -> list[Entry]:
        start = self.resolve(path)
        if not start.is_dir():
            raise ScopeError(f"not a folder: {path!r}")
        items = self._walk(start, max_depth) if recursive else (
            p for p in sorted(start.iterdir()) if not p.name.startswith("."))
        out = []
        for p in items:
            if len(out) >= min(limit, MAX_LIST):
                break
            out.append(self._entry(p))
        return out

    def find(self, path: str = "", pattern: str = "*", type: str = "documents") -> list[Entry]:
        start = self.resolve(path)
        out = []
        for p in self._walk(start, None):
            if not p.is_file() or not fnmatch.fnmatch(p.name.lower(), pattern.lower()):
                continue
            if type == "documents" and p.suffix.lower() not in DOCUMENT_SUFFIXES:
                continue
            out.append(self._entry(p))
            if len(out) >= MAX_LIST:
                break
        return out

    def cat(self, path: str, offset: int = 0, length: int | None = None) -> str:
        p = self.resolve(path)
        if not p.is_file():
            raise ScopeError(f"not a file: {path!r}")
        if p.suffix.lower() not in TEXT_SUFFIXES:
            raise ScopeError(f"format not readable by the local harness: {p.suffix or 'none'}")
        if p.stat().st_size > MAX_FILE_BYTES:
            raise ScopeError(f"file larger than {MAX_FILE_BYTES} bytes: {path!r}")
        text = p.read_text(encoding="utf-8", errors="replace")
        return text[offset:] if length is None else text[offset:offset + length]
