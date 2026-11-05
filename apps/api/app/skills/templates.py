"""Deterministic (trusted) files added to every code Skill. Not LLM-generated."""

CLI = '''"""Local runner: python scripts/cli.py [input.json] | --dir PATH
Reads JSON input (file or stdin), or builds {"files": {...}} from a directory, calls run(), prints JSON."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from main import run  # noqa: E402

TEXT_EXT = {".js", ".jsx", ".ts", ".tsx", ".py", ".json", ".md", ".css", ".html", ".txt", ".csv"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv"}


def collect(root):
    files = {}
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for n in names:
            p = os.path.join(d, n)
            if os.path.splitext(n)[1] in TEXT_EXT and os.path.getsize(p) <= 200_000 and len(files) < 500:
                with open(p, encoding="utf-8", errors="replace") as f:
                    files[os.path.relpath(p, root).replace(os.sep, "/")] = f.read()
    return {"files": files}


def main(argv):
    if len(argv) >= 2 and argv[0] == "--dir":
        data = collect(argv[1])
    elif argv:
        with open(argv[0], encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)
    print(json.dumps(run(data), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
'''


def how_to_run(input_schema: dict) -> str:
    uses_files = "files" in input_schema.get("properties", {})
    lines = [
        "## How to run",
        "",
        "This Skill ships a deterministic Python script (stdlib only). From this Skill's directory:",
        "",
        "```bash",
    ]
    if uses_files:
        lines.append("python scripts/cli.py --dir <path-to-project>   # builds {\"files\": {...}} from the folder")
    lines += ["python scripts/cli.py input.json               # or pass JSON matching the input schema", "```", "",
              "Read the JSON output and explain the results to the user. Do not modify files unless asked."]
    return "\n".join(lines)
