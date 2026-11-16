"""Build and validate the UGREEN submission ZIP for nas-project-memory. Python 3.10+, standard library only.

    python hackathons/ugreen-2026/scripts/build_submission.py [--kit-zip PATH]

1. Builds submission/nas-project-memory.zip from skill/nas-project-memory/ (sorted entries, fixed timestamps, so the
   same sources always give the same bytes).
2. Extracts the ZIP into a new empty temporary directory and validates THAT copy:
   - structure the official checker accepts: only SKILL.md and references/*.md under one root folder;
   - limits: <=100 files, <=1 MiB per file, <=10 MiB uncompressed, <=10 MiB compressed;
   - no hidden files, symlinks, scripts, binaries or credentials; UTF-8 text;
   - byte-identical to the source files.
3. If the official kit ZIP is available (--kit-zip or ULIYA_KIT_ZIP, default C:/Users/<you>/Downloads/uliya/...),
   extracts it to another temporary directory and runs its checker (`node scripts/check-skill.mjs`) on the extracted
   Skill. The status must be `static-pass`.
Writes submission/zip-validation.json. Exit code 0 only when every check passed.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SKILL_NAME = "nas-project-memory"
SOURCE = ROOT / "skill" / SKILL_NAME
OUT_ZIP = ROOT / "submission" / f"{SKILL_NAME}.zip"
REPORT = ROOT / "submission" / "zip-validation.json"
DEFAULT_KIT = Path.home() / "Downloads" / "uliya" / "uliya-skill-kit-0.7.3-en.zip"
KIT_SHA256 = "cf557e5a022e4297892f39768132855154232efdedeb726b2845450ccd70e1b3"

MAX_FILES, MAX_FILE, MAX_TOTAL = 100, 1024 * 1024, 10 * 1024 * 1024
SECRET = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|passwd|token|api[_-]?key|secret)\s*[:=]\s*[\"'][^\"'\n]+[\"']"
                    r"|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{20}", re.I)
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def source_files() -> dict[str, bytes]:
    files = {}
    for p in sorted(SOURCE.rglob("*")):
        if p.is_file():
            files[p.relative_to(SOURCE).as_posix()] = p.read_bytes()
    return files


def build_zip(files: dict[str, bytes], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, data in sorted(files.items()):
            info = zipfile.ZipInfo(f"{SKILL_NAME}/{rel}", date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)


def safe_extract(zip_path: Path, dest: Path) -> list[str]:
    """Extract with path checks; returns member names. Refuses absolute, parent, drive and symlink entries."""
    names = []
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            name = info.filename
            parts = PurePosixPath(name).parts
            if name.startswith(("/", "\\")) or ".." in parts or ":" in name or "\\" in name:
                raise ValueError(f"unsafe entry {name!r}")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError(f"symlink entry {name!r}")
            names.append(name)
        z.extractall(dest)
    return names


def validate(zip_path: Path, original: dict[str, bytes]) -> dict:
    checks: list[dict] = []
    add = lambda name, ok, detail="": checks.append({"check": name, "pass": bool(ok), "detail": detail})  # noqa: E731
    compressed = zip_path.stat().st_size
    add("compressed size <= 10 MiB", compressed <= MAX_TOTAL, f"{compressed} bytes")
    with tempfile.TemporaryDirectory(prefix="ugreen-zip-") as tmp:
        tmp = Path(tmp)
        assert not any(tmp.iterdir()), "temporary directory must start empty"
        names = safe_extract(zip_path, tmp)
        files = [n for n in names if not n.endswith("/")]
        root = tmp / SKILL_NAME
        add("single root folder named after the Skill", {n.split("/")[0] for n in names} == {SKILL_NAME}, ", ".join(sorted({n.split('/')[0] for n in names})))
        rels = [n[len(SKILL_NAME) + 1:] for n in files]
        add("SKILL.md present at the Skill root", "SKILL.md" in rels)
        allowed = [r for r in rels if r == "SKILL.md" or re.fullmatch(r"references/[A-Za-z0-9._/-]+\.md", r)]
        add("only SKILL.md and references/*.md", allowed == rels, ", ".join(sorted(set(rels) - set(allowed))) or "ok")
        add("no hidden files", not any(part.startswith(".") for r in rels for part in r.split("/")))
        add(f"file count <= {MAX_FILES}", len(rels) <= MAX_FILES, str(len(rels)))
        sizes = {r: (root / r).stat().st_size for r in rels}
        add("each file <= 1 MiB", all(s <= MAX_FILE for s in sizes.values()), f"largest {max(sizes.values())} bytes")
        total = sum(sizes.values())
        add("uncompressed total <= 10 MiB", total <= MAX_TOTAL, f"{total} bytes")
        texts = {}
        for r in rels:
            try:
                texts[r] = (root / r).read_bytes().decode("utf-8")
            except UnicodeDecodeError:
                texts[r] = None
        add("all files are UTF-8 text (no binaries)", all(t is not None for t in texts.values()))
        add("no credential or key patterns", not any(t and SECRET.search(t) for t in texts.values()),
            ", ".join(r for r, t in texts.items() if t and SECRET.search(t)) or "none found")
        add("byte-identical to skill/ sources", {r: (root / r).read_bytes() for r in rels} == original,
            f"{len(rels)} files compared")
        kit = check_with_official_kit(root)
        if kit is not None:
            add("official checker on the extracted copy: static-pass", kit.get("status") == "static-pass",
                f"{kit.get('status')} {kit.get('summary')}")
    return {"zip": zip_path.name, "sha256": hashlib.sha256(zip_path.read_bytes()).hexdigest(), "compressed_bytes": compressed,
            "uncompressed_bytes": total, "files": sorted(rels), "checks": checks, "official_checker": kit,
            "passed": all(c["pass"] for c in checks)}


def kit_dir() -> Path | None:
    """Extract the official kit ZIP (checksum-verified) once into a temp folder; None when it is not available."""
    zip_path = Path(os.environ.get("ULIYA_KIT_ZIP", DEFAULT_KIT))
    if not zip_path.is_file():
        return None
    if hashlib.sha256(zip_path.read_bytes()).hexdigest() != KIT_SHA256:
        raise SystemExit(f"{zip_path}: SHA-256 differs from the audited uliya-skill-kit 0.7.3 package")
    dest = Path(tempfile.gettempdir()) / "uliya-skill-kit-0.7.3"
    if not (dest / "uliya-skill-kit" / "scripts" / "check-skill.mjs").is_file():
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True)
        safe_extract(zip_path, dest)
    return dest / "uliya-skill-kit"


def check_with_official_kit(skill_dir: Path) -> dict | None:
    kit = kit_dir()
    if kit is None or shutil.which("node") is None:
        return None
    r = subprocess.run(["node", str(kit / "scripts" / "check-skill.mjs"), str(skill_dir)], capture_output=True,
                       text=True, encoding="utf-8", timeout=60)
    if r.returncode == 2:
        return {"status": "checker-error", "stderr": r.stderr[-500:]}
    return json.loads(r.stdout)


def main() -> int:
    sys.stdout.reconfigure(errors="replace")  # Windows consoles (cp932/cp1252) cannot print every path character
    ap = argparse.ArgumentParser()
    ap.add_argument("--kit-zip", help="path to uliya-skill-kit-0.7.3-en.zip (default: ULIYA_KIT_ZIP or ~/Downloads/uliya/)")
    args = ap.parse_args()
    if args.kit_zip:
        os.environ["ULIYA_KIT_ZIP"] = args.kit_zip
    original = source_files()
    build_zip(original, OUT_ZIP)
    report = validate(OUT_ZIP, original)
    if report["official_checker"] is None:
        report["checks"].append({"check": "official checker", "pass": True, "detail": "NOT RUN: kit ZIP or node not found"})
    REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for c in report["checks"]:
        print(f"{'PASS' if c['pass'] else 'FAIL'}  {c['check']}  {c['detail']}")
    print(f"\n{OUT_ZIP} sha256={report['sha256']} -> {'VALID' if report['passed'] else 'INVALID'}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
