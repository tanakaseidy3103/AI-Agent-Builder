"""End-to-end: export a Skill from the running API, install it into a clean project, and let a REAL external
coding agent (Claude Code or Codex CLI) discover and use it. Evidence is saved under docs/evidence/.

    .venv/Scripts/python.exe scripts/e2e_external.py --target claude-code
    .venv/Scripts/python.exe scripts/e2e_external.py --target codex

Pass criteria (all must hold):
  1. the agent's tool stream shows the Skill being loaded (Claude Code: `Skill` tool call with our name;
     Codex: the Skill's SKILL.md read or its scripts/cli.py executed),
  2. the Skill's own script ran (a shell command containing scripts/cli.py),
  3. the final answer reports the defects that are planted in the sample project.
Installs only into a temp project directory: the user's ~/.claude and ~/.codex are never touched.
"""
import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path

SKILL = "python-code-analyzer"
API = os.environ.get("AAB_API", "http://127.0.0.1:8000")
EVIDENCE = Path(__file__).resolve().parents[3] / "docs" / "evidence"
SAMPLE = {
    "app/billing.py": (
        "import json\nimport os\n\n\n"
        "def charge(customer_id, items=[]):\n"
        "    try:\n        return sum(i['price'] for i in items)\n"
        "    except:\n        return 0\n\n\n"
        "def _region():\n    return os.environ.get('REGION')\n"
    ),
}
EXPECTED = ["mutable-default", "bare-except", "unused-import"]  # planted defects
PROMPT = ("Review the Python code in the app/ folder for defects. A project skill is installed for exactly this. "
          "List every finding as `file:line rule`. Do not modify any file.")


def redact_home(text: str) -> str:
    """Evidence is committed: replace the local home path (contains the user name) with ~."""
    home = str(Path.home())
    for variant in (home, home.replace("\\", "\\\\"), home.replace("\\", "/")):
        text = text.replace(variant, "~")
    return text


def get(path: str) -> bytes:
    with urllib.request.urlopen(API + path, timeout=30) as r:
        return r.read()


def version_id() -> str:
    skills = json.loads(get("/studio/skills"))
    sk = next(s for s in skills if s["slug"] == SKILL)
    if sk["latest"]["status"] != "verified":
        raise SystemExit(f"{SKILL} is {sk['latest']['status']}, expected verified")
    return sk["latest"]["id"]


def install(target: str, proj: Path, vid: str) -> Path:
    z = zipfile.ZipFile(io.BytesIO(get(f"/studio/versions/{vid}/export/{target}")))
    dest = proj / (".claude/skills" if target == "claude-code" else ".codex/skills")
    dest.mkdir(parents=True)
    z.extractall(dest)  # our own ZIP; names were validated by safe_relpath at export
    return dest / SKILL


def run_agent(target: str, proj: Path) -> tuple[list[dict], str, int]:
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    if target == "claude-code":
        cmd = [shutil.which("claude"), "-p", PROMPT, "--output-format", "stream-json", "--verbose",
               "--allowedTools", "Skill", "Bash", "Read", "Glob", "Grep", "--max-turns", "15"]
    else:
        cmd = [shutil.which("codex"), "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", PROMPT]
    p = subprocess.run(cmd, cwd=proj, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=600, env=env, stdin=subprocess.DEVNULL)
    events = []
    for line in p.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    return events, p.stderr[-2000:], p.returncode


def analyze(target: str, events: list[dict]) -> dict:
    blob = json.dumps(events, ensure_ascii=False)
    tool_calls = []
    for e in events:
        for c in (e.get("message", {}) or {}).get("content", []) if isinstance(e.get("message"), dict) else []:
            if isinstance(c, dict) and c.get("type") == "tool_use":
                tool_calls.append({"name": c.get("name"), "input": c.get("input")})
        item = e.get("item") if isinstance(e.get("item"), dict) else None  # codex --json
        if item and item.get("type") in ("command_execution", "local_shell_call", "exec_command"):
            tool_calls.append({"name": "shell", "input": {"command": item.get("command")}})
    final = ""
    for e in events:
        if e.get("type") == "result":
            final = e.get("result", "") or final
        item = e.get("item") if isinstance(e.get("item"), dict) else None
        if item and item.get("type") in ("agent_message", "assistant_message"):
            final = item.get("text", "") or final
    if target == "claude-code":
        loaded = any(t["name"] == "Skill" and SKILL in json.dumps(t["input"]) for t in tool_calls)
    else:
        loaded = f"{SKILL}/SKILL.md" in blob.replace("\\\\", "/").replace("\\", "/")
    script_ran = "scripts/cli.py" in blob.replace("\\\\", "/").replace("\\", "/")
    found = {r: bool(re.search(re.escape(r), final)) for r in EXPECTED}
    return {"skill_loaded": loaded, "script_ran": script_ran, "findings_reported": found,
            "passed": loaded and script_ran and all(found.values()), "final_answer": final[-3000:],
            "tool_calls": tool_calls[:40]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["claude-code", "codex"], required=True)
    args = ap.parse_args()
    if not shutil.which("claude" if args.target == "claude-code" else "codex"):
        raise SystemExit(f"{args.target} CLI not installed")
    proj = Path(tempfile.mkdtemp(prefix=f"aab-e2e-{args.target}-"))
    for rel, text in SAMPLE.items():
        (proj / rel).parent.mkdir(parents=True, exist_ok=True)
        (proj / rel).write_text(text, encoding="utf-8")
    installed = install(args.target, proj, version_id())
    events, stderr, code = run_agent(args.target, proj)
    res = analyze(args.target, events)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    out = EVIDENCE / f"e2e-{args.target}-{stamp}.json"
    text = json.dumps({"target": args.target, "skill": SKILL, "installed_at": str(installed.relative_to(proj)),
                       "exit_code": code, "stderr_tail": stderr, **res}, indent=2, ensure_ascii=False)
    out.write_text(redact_home(text), encoding="utf-8")
    print(json.dumps({k: res[k] for k in ("skill_loaded", "script_ran", "findings_reported", "passed")}, indent=2))
    print("exit", code, "| evidence:", out)
    sys.exit(0 if res["passed"] else 1)


if __name__ == "__main__":
    main()
