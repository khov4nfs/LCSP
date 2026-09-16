from __future__ import annotations

from tools.common.capabilities.evidence.scanner.assembly.evidence_assembler import EvidenceAssembler
from tools.common.capabilities.evidence.graph.construction.assembly.builder import ProgramGraphBuilder
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticNodeFact, SemanticProgram


def test_secret_node_type_uses_namespaced_index_and_passes_evidence_privacy(tmp_path) -> None:
    program = SemanticProgram()
    program.add_node(
        SemanticNodeFact(
            key="secret-category",
            node_type="SECRET",
            label="Secret data category",
        )
    )

    builder = ProgramGraphBuilder(
        tmp_path,
        scan_job_id="scan-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
    )
    builder.add_program(program)
    graph = builder.build()

    assert "SECRET" not in graph.indexes
    assert "node:SECRET" in graph.indexes
    assert len(graph.indexes["node:SECRET"]) == 1

    # Regression: SECRET is canonical graph vocabulary, not a credential field.
    # Namespaced indexes must remain compatible with the final evidence privacy
    # boundary while real forbidden fields are still rejected elsewhere.
    EvidenceAssembler()._assert_safe_payload({"evidence_graph": graph.to_dict()})


def test_graph_id_and_hash_share_one_canonical_body_digest(tmp_path) -> None:
    program = SemanticProgram()
    for index in range(3):
        program.add_node(
            SemanticNodeFact(
                key=f"node-{index}",
                node_type="FUNCTION",
                label=f"Function {index}",
            )
        )
    builder = ProgramGraphBuilder(
        tmp_path,
        scan_job_id="scan-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
    )
    builder.add_program(program)
    graph = builder.build()

    body = {
        "schema_version": graph.schema_version,
        "snapshot_id": graph.snapshot_id,
        "commit_sha": graph.commit_sha,
        "nodes": graph.nodes,
        "edges": graph.edges,
        "source_anchors": graph.source_anchors,
        "indexes": graph.indexes,
        "unresolved_frontiers": graph.unresolved_frontiers,
        "coverage_state": graph.coverage_state,
        "coverage_notes": graph.coverage_notes,
        "provenance": graph.provenance,
        "evidence_refs": graph.evidence_refs,
    }
    # Identical to the previous separate _stable_id(...) serialization.
    assert graph.graph_id == ProgramGraphBuilder._stable_id("program-graph", body)
    assert graph.graph_hash == "sha256:" + graph.graph_id.split(":", 1)[1] + graph.graph_hash[39:]
