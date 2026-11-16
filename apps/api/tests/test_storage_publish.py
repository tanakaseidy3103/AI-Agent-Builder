"""storage.write_package publishes a package by renaming its temp folder. On Windows that rename fails with
PermissionError while another process holds a handle on the new files (2026-11-14: OneDrive, HTTP 500 on seeding)."""
import os

import pytest

from app.skills import storage


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "storage_dir", tmp_path)
    monkeypatch.setattr(storage.time, "sleep", lambda s: None)
    return tmp_path


def test_transient_lock_is_retried_and_the_package_is_published(root, monkeypatch):
    real, calls = os.replace, []

    def flaky(src, dst):
        calls.append(1)
        if len(calls) < 3:
            raise PermissionError(5, "Access is denied")
        return real(src, dst)
    monkeypatch.setattr(storage.os, "replace", flaky)
    storage.write_package("k1", {"SKILL.md": "x", "scripts/main.py": "y"})
    assert len(calls) == 3
    assert storage.read_package("k1") == {"SKILL.md": "x", "scripts/main.py": "y"}
    assert not [p for p in (root / "skills").iterdir() if p.name.startswith(".tmp-")]


def test_a_lasting_lock_still_fails_and_leaves_nothing_behind(root, monkeypatch):
    def locked(src, dst):
        raise PermissionError(5, "Access is denied")
    monkeypatch.setattr(storage.os, "replace", locked)
    with pytest.raises(PermissionError):
        storage.write_package("k2", {"SKILL.md": "x"})
    assert not (root / "skills" / "k2").exists()
    assert not [p for p in (root / "skills").iterdir() if p.name.startswith(".tmp-")]


def test_other_errors_are_not_retried(root, monkeypatch):
    calls = []

    def broken(src, dst):
        calls.append(1)
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(storage.os, "replace", broken)
    with pytest.raises(OSError):
        storage.write_package("k3", {"SKILL.md": "x"})
    assert len(calls) == 1
