"""Export adapters for local AI coding environments.

Each adapter maps the canonical package to the layout a tool expects, keeps the canonical files intact,
and produces install commands that refuse to overwrite an existing Skill.
Formats verified against public docs as of 2026; see docs/skills.md "Supported integrations".
"""
import io
import zipfile
from dataclasses import asdict, dataclass

from app.skills.package import Manifest, safe_relpath


@dataclass(frozen=True)
class Target:
    id: str
    label: str
    scope: str  # user | project
    install_root: str  # where the ZIP is extracted (bash notation)
    install_root_ps: str
    notes: str


TARGETS: dict[str, Target] = {
    "claude-code": Target(
        "claude-code", "Claude Code", "user", "$HOME/.claude/skills", "$HOME\\.claude\\skills",
        "Claude Code discovers Skills in ~/.claude/skills/<name>/SKILL.md (or <project>/.claude/skills/). "
        "Start a new session after installing."),
    # Paths from the official docs fetched 2026-11-05: https://learn.chatgpt.com/docs/build-skills
    "codex": Target(
        "codex", "OpenAI Codex", "user", "$HOME/.agents/skills", "$HOME\\.agents\\skills",
        "Codex discovers Skills in ~/.agents/skills/<name>/SKILL.md (user) or <repo>/.agents/skills/ (project). "
        "Restart Codex after installing."),
    # https://cursor.com/docs/skills: native Agent Skills. Not end-to-end tested here (Cursor not installed).
    "cursor": Target(
        "cursor", "Cursor", "project", ".cursor/skills", ".cursor\\skills",
        "Cursor loads native Agent Skills from <project>/.cursor/skills/<name>/SKILL.md. Run the command at the "
        "project root. Not verified end-to-end by AI Agent Builder."),
    "canonical": Target(
        "canonical", "Canonical package", "user", ".", ".", "Original package, unchanged."),
}


def layout(target: str, m: Manifest, files: dict[str, str]) -> dict[str, str]:
    """Return {zip_path: text}. Canonical files are always included unchanged."""
    slug = m.id
    if target not in TARGETS:
        raise KeyError(target)
    return {f"{slug}/{p}": t for p, t in files.items()}  # every target uses the Agent Skills folder layout


def build_zip(target: str, m: Manifest, files: dict[str, str]) -> bytes:
    for p in files:
        safe_relpath(p)  # never export something we would not accept
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path, text in sorted(layout(target, m, files).items()):
            info = zipfile.ZipInfo(path, date_time=(2026, 1, 1, 0, 0, 0))  # reproducible archives
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, text)
    return buf.getvalue()


def zip_name(target: str, m: Manifest) -> str:
    return f"{m.id}-{m.version}-{target}.zip"


def install_instructions(target: str, m: Manifest) -> dict:
    tg = TARGETS[target]
    z = zip_name(target, m)
    check = m.id
    bash = (f'DEST="{tg.install_root}"; if [ -e "$DEST/{check}" ]; then '
            f'echo "{m.id} already exists in $DEST — use the replace command"; '
            f'else mkdir -p "$DEST" && unzip -q "{z}" -d "$DEST" && echo "installed {m.id}@{m.version}"; fi')
    ps = (f'$d = "{tg.install_root_ps}"; if (Test-Path "$d\\{check}") {{ "{m.id} already exists in $d — use the replace command" }} '
          f'else {{ New-Item -ItemType Directory -Force $d | Out-Null; Expand-Archive "{z}" -DestinationPath $d; "installed {m.id}@{m.version}" }}')
    backup = f"{check}.bak-$(date +%Y%m%d%H%M%S)"
    replace_bash = f'DEST="{tg.install_root}"; mv "$DEST/{check}" "$DEST/{backup}" && unzip -q "{z}" -d "$DEST"'
    replace_ps = (f'$d = "{tg.install_root_ps}"; Rename-Item "$d\\{check}" "{check}.bak-$(Get-Date -Format yyyyMMddHHmmss)"; '
                  f'Expand-Archive "{z}" -DestinationPath $d')
    return {
        "target": asdict(tg), "zip": z, "skill": m.id, "version": m.version,
        "install": {"bash": bash, "powershell": ps},
        "replace": {"bash": replace_bash, "powershell": replace_ps,
                    "warning": "Replaces an installed copy. The existing directory is renamed to a .bak-* backup first."},
        "note": "Commands run on your machine; AI Agent Builder cannot confirm the installation.",
    }
