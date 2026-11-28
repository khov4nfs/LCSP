"""Opt-in integration coverage for the host benchmark's trusted fixture boundary."""

import json
import os
import stat
import subprocess
from pathlib import Path

import pytest
from evals.repository_retrieval import _FIXTURES, Graph, RetrievalCase, _run_snapshot


@pytest.mark.integration
@pytest.mark.parametrize("force_timeout", [False, True])
def test_native_fixture_access_and_daemon_cleanup(monkeypatch, force_timeout):
    binary_path = os.environ.get("LCSP_RETRIEVAL_GRAPH_BINARY")
    if not binary_path:
        pytest.skip("Set LCSP_RETRIEVAL_GRAPH_BINARY to the trusted native 0.11.0 binary")
    fixture = json.loads((_FIXTURES / "cross_file_cases.json").read_text())
    source = _FIXTURES / "repos" / fixture["fixture"]
    case = RetrievalCase.model_validate(fixture["cases"][0])
    command = Graph._command
    sessions = []

    def observed(graph, *args, **kwargs):
        if args == ("daemon", "stop"):
            response = command(graph, *args, **kwargs)
            # The native status command exits 1 when the scoped daemon is gone.
            with pytest.raises(RuntimeError, match="daemon: not running"):
                command(graph, "daemon", "status")
            sessions.append(graph.cache)
            return response
        if args[:3] == ("cli", "--quiet", "search_graph"):
            assert graph.source.joinpath("app.py").read_text() == source.joinpath("app.py").read_text()
            assert not graph.source.joinpath("app.py").stat().st_mode & stat.S_IWUSR
            # This really times out a native client. Shutdown still uses the normal timeout.
            if force_timeout:
                return command(graph, *args, timeout=0)
        if args[:3] == ("cli", "--quiet", "index_repository") and not force_timeout:
            # Probe an isolated sibling rather than giving the native tool access to host data.
            request = json.dumps({"repo_path": str(graph.cache), "mode": "full", "name": "outside-source"})
            with pytest.raises(RuntimeError, match="outside the allowed root"):
                command(graph, "cli", "--quiet", "index_repository", request)
        return command(graph, *args, **kwargs)

    monkeypatch.setattr(Graph, "_command", observed)
    discovery = case.model_copy(update={"id": f"query-{case.id}", "symbols": ()})
    arguments = (source, fixture["fixtureSha256"], source.name, [case, discovery], Path(binary_path).resolve(strict=True))
    if force_timeout:
        with pytest.raises(subprocess.TimeoutExpired):
            _run_snapshot(*arguments)
    else:
        _, rows = _run_snapshot(*arguments)
        assert rows[0]["arms"]["B"]["evidence"]
        assert rows[0]["arms"]["B"]["metrics"]["10"]["complete"]
        assert rows[1]["cohort"] == "queryOnly"
        assert rows[1]["graphCoverage"]["seedCount"] > 0
    assert len(sessions) == 1 and not sessions[0].exists()
