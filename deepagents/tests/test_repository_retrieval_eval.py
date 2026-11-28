"""Exercise the offline ablation's evidence and source trust boundaries."""

from hashlib import sha256

import pytest
from evals.repository_retrieval import (
    GoldSpan,
    Location,
    RetrievalCase,
    _evidence,
    _score,
    _source_files,
)


def test_evidence_rejects_out_of_scope_and_does_not_credit_partial_spans(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    excerpt = "if enabled:\n    request()"
    (source / "app.py").write_text(excerpt + "\n")
    (tmp_path / "outside.py").write_text("outside\n")
    files = _source_files(source)
    locations = [
        Location("../outside.py", 1, 1), Location(str(tmp_path / "outside.py"), 1, 1),
        Location("app.py", 2, 9), Location("app.py", 2, 2), Location("app.py", 1, 2),
    ]
    evidence, rejected = _evidence(source, files, locations, "fixture", "pinned")
    assert rejected == 3
    assert evidence[-1]["contentSha256"] == sha256(excerpt.encode()).hexdigest()
    case = RetrievalCase(
        id="conditional", category="CONDITIONAL", symbols=("entry",), query="Trace the branch.",
        gold=(GoldSpan(path="app.py", start=1, end=2, anchor="request()", kind="INVOCATION"),),
    )
    scores = _score(case, evidence)
    assert scores["1"]["missedInvocations"] == 1
    assert scores["3"]["complete"]
    assert scores["3"]["precision"] == 1 / 3


def test_fixture_symlink_is_rejected_before_any_source_is_read_through_it(tmp_path):
    outside = tmp_path / "outside.py"
    outside.write_text("raise AssertionError('fixture source was executed')\n")
    source = tmp_path / "fixture"
    source.mkdir()
    (source / "alias.py").symlink_to(outside)
    with pytest.raises(ValueError, match="Symlink in fixture"):
        _source_files(source)


def test_untrusted_source_can_be_cited_as_text_without_importing_it(tmp_path):
    source = tmp_path / "fixture.py"
    source.write_text("raise AssertionError('fixture source was executed')\n")
    evidence, rejected = _evidence(
        tmp_path, _source_files(tmp_path), [Location("fixture.py", 1, 1)], "fixture", "pinned",
    )
    assert rejected == 0
    assert evidence[0]["path"] == "fixture.py"
