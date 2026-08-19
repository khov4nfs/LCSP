from __future__ import annotations

from lcsp_workers.investigation.evidence_ledger import EvidenceLedger


def test_evidence_alias_pages_canonical_evidence_refs_without_error() -> None:
    ledger = EvidenceLedger()
    observation = ledger.add(
        source="graph_tool",
        result={
            "nodes": [],
            "evidenceRefs": ["evidence:1", "evidence:2"],
            "truncated": False,
        },
    )

    result = ledger.inspect(observation.observation_id, section="evidence")

    assert result["section"] == "evidenceRefs"
    assert result["requestedSection"] == "evidence"
    assert result["items"] == ["evidence:1", "evidence:2"]
    assert "error" not in result


def test_unknown_section_returns_exact_available_sections_and_retry_instruction() -> None:
    ledger = EvidenceLedger()
    observation = ledger.add(
        source="graph_tool",
        result={
            "nodes": [{"node_id": "node-1"}],
            "continuationFrontiers": ["node-2"],
            "unresolvedFrontiers": [],
            "evidenceRefs": ["evidence:1"],
        },
    )

    result = ledger.inspect(observation.observation_id, section="made_up")

    assert result["error"] == "OBSERVATION_SECTION_NOT_PAGEABLE"
    assert set(result["availableSections"]) == {
        "nodes",
        "continuationFrontiers",
        "unresolvedFrontiers",
        "evidenceRefs",
    }
    assert "availableSections" in result["instruction"]


def test_summary_advertises_observation_specific_sections() -> None:
    ledger = EvidenceLedger()
    graph = ledger.add(
        source="graph_tool",
        result={"nodes": [{"node_id": "node-1"}], "evidenceRefs": ["evidence:1"]},
    )
    code = ledger.add(
        source="code_context_tool",
        tool="search_code",
        result={
            "results": [{"symbolId": "sym://abc/src/a.py#run"}],
            "truncated": False,
        },
    )

    assert ledger.summary(graph)["availableSections"] == ["nodes", "evidenceRefs"]
    assert ledger.summary(code)["availableSections"] == ["results"]
    assert ledger.preview(code.observation_id)["section"] == "results"


def test_oversized_requested_page_is_shrunk_instead_of_returning_working_view_error() -> None:
    ledger = EvidenceLedger()
    observation = ledger.add(
        source="code_context_tool",
        tool="repo_map",
        result={
            "files": [
                {
                    "path": f"src/module_{index}.py",
                    "symbols": [{"symbolId": f"sym:{index}", "metadata": "x" * 3000}],
                }
                for index in range(40)
            ],
            "truncated": True,
        },
    )

    result = ledger.inspect(observation.observation_id, section="files", limit=40)

    assert result["pageCharBoundApplied"] is True
    assert result["requestedLimit"] == 40
    assert 1 <= result["limit"] < 40
    assert result["hasMore"] is True
    assert "error" not in result
