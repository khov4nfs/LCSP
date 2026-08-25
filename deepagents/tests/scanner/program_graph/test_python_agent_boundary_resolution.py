from __future__ import annotations

from tools.common.capabilities.evidence.graph.resolution.boundary.python_agent_boundary_resolution import (
    PythonAgentBoundaryResolver,
)
from tools.common.capabilities.evidence.graph.construction.assembly.builder import ProgramGraphBuilder
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticProgram


def _edges(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {
        (edge.edge_type, edge.source_key, edge.target_key)
        for edge in program.edges
    }


def test_agent_boundary_source_and_routing_continue_to_handle(tmp_path) -> None:
    source = tmp_path / "boundary.py"
    source.write_text(
        """
from tools.common.capabilities.managed.boundary import AgentBoundaryBase

class EvidenceBoundary(AgentBoundaryBase):
    boundary_source = "investigation.evidence-accepted"
    source_event = "event.technical-evidence.accepted.v1"

    def handle(self, message, correlationId):
        return self.process(message)

    def process(self, message):
        return message
""",
        encoding="utf-8",
    )

    program = PythonAgentBoundaryResolver(tmp_path).enrich(SemanticProgram())
    handle = "symbol:boundary.py:handle"

    assert (
        "INVOKES_BOUNDARY",
        "agent-boundary-source:investigation.evidence-accepted",
        handle,
    ) in _edges(program)
    assert (
        "INVOKES_BOUNDARY",
        "event:event.technical-evidence.accepted.v1",
        handle,
    ) in _edges(program)
    assert not program.unresolved_frontiers

    builder = ProgramGraphBuilder(
        tmp_path,
        scan_job_id="scan-agent-boundary",
        snapshot_id="snapshot-agent-boundary",
        commit_sha="commit-agent-boundary",
    )
    builder.add_program(program)
    graph = builder.build()

    assert any(
        node["node_type"] == "AGENT_BOUNDARY_SOURCE" for node in graph.nodes
    )


def test_agent_boundary_without_concrete_handle_is_unresolved(tmp_path) -> None:
    source = tmp_path / "boundary.py"
    source.write_text(
        """
from tools.common.capabilities.managed.boundary import AgentBoundaryBase

class BrokenBoundary(AgentBoundaryBase):
    boundary_source = "broken.queue"
    source_event = "event.broken.v1"
""",
        encoding="utf-8",
    )

    program = PythonAgentBoundaryResolver(tmp_path).enrich(SemanticProgram())

    assert len(program.unresolved_frontiers) == 1
    unresolved_key = program.unresolved_frontiers[0]
    assert (
        "RESOLVES_TO",
        "symbol:boundary.py:BrokenBoundary",
        unresolved_key,
    ) in _edges(program)
