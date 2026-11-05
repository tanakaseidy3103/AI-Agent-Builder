"""Export adapters for local AI coding environments.

Each adapter maps the canonical package to the layout a tool expects, keeps the canonical files intact,
and produces install commands that refuse to overwrite an existing Skill.
Formats verified against public docs as of 2026; see docs/skills.md "Supported integrations".
"""
import io
import zipfile
from dataclasses import asdict, dataclass

from app.skills.package import Manifest, instructions_body, safe_relpath


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
    "codex": Target(
        "codex", "OpenAI Codex", "user", "$HOME/.codex/skills", "$HOME\\.codex\\skills",
        "Codex reads Skills with the same SKILL.md frontmatter (name, description). Restart Codex after installing. "
        "Verify the path against your Codex version's docs."),
    "cursor": Target(
        "cursor", "Cursor (project rule)", "project", ".", ".",
        "Cursor has no identical Skill format: this export adds a project rule .cursor/rules/<name>.mdc that points "
        "to the canonical package under .cursor/skills/<name>/. Extract at the project root."),
    "canonical": Target(
        "canonical", "Canonical package", "user", ".", ".", "Original package, unchanged."),
}


def layout(target: str, m: Manifest, files: dict[str, str]) -> dict[str, str]:
    """Return {zip_path: text}. Canonical files are always included unchanged."""
    slug = m.id
    if target in ("claude-code", "codex", "canonical"):
        return {f"{slug}/{p}": t for p, t in files.items()}
    if target == "cursor":
        out = {f".cursor/skills/{slug}/{p}": t for p, t in files.items()}
        rule = (f"---\ndescription: {m.description.replace(chr(10), ' ')}\nalwaysApply: false\n---\n\n"
                f"{instructions_body(files['SKILL.md'])}\n\n"
                f"Skill files live in `.cursor/skills/{slug}/` (run scripts from that directory).\n")
        out[f".cursor/rules/{slug}.mdc"] = rule
        return out
    raise KeyError(target)


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
    check = f".cursor/skills/{m.id}" if target == "cursor" else m.id
    bash = (f'DEST="{tg.install_root}"; if [ -e "$DEST/{check}" ]; then '
            f'echo "{m.id} already exists in $DEST — use the replace command"; '
            f'else mkdir -p "$DEST" && unzip -q "{z}" -d "$DEST" && echo "installed {m.id}@{m.version}"; fi')
    ps = (f'$d = "{tg.install_root_ps}"; if (Test-Path "$d\\{check}") {{ "{m.id} already exists in $d — use the replace command" }} '
          f'else {{ New-Item -ItemType Directory -Force $d | Out-Null; Expand-Archive "{z}" -DestinationPath $d; "installed {m.id}@{m.version}" }}')
    backup = f"{check}.bak-$(date +%Y%m%d%H%M%S)"
    # cursor: the .mdc rule outside the backed-up dir must be overwritten, hence -o / -Force
    force_sh, force_ps = (" -o", " -Force") if target == "cursor" else ("", "")
    replace_bash = f'DEST="{tg.install_root}"; mv "$DEST/{check}" "$DEST/{backup}" && unzip{force_sh} -q "{z}" -d "$DEST"'
    replace_ps = (f'$d = "{tg.install_root_ps}"; Rename-Item "$d\\{check}" "{check.rsplit("/", 1)[-1]}.bak-$(Get-Date -Format yyyyMMddHHmmss)"; '
                  f'Expand-Archive "{z}" -DestinationPath $d{force_ps}')
    return {
        "target": asdict(tg), "zip": z, "skill": m.id, "version": m.version,
        "install": {"bash": bash, "powershell": ps},
        "replace": {"bash": replace_bash, "powershell": replace_ps,
                    "warning": "Replaces an installed copy. The existing directory is renamed to a .bak-* backup first."},
        "note": "Commands run on your machine; AI Agent Builder cannot confirm the installation.",
    }
