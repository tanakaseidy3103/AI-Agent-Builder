import unittest

from main import run


def rules(files):
    return sorted(f["rule"] for f in run({"files": files})["findings"])


class TestLaravel(unittest.TestCase):
    def test_sql_injection_interpolation_and_concat(self):
        self.assertEqual(rules({"a.php": '$u = DB::select("select * from users where id = $id");'}), ["sql-injection"])
        self.assertEqual(rules({"a.php": "$q->whereRaw('name = ' . $name);"}), ["sql-injection"])
        self.assertEqual(rules({"a.php": "DB::select('select * from users where id = ?', [$id]);"}), [])

    def test_env_only_flagged_outside_config(self):
        self.assertEqual(rules({"app/Svc.php": "$k = env('KEY');"}), ["env-outside-config"])
        self.assertEqual(rules({"config/services.php": "'key' => env('KEY'),"}), [])

    def test_blade_csrf(self):
        self.assertEqual(rules({"v.blade.php": '<form method="POST" action="/x"><button/></form>'}), ["missing-csrf"])
        self.assertEqual(rules({"v.blade.php": '<form method="POST">@csrf<button/></form>'}), [])
        self.assertEqual(rules({"v.blade.php": '<form method="GET"></form>'}), [])

    def test_mass_assignment_and_debug(self):
        out = rules({"m.php": "protected $guarded = [];\nUser::create($request->all());\ndd($user);"})
        self.assertEqual(out, ["debug-left", "mass-assignment-unguarded", "unvalidated-mass-assignment"])

    def test_severity_counts(self):
        out = run({"files": {"a.php": "dd($x);"}})
        self.assertEqual(out["by_severity"], {"high": 0, "medium": 0, "low": 1})
