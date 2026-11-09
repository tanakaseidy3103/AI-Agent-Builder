"""Filesystem storage for package files. DB rows hold only a storage_key."""
import os
import shutil
import tempfile
from pathlib import Path

from app.config import settings
from app.skills.package import check_limits, safe_relpath


def _root() -> Path:
    return (settings.storage_dir / "skills").resolve()


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
        os.replace(tmp, dest)
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
