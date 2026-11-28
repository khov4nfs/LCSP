"""Exercise the offline ablation's evidence and source trust boundaries."""

import json
import stat
import subprocess
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

import pytest
from evals.repository_retrieval import (
    _FIXTURES,
    _K,
    _MAX_LINES,
    GoldSpan,
    Graph,
    Location,
    RetrievalCase,
    _evidence,
    _graph_locations,
    _run_snapshot,
    _score,
    _source_files,
    run_repository_retrieval,
)


def test_query_only_graph_seeds_and_traces_from_query():
    calls = []

    class ScriptedGraph:
        def call(self, tool, **arguments):
            calls.append((tool, arguments))
            if tool == "trace_path":
                return {"callees": {"cols": ["name", "hop"], "groups": [
                    {"qn_prefix": "repo.service", "rows": [["send", 1]]},
                    {"qn_prefix": "unrelated", "rows": [["outside", 1]]},
                ]}}
            if "qn_pattern" in arguments:
                assert "unrelated" not in arguments["qn_pattern"]
                name, path, prefix, lines = "send", "service.py", "repo.service", "3-5"
            else:
                assert arguments["query"] == "Find the translation entrypoint"
                assert "name_pattern" not in arguments
                return {
                    "cols": ["qn", "label", "file", "lines", "rank"],
                    "rows": [["repo.app.translate_document", "Function", "app.py", "1-2", -0.5]],
                }
            return {"cols": ["name", "label", "lines"], "groups": [
                {"qn_prefix": prefix, "file": path, "rows": [[name, "Function", lines]]},
            ]}

    locations, coverage = _graph_locations(ScriptedGraph(), "repo", (), "Find the translation entrypoint")
    assert locations == [Location("app.py", 1, 2), Location("service.py", 3, 5)]
    assert coverage["toolCalls"] == len(calls) == 3


def test_negative_evidence_scoring_only_measures_source_coverage():
    case = RetrievalCase(
        id="dormant", category="DEAD_CODE", symbols=("unused",), query="Check an unused provider",
        gold=(GoldSpan(path="app.py", start=2, end=3, anchor="create", kind="DORMANT_INVOCATION"),),
    )
    missed = _score(case, [])["5"]
    found = _score(case, [{"path": "app.py", "start_line": 1, "end_line": 3}])["5"]
    assert missed["negativeEvidenceCovered"] == 0
    assert found["negativeEvidenceCovered"] == found["negativeEvidenceTotal"] == 1
    assert missed["missedInvocations"] == found["missedInvocations"] == 0


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


def test_scripted_pipeline_reproduces_rankings_and_manifest(tmp_path, monkeypatch):
    binary = tmp_path / "scripted-engine"
    binary.write_text("fixture binary identifier")
    stopped = []

    def version(argv, **kwargs):
        assert argv == [str(binary), "--version"]
        return SimpleNamespace(stdout="codebase-memory-mcp 0.11.0\n")

    def command(graph, *args):
        if args == ("daemon", "stop"):
            stopped.append(graph.cache)
        if args[0] == "daemon":
            return ""
        if args[2] == "index_repository":
            request = json.loads(args[3])
            assert Path(request["repo_path"]) == graph.source
            assert request["persistence"] is False
            assert graph.cache.parent == graph.source.parent
            assert all(not path.stat().st_mode & stat.S_IWUSR for path in graph.source.rglob("*.py"))
            return '{"status":"indexed"}'
        assert args[2] == "search_graph"
        request = json.loads(args[3])
        if request["project"] == "repo-09-cross-file":
            return json.dumps({"cols": ["name", "label", "lines"], "groups": [
                {"qn_prefix": "repo-09-cross-file.service", "file": "service.py",
                 "rows": [["direct_request", "Class", "8-10"], ["duplicate", "Class", "9-9"]]},
            ]})
        return '{"groups":[]}'

    monkeypatch.setattr(subprocess, "run", version)
    monkeypatch.setattr(Graph, "_command", command)
    first, second = (run_repository_retrieval(binary, tmp_path / name) for name in ("first", "second"))
    assert (tmp_path / "first/manifest.json").read_bytes() == (tmp_path / "second/manifest.json").read_bytes()
    assert first["summary"] == second["summary"]
    assert first["caseCount"] == 32
    assert {mode: len(ids) for mode, ids in json.loads(
        (tmp_path / "first/manifest.json").read_text(),
    )["cohorts"].items()} == {"symbolConditioned": 20, "queryOnly": 12}
    assert len(stopped) == 18 and all(not cache.exists() for cache in stopped)
    for lhs, rhs in zip(first["cases"], second["cases"], strict=True):
        assert lhs["arms"] == rhs["arms"]
        for result in lhs["arms"].values():
            evidence = result["evidence"]
            assert len(evidence) <= max(_K)
            assert all(item["end_line"] - item["start_line"] + 1 <= _MAX_LINES for item in evidence)
            assert all(item["repositoryId"] == lhs["repositoryId"] for item in evidence)
            assert len({item["commitSha"] for item in evidence}) <= 1
        if lhs["repositoryId"] == "repo-09-cross-file":
            a, b, c = (lhs["arms"][arm]["evidence"] for arm in ("A", "B", "C"))
            assert a[:2] == b[:2] == c[:2]
            assert [item["path"] for item in a[:2]] == ["config.py", "requirements.txt"]
            assert c[2] == b[2]
            assert not any(item["path"] == "service.py" and item["start_line"] == 9 for item in c)


def test_snapshot_rejects_pin_before_graph_start(tmp_path, monkeypatch):
    (tmp_path / "app.py").write_text("invalidated snapshot\n")
    monkeypatch.setattr(Graph, "_command", lambda *_: pytest.fail("started graph for stale source"))
    with pytest.raises(ValueError, match="Fixture tree pin mismatch"):
        _run_snapshot(tmp_path, "bad-pin", "repo", [], tmp_path / "unused")


def test_context_character_budget_is_shared(tmp_path, monkeypatch):
    monkeypatch.setattr("evals.repository_retrieval._MAX_CHARS", 4)
    (tmp_path / "app.py").write_text("abc\ndef\n")
    evidence, rejected = _evidence(
        tmp_path, _source_files(tmp_path),
        [Location("app.py", 1, 1), Location("app.py", 2, 2)], "repo", "pin",
    )
    assert len(evidence) == rejected == 1


@pytest.mark.parametrize("failure", ["engine-exit", "timeout"])
def test_graph_failure_cleans_lifecycle_and_scratch(tmp_path, monkeypatch, failure):
    fixture = json.loads((_FIXTURES / "cross_file_cases.json").read_text())
    source = _FIXTURES / "repos" / fixture["fixture"]
    events = []

    def command(argv, **kwargs):
        events.append((argv[1:3], kwargs["cwd"], kwargs["env"]))
        if argv[1] == "cli":
            if failure == "timeout":
                raise subprocess.TimeoutExpired(argv, kwargs["timeout"])
            return SimpleNamespace(returncode=1, stdout="", stderr="scripted graph failure")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", command)
    with pytest.raises(subprocess.TimeoutExpired if failure == "timeout" else RuntimeError):
        _run_snapshot(source, fixture["fixtureSha256"], source.name, [], tmp_path / "unused")
    assert [command for command, *_ in events] == [["daemon", "start"], ["cli", "--quiet"], ["daemon", "stop"]]
    assert all(env == events[0][2] for _, _, env in events)
    assert not events[0][1].exists()
