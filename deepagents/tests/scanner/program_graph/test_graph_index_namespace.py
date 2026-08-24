from __future__ import annotations

from tools.graph.scanner.evidence_assembler import EvidenceAssembler
from tools.graph.scanner.program_graph.builder import ProgramGraphBuilder
from tools.graph.scanner.program_graph.semantic_ir import SemanticNodeFact, SemanticProgram


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
