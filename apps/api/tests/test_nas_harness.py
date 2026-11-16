"""Local NAS Project Memory harness: scope, evidence, untrusted text, citation review.

MOCKED ENVIRONMENT: a local copy of hackathons/ugreen-2026/tests/fixtures stands in for a NAS folder. These tests
prove the harness rules, not behaviour on a UGREEN device or of the platform experts.
"""
import os
import shutil
from pathlib import Path

import pytest

from app.nas.citations import review
from app.nas.evidence import collect_evidence, injection_warnings
from app.nas.scope import AuthorizedFolder, ScopeError

FIXTURES = Path(__file__).resolve().parents[3] / "hackathons" / "ugreen-2026" / "tests" / "fixtures"
pytestmark = pytest.mark.skipif(not FIXTURES.is_dir(), reason="UGREEN fixtures not present")

KICKOFF = "meetings/2026-03-02-kickoff.md"
STEERING = "meetings/2026-04-14-steering.md"
VENDOR = "notes-from-vendor.md"


@pytest.fixture
def nas(tmp_path) -> Path:
    shutil.copytree(FIXTURES, tmp_path / "volume1", ignore=shutil.ignore_patterns("README.md"))
    return tmp_path / "volume1"


@pytest.fixture
def apollo(nas) -> AuthorizedFolder:
    return AuthorizedFolder(nas / "apollo-project")


# ---------------------------------------------------------------- scope

def test_find_lists_only_documents_inside_the_authorized_folder(apollo):
    found = sorted(e.path for e in apollo.find())
    assert found == [KICKOFF, STEERING, VENDOR, "plans/project-plan-v1.md", "plans/requirements-copy.md"]
    assert not any("salaries" in p for p in found)


@pytest.mark.parametrize("bad", ["../private-hr/salaries.md", "..", "meetings/../../private-hr/salaries.md",
                                 "/etc/passwd", "C:/Windows/win.ini", "C:\\Windows\\win.ini",
                                 "..\\private-hr\\salaries.md", "x\x00.md"])
def test_paths_outside_the_folder_are_refused(apollo, bad):
    with pytest.raises(ScopeError):
        apollo.cat(bad)


def test_link_pointing_outside_the_folder_is_refused_and_not_listed(nas, apollo):
    link = nas / "apollo-project" / "hr-link.md"
    try:
        os.symlink(nas / "private-hr" / "salaries.md", link)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks need extra privileges on this machine")
    with pytest.raises(ScopeError):
        apollo.cat("hr-link.md")
    assert "hr-link.md" not in [e.path for e in apollo.find()]


@pytest.mark.skipif(os.name != "nt", reason="directory junctions are Windows-only")
def test_junction_pointing_outside_the_folder_is_refused_and_not_listed(nas, apollo):
    import subprocess
    junction = nas / "apollo-project" / "hr"
    r = subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(nas / "private-hr")], capture_output=True)
    if r.returncode != 0:
        pytest.skip("could not create a junction")
    with pytest.raises(ScopeError):
        apollo.cat("hr/salaries.md")
    assert not any(e.path.startswith("hr/") for e in apollo.find())
    assert not any(e.path.startswith("hr") for e in apollo.ls(recursive=True))


def test_empty_folder_gives_an_empty_result_not_an_error(nas):
    folder = AuthorizedFolder(nas / "empty-project")
    assert folder.find() == []  # .keep is hidden and not a document
    assert collect_evidence(folder, "status").passages == []


def test_unreadable_formats_are_reported_not_guessed(nas, apollo):
    (nas / "apollo-project" / "contract.pdf").write_bytes(b"%PDF-1.4 binary")
    res = collect_evidence(apollo, "provider")
    assert "contract.pdf" in res.unreadable
    assert "contract.pdf" not in res.documents_read


def test_harness_has_no_write_operations():
    public = {n for n in dir(AuthorizedFolder) if not n.startswith("_")}
    assert public == {"cat", "find", "ls", "rel", "resolve"}


def test_secret_outside_scope_never_appears_in_evidence(apollo):
    res = collect_evidence(apollo, "salary confidential marker")
    assert all("CONFIDENTIAL-MARKER-7731" not in p.text for p in res.passages)


# ---------------------------------------------------------------- evidence

def test_evidence_points_at_exact_file_and_line(apollo):
    res = collect_evidence(apollo, "Which payment provider did we choose?")
    hits = {(p.path, p.text) for p in res.passages}
    assert (KICKOFF, "- D1: The payment provider is **Provider A**.") in hits
    assert any(p.path == STEERING and "Provider B" in p.text for p in res.passages)
    line = next(p for p in res.passages if p.path == KICKOFF and "Provider A" in p.text).line_start
    assert apollo.cat(KICKOFF).splitlines()[line - 1].endswith("**Provider A**.")


def test_injected_instruction_is_a_warning_and_stays_data(apollo):
    res = collect_evidence(apollo, "vendor refunds")
    assert {w["path"] for w in res.warnings} == {VENDOR}  # both lines of the planted comment, nothing else
    assert injection_warnings("x.md", "Ren Ito owns the integration.") == []


# ---------------------------------------------------------------- citation review (Reviewer role)

def test_real_quotes_pass_review(apollo):
    answer = {"claims": [
        {"kind": "confirmed", "text": "Provider B replaced Provider A.",
         "sources": [{"path": STEERING, "quote": "The payment provider changes to Provider B"},
                     {"path": KICKOFF, "quote": "The payment provider is **Provider A**."}]},
        {"kind": "inference", "text": "Launch is likely to slip past 2026-07-31.",
         "basis": "R1 onboarding takes 4-6 weeks", "sources": [{"path": STEERING, "quote": "onboarding takes 4–6 weeks"}]},
        {"kind": "unknown", "text": "Owner of the invoice migration: not stated in the documents read."},
    ]}
    assert review(answer, apollo) == []


def test_fabricated_quote_is_caught(apollo):
    answer = {"claims": [{"kind": "confirmed", "text": "Provider C was chosen.",
                          "sources": [{"path": STEERING, "quote": "The payment provider changes to Provider C"}]}]}
    assert [i.code for i in review(answer, apollo)] == ["source.quote_not_found"]


def test_confirmed_claim_without_source_is_caught(apollo):
    answer = {"claims": [{"kind": "confirmed", "text": "Mika Sato owns the invoice migration."}]}
    assert [i.code for i in review(answer, apollo)] == ["confirmed.no_source"]


def test_citing_a_file_outside_the_folder_is_caught(apollo):
    answer = {"claims": [{"kind": "confirmed", "text": "x",
                          "sources": [{"path": "../private-hr/salaries.md", "quote": "salary"}]}]}
    assert [i.code for i in review(answer, apollo)] == ["source.out_of_scope"]


def test_inference_needs_a_basis_and_kinds_are_closed(apollo):
    answer = {"claims": [{"kind": "inference", "text": "probably late"}, {"kind": "fact", "text": "x"}]}
    assert [i.code for i in review(answer, apollo)] == ["inference.no_basis", "claim.kind"]
