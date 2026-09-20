from __future__ import annotations

from pathlib import Path

import pytest

from tools.common.capabilities.evidence.graph.construction.assembly.builder import (
    ProgramGraphBuilder,
    ProgramGraphValidationError,
)
from tools.common.capabilities.evidence.graph.construction.validation.validator import (
    ProgramGraphValidationError as ArtifactValidationError,
    validate_program_graph,
)
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from tools.common.capabilities.evidence.graph.schema.semantic_ir import (
    SemanticEdgeFact,
    SemanticNodeFact,
    SemanticProgram,
)


def _program(edge_type: str = "NAVIGATES_TO") -> SemanticProgram:
    return SemanticProgram(
        nodes=[
            SemanticNodeFact("screen:a", "CLASS", "HomeScreen"),
            SemanticNodeFact("screen:b", "CLASS", "DetailScreen"),
        ],
        edges=[SemanticEdgeFact(edge_type, "screen:a", "screen:b")],
    )


def _build(tmp_path: Path, program: SemanticProgram):
    builder = ProgramGraphBuilder(
        tmp_path,
        scan_job_id="compatibility",
        snapshot_id="snapshot",
        commit_sha="commit",
    )
    builder.add_program(program)
    return builder.build()


def test_navigation_edge_is_accepted_and_deduplicated(tmp_path: Path) -> None:
    graph = _build(
        tmp_path,
        SemanticProgram(
            nodes=_program().nodes,
            edges=[
                SemanticEdgeFact("NAVIGATES_TO", "screen:a", "screen:b"),
                SemanticEdgeFact("NAVIGATES_TO", "screen:a", "screen:b"),
            ],
        ),
    )

    assert [edge["edge_type"] for edge in graph.edges] == ["NAVIGATES_TO"]
    validate_program_graph(graph)


def test_navigation_edge_identity_is_deterministic(tmp_path: Path) -> None:
    first = _build(tmp_path, _program())
    second = _build(tmp_path, _program())

    assert first.graph_id == second.graph_id
    assert first.graph_hash == second.graph_hash
    assert first.edges == second.edges


def test_unknown_edge_type_remains_rejected(tmp_path: Path) -> None:
    with pytest.raises(ProgramGraphValidationError):
        _build(tmp_path, _program("NOT_A_REAL_EDGE"))


def test_historical_graph_without_navigation_edge_remains_valid() -> None:
    historical = {
        "graph_id": "program-graph:historical",
        "snapshot_id": "snapshot",
        "commit_sha": "commit",
        "node_count": 2,
        "edge_count": 1,
        "nodes": [
            {"node_id": "n1", "node_type": "CLASS", "label": "A"},
            {"node_id": "n2", "node_type": "CLASS", "label": "B"},
        ],
        "edges": [
            {
                "edge_id": "e1",
                "edge_type": "CALLS",
                "source_node_id": "n1",
                "target_node_id": "n2",
            }
        ],
        "graph_hash": "sha256:historical",
        "schema_version": "2.0.0",
    }

    graph = ProgramEvidenceGraph.from_dict(historical)
    assert graph.edges[0]["edge_type"] == "CALLS"
    assert validate_program_graph(graph) is graph


def test_navigation_edge_is_visible_to_generic_graph_projection(tmp_path: Path) -> None:
    graph = _build(tmp_path, _program())
    payload = ProgramEvidenceGraph.from_dict(graph.to_dict()).to_dict()

    assert payload["edges"][0]["edge_type"] == "NAVIGATES_TO"
    assert payload["nodes"]


def test_unknown_edge_type_is_rejected_at_artifact_validation_boundary() -> None:
    payload = {
        "graph_id": "program-graph:invalid",
        "snapshot_id": "snapshot",
        "commit_sha": "commit",
        "node_count": 2,
        "edge_count": 1,
        "nodes": [
            {"node_id": "n1", "node_type": "CLASS", "label": "A"},
            {"node_id": "n2", "node_type": "CLASS", "label": "B"},
        ],
        "edges": [
            {
                "edge_id": "e1",
                "edge_type": "NOT_A_REAL_EDGE",
                "source_node_id": "n1",
                "target_node_id": "n2",
            }
        ],
        "graph_hash": "sha256:invalid",
        "schema_version": "2.0.0",
    }

    with pytest.raises(ArtifactValidationError, match="unknown edge type"):
        validate_program_graph(payload)
