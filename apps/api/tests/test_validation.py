import json

import pytest

from app.skills.package import Manifest, safe_relpath, slugify
from app.skills.validation import validate_package
from tests.fixtures import code_package


def statuses(files):
    checks, _ = validate_package(files)
    return {c.id: c.status for c in checks}


def test_valid_code_package_passes_all_checks():
    s = statuses(code_package())
    assert "fail" not in s.values(), s


@pytest.mark.parametrize("bad", ["../x.md", "/etc/passwd", "scripts/../../x.py", "C:/x.md", "a\\b.md",
                                 "evil/x.py", "scripts/.hidden.py", "scripts/x.exe", "notes.md", ""])
def test_unsafe_paths_rejected(bad):
    with pytest.raises(ValueError):
        safe_relpath(bad)


def test_traversal_path_fails_structure_check():
    files = code_package() | {"../../etc/x.md": "x"}
    assert statuses(files)["structure.paths"] == "fail"


def test_oversized_file_fails():
    files = code_package() | {"docs/big.md": "x" * 200_000}
    assert statuses(files)["structure.paths"] == "fail"


def test_missing_manifest_stops_early():
    files = code_package()
    del files["manifest.json"]
    assert statuses(files) == {"structure.paths": "pass", "structure.required": "fail"}


def test_invalid_manifest_reported():
    files = code_package() | {"manifest.json": json.dumps({"id": "Bad Id", "kind": "code"})}
    assert statuses(files)["manifest.schema"] == "fail"


def test_syntax_error_detected():
    files = code_package() | {"scripts/main.py": "def run(data):\n  return {\n"}
    s = statuses(files)
    assert s["python.syntax:scripts/main.py"] == "fail"
    assert s["code.entrypoint"] == "fail"


@pytest.mark.parametrize("src", [
    "import subprocess\ndef run(d): return {}",
    "import socket\ndef run(d): return {}",
    "import os\ndef run(d):\n    os.system('ls')\n    return {}",
    "import os\ndef run(d): return dict(os.environ)",
    "def run(d): return eval('1')",
    "def run(d):\n    open('/x', 'w')\n    return {}",
    "import numpy\ndef run(d): return {}",
    "import os\ndef run(d):\n    os._exit(0)",
])
def test_policy_blocks_dangerous_or_undeclared_code(src):
    assert statuses(code_package() | {"scripts/main.py": src})["python.policy:scripts/main.py"] == "fail"


def test_missing_run_function():
    assert statuses(code_package() | {"scripts/main.py": "def main(d): return {}"})["code.entrypoint"] == "fail"


def test_code_skill_without_tests_is_not_verifiable():
    files = code_package()
    del files["tests/test_main.py"]
    assert statuses(files)["code.tests"] == "fail"


def test_dependencies_and_network_permission_fail():
    m = json.loads(code_package()["manifest.json"])
    m["dependencies"], m["permissions"] = ["numpy"], ["network"]
    s = statuses(code_package() | {"manifest.json": json.dumps(m)})
    assert s["manifest.dependencies"] == "fail"
    assert s["manifest.permissions"] == "fail"


def test_frontmatter_must_match_manifest_id():
    files = code_package()
    files["SKILL.md"] = files["SKILL.md"].replace("name: react-perf", "name: other")
    assert statuses(files)["skill_md.frontmatter"] == "fail"


def test_schema_required_must_be_declared():
    m = json.loads(code_package()["manifest.json"])
    m["input_schema"] = {"type": "object", "properties": {}, "required": ["x"]}
    assert statuses(code_package() | {"manifest.json": json.dumps(m)})["manifest.io_schemas"] == "fail"


def test_manifest_slug_and_semver():
    with pytest.raises(ValueError):
        Manifest(id="UPPER", name="x", description="x", kind="instructions")
    with pytest.raises(ValueError):
        Manifest(id="ok-id", name="x", description="x", kind="instructions", version="1.0")


def test_slugify():
    assert slugify("React Performance Analyzer!") == "react-performance-analyzer"
    assert len(slugify("x")) >= 3
