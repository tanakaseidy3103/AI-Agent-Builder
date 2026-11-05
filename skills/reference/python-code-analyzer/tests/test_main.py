import unittest

from main import run


def rules(src, name="m.py"):
    return [f["rule"] for f in run({"files": {name: src}})["findings"]]


class TestPythonAnalyzer(unittest.TestCase):
    def test_bare_except(self):
        self.assertIn("bare-except", rules("def f():\n    '''d'''\n    try:\n        pass\n    except:\n        pass\n"))

    def test_mutable_default(self):
        self.assertIn("mutable-default", rules("def f(x=[]):\n    '''d'''\n    return x\n"))

    def test_unused_import_but_used_attribute_ok(self):
        r = rules("import os\nimport sys\n\ndef f():\n    '''d'''\n    return os.path.sep\n")
        self.assertEqual(r.count("unused-import"), 1)

    def test_missing_docstring_only_public(self):
        r = rules("def public():\n    return 1\n\ndef _private():\n    return 2\n")
        self.assertEqual(r, ["missing-docstring"])

    def test_syntax_error_reported_not_raised(self):
        out = run({"files": {"bad.py": "def f(:\n"}})
        self.assertEqual(out["count"], 0)
        self.assertEqual(len(out["parse_errors"]), 1)

    def test_non_python_files_ignored(self):
        self.assertEqual(run({"files": {"a.js": "except:"}})["count"], 0)
