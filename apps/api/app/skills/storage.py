"""Filesystem storage for package files. DB rows hold only a storage_key."""
import os
import shutil
import tempfile
import time
from pathlib import Path

from app.config import settings
from app.skills.package import check_limits, safe_relpath


def _root() -> Path:
    return (settings.storage_dir / "skills").resolve()


def _replace_dir(src: Path, dest: Path, attempts: int = 5) -> None:
    """Atomic publish of a freshly written package folder. On Windows, renaming a directory fails with PermissionError
    while another process (a sync client such as OneDrive, an indexer, an antivirus) still holds a handle on the new
    files; seen 2026-11-14 as HTTP 500 from reference seeding. Retry briefly for that error only; anything else, or a
    lasting lock, is raised as before."""
    for i in range(attempts):
        try:
            os.replace(src, dest)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.2 * (i + 1))


def write_package(key: str, files: dict[str, str]) -> None:
    check_limits(files)
    dest = _root() / key
    if dest.exists():
        raise FileExistsError(f"package {key} already stored")  # versions are immutable
    _root().mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(dir=_root(), prefix=".tmp-"))
    try:
        for rel, text in files.items():
            p = tmp / safe_relpath(rel)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8", newline="\n")
        _replace_dir(tmp, dest)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def read_package(key: str) -> dict[str, str]:
    base = _root() / key
    return {p.relative_to(base).as_posix(): p.read_text(encoding="utf-8")
            for p in sorted(base.rglob("*")) if p.is_file()}


def delete_package(key: str) -> None:
    root = _root()
    base = (root / key).resolve()
    if not key or base.parent != root:  # only a direct child of the storage root, never anything above it
        raise ValueError(f"invalid storage key {key!r}")
    shutil.rmtree(base, ignore_errors=True)
