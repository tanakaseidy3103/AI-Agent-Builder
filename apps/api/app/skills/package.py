"""Canonical Skill package format (spec: docs/skills.md).

A package is a flat mapping {relative_path: text}. Only the files a Skill needs exist.
SKILL.md (frontmatter + instructions) and manifest.json are always present.
"""
import json
import re
from pathlib import PurePosixPath
from typing import Literal

from pydantic import BaseModel, Field, field_validator

FORMAT_VERSION = "1"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")

ALLOWED_TOP_DIRS = {"scripts", "tests", "evals", "examples", "docs"}
ALLOWED_ROOT_FILES = {"SKILL.md", "manifest.json", "README.md"}
ALLOWED_EXTENSIONS = {".md", ".json", ".py", ".txt", ".ts", ".tsx", ".js", ".jsx", ".csv", ".yaml", ".yml"}
MAX_FILE_BYTES = 100_000
MAX_TOTAL_BYTES = 1_000_000
MAX_FILES = 50

# Permissions a Skill may declare. Sandbox grants none of these beyond "compute".
KNOWN_PERMISSIONS = {"compute", "read-input-files", "network", "filesystem-write", "llm"}


class TestSpec(BaseModel):
    framework: Literal["unittest"] = "unittest"
    path: str = "tests"


class ExecutionSpec(BaseModel):
    runtime: Literal["python3.12"] = "python3.12"
    entrypoint: str = "scripts/main.py"  # must define run(data: dict) -> dict
    timeout_seconds: int = Field(default=10, ge=1, le=60)
    memory_mb: int = Field(default=256, ge=64, le=1024)


class Manifest(BaseModel):
    format_version: Literal["1"] = FORMAT_VERSION
    id: str  # stable slug
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=1024)
    version: str = "0.1.0"
    kind: Literal["instructions", "code"]
    tools: list[str] = []  # tools the host agent should have (e.g. "Read", "Grep")
    dependencies: list[str] = []  # external pip packages (unsupported by sandbox in MVP)
    permissions: list[str] = ["compute"]
    input_schema: dict = {"type": "object"}
    output_schema: dict = {"type": "object"}
    execution: ExecutionSpec | None = None
    tests: TestSpec | None = None
    compatibility: list[str] = ["claude-code", "codex", "cursor"]
    origin: Literal["generated", "reference"] = "generated"  # reference = human-written benchmark Skill

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not SLUG_RE.match(v):
            raise ValueError("id must be a lowercase slug (a-z, 0-9, '-'), 3-64 chars")
        return v

    @field_validator("version")
    @classmethod
    def _semver(cls, v: str) -> str:
        if not SEMVER_RE.match(v):
            raise ValueError("version must be MAJOR.MINOR.PATCH")
        return v


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60].strip("-")
    return s if len(s) >= 3 else f"skill-{s}".strip("-")


def safe_relpath(path: str) -> str:
    """Return the normalized path or raise ValueError. Guards against traversal and odd files."""
    if not path or "\\" in path or "\x00" in path or ":" in path:
        raise ValueError(f"invalid path: {path!r}")
    p = PurePosixPath(path)
    if p.is_absolute() or any(part in ("..", ".", "") for part in p.parts):
        raise ValueError(f"path escapes package: {path!r}")
    if len(p.parts) == 1:
        if p.name not in ALLOWED_ROOT_FILES:
            raise ValueError(f"unexpected root file: {path!r}")
    elif p.parts[0] not in ALLOWED_TOP_DIRS:
        raise ValueError(f"unexpected directory: {p.parts[0]!r}")
    if p.suffix not in ALLOWED_EXTENSIONS:
        raise ValueError(f"file type not allowed: {path!r}")
    if any(part.startswith(".") for part in p.parts):
        raise ValueError(f"hidden files not allowed: {path!r}")
    return str(p)


def check_limits(files: dict[str, str]) -> None:
    if len(files) > MAX_FILES:
        raise ValueError(f"too many files ({len(files)} > {MAX_FILES})")
    total = 0
    for path, text in files.items():
        size = len(text.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            raise ValueError(f"{path} too large ({size} bytes)")
        total += size
    if total > MAX_TOTAL_BYTES:
        raise ValueError(f"package too large ({total} bytes)")


def render_skill_md(m: Manifest, instructions: str) -> str:
    # Frontmatter follows the Agent Skills convention used by Claude Code and Codex.
    desc = m.description.replace("\n", " ").replace('"', "'")
    return f'---\nname: {m.id}\ndescription: "{desc}"\n---\n\n# {m.name}\n\n{instructions.strip()}\n'


def manifest_json(m: Manifest) -> str:
    return json.dumps(m.model_dump(exclude_none=True), indent=2, ensure_ascii=False) + "\n"


def parse_frontmatter(skill_md: str) -> dict[str, str]:
    if not skill_md.startswith("---\n"):
        return {}
    end = skill_md.find("\n---", 4)
    if end < 0:
        return {}
    out = {}
    for line in skill_md[4:end].splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def instructions_body(skill_md: str) -> str:
    if skill_md.startswith("---\n"):
        end = skill_md.find("\n---", 4)
        if end >= 0:
            return skill_md[end + 4 :].strip()
    return skill_md.strip()
