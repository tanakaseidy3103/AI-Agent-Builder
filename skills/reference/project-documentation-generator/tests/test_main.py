import json
import unittest

from main import run


class TestDocGenerator(unittest.TestCase):
    def test_detects_js_frameworks_and_scripts(self):
        pkg = json.dumps({"scripts": {"dev": "vite", "test": "vitest run"}, "dependencies": {"react": "19"}, "devDependencies": {"vite": "8"}})
        out = run({"files": {"package.json": pkg, "src/App.tsx": "x"}})
        self.assertEqual(out["frameworks"], ["React", "Vite"])
        self.assertEqual(out["scripts"]["npm run test"], "vitest run")
        self.assertIn("| `npm run dev` | `vite` |", out["markdown"])

    def test_python_and_tests(self):
        out = run({"files": {"requirements.txt": "fastapi==0.1\npytest\n", "app/main.py": "", "tests/test_main.py": ""}})
        self.assertEqual(out["frameworks"], ["FastAPI", "pytest"])
        self.assertEqual(out["test_locations"], ["tests"])
        self.assertEqual(out["languages"], {"Python": 2})

    def test_empty_project_is_honest(self):
        out = run({"files": {}})
        self.assertIn("no source files detected", out["markdown"])
        self.assertIn("No tests detected.", out["markdown"])

    def test_invalid_package_json_does_not_crash(self):
        out = run({"files": {"package.json": "{not json"}})
        self.assertEqual(out["scripts"], {})
