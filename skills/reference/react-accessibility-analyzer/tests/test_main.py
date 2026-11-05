import unittest

from main import run


def rules(src, name="C.tsx"):
    return [f["rule"] for f in run({"files": {name: src}})["findings"]]


class TestA11y(unittest.TestCase):
    def test_img_without_alt(self):
        self.assertEqual(rules('<img src="logo.png" />'), ["img-alt"])
        self.assertEqual(rules('<img src="logo.png" alt="" />'), [])

    def test_clickable_div(self):
        self.assertEqual(rules("<div onClick={() => open()}>x</div>"), ["click-without-keyboard"])
        self.assertEqual(rules('<div role="button" tabIndex={0} onClick={go} onKeyDown={key}>x</div>'), [])

    def test_anchor_href(self):
        self.assertEqual(rules('<a href="#">More</a>'), ["anchor-href"])
        self.assertEqual(rules('<a href="/docs">Docs</a>'), [])

    def test_input_label(self):
        self.assertEqual(rules('<input type="text" />'), ["input-label"])
        self.assertEqual(rules('<input type="text" aria-label="Search" />'), [])
        self.assertEqual(rules('<input type="hidden" name="t" />'), [])

    def test_line_numbers_and_non_frontend_files(self):
        out = run({"files": {"a.tsx": "\n\n<img src={x} />", "b.py": "<img>"}})
        self.assertEqual(out["files_scanned"], 1)
        self.assertEqual(out["findings"][0]["line"], 3)
