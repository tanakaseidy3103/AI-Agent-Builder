# Python Code Analyzer

Statically analyzes Python source files for common defects using the standard library `ast` module.
No network, no external dependencies, no LLM.

**Status:** `verified` (all static checks + unit tests + eval cases pass in the Docker sandbox)
**Kind:** `code` · **Origin:** human-written reference Skill

## Capabilities

Detects:
- **bare-except** — `except:` without a type (catches `KeyboardInterrupt`/`SystemExit`)
- **mutable-default** — mutable default arguments (`def f(items=[])`)
- **long-function** — functions longer than 50 lines
- **missing-docstring** — public functions and classes with no docstring
- **unused-import** — imported names never referenced in the file

## Limitations

- Analyzes `.py` files only; non-Python files are ignored.
- Does not follow imports between files.
- `long-function` threshold is 50 lines (not configurable via input).
- Does not detect runtime errors, type mismatches, or logic bugs.

## Requirements

- Python 3.12 (standard library only — `ast`, no external packages)
- No network access required

## Input format

```json
{
  "files": {
    "path/to/file.py": "source code as a string",
    "another/file.py": "..."
  }
}
```

`files` is a JSON object mapping relative file paths to their source text.

## Output format

```json
{
  "findings": [
    {
      "file": "path/to/file.py",
      "line": 12,
      "rule": "bare-except",
      "message": "bare 'except:' also catches KeyboardInterrupt/SystemExit; catch Exception or a specific error"
    }
  ],
  "count": 1,
  "parse_errors": []
}
```

## Usage examples

### Run from the CLI

```bash
# From this Skill's directory:
python scripts/cli.py --dir /path/to/project      # scan a directory
python scripts/cli.py input.json                  # from a JSON file
```

### Run via the AI Agent Builder Python SDK

```python
from agent_builder import SkillClient
client = SkillClient(base_url="http://localhost:8000", api_key="aab_your_key")
result = client.run("python-code-analyzer", {
    "files": {"main.py": open("main.py").read()}
})
print(result["count"], "findings")
```

### Run the unit tests independently

```bash
cd skills/reference/python-code-analyzer
python -c "
import sys; sys.path.insert(0, 'scripts')
import importlib.util, unittest
spec = importlib.util.spec_from_file_location('test_main', 'tests/test_main.py')
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(mod))
"
# Expected: 6 tests, all OK
```

## Expected results for a known input

Input:
```python
import os

def process(data, items=[]):
    try:
        return data
    except:
        pass
```

Expected output findings: `unused-import` (os), `missing-docstring` (process), `mutable-default` (items=[]), `bare-except`.

## Install in a coding agent

```bash
# Claude Code
claude skill install ./python-code-analyzer.zip

# Codex
codex skill install ./python-code-analyzer.zip

# Or use the export command from AI Agent Builder Studio → Export tab
```

See `manifest.json` for the full input/output contract and `SKILL.md` for agent instructions.
