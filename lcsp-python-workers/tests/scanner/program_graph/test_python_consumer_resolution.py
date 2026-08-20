from __future__ import annotations

from lcsp_workers.scanner.program_graph.python_consumer_resolution import (
    PythonConsumerBoundaryResolver,
)
from lcsp_workers.scanner.program_graph.semantic_ir import SemanticProgram


def _edges(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {
        (edge.edge_type, edge.source_key, edge.target_key)
        for edge in program.edges
    }


def test_consumer_base_queue_and_routing_continue_to_handle(tmp_path) -> None:
    source = tmp_path / "consumer.py"
    source.write_text(
        """
from lcsp_workers.platform.queue_consumer import ConsumerBase

class EvidenceConsumer(ConsumerBase):
    queue_name = "investigation.evidence-accepted"
    routing_key = "event.technical-evidence.accepted.v1"

    def handle(self, message, correlationId):
        return self.process(message)

    def process(self, message):
        return message
""",
        encoding="utf-8",
    )

    program = PythonConsumerBoundaryResolver(tmp_path).enrich(SemanticProgram())
    handle = "symbol:consumer.py:handle"

    assert (
        "CONSUMES_FROM_QUEUE",
        "queue:investigation.evidence-accepted",
        handle,
    ) in _edges(program)
    assert (
        "CONSUMES_EVENT",
        "event:event.technical-evidence.accepted.v1",
        handle,
    ) in _edges(program)
    assert not program.unresolved_frontiers


def test_consumer_without_concrete_handle_is_unresolved(tmp_path) -> None:
    source = tmp_path / "consumer.py"
    source.write_text(
        """
from lcsp_workers.platform.queue_consumer import ConsumerBase

class BrokenConsumer(ConsumerBase):
    queue_name = "broken.queue"
    routing_key = "event.broken.v1"
""",
        encoding="utf-8",
    )

    program = PythonConsumerBoundaryResolver(tmp_path).enrich(SemanticProgram())

    assert len(program.unresolved_frontiers) == 1
    unresolved_key = program.unresolved_frontiers[0]
    assert (
        "RESOLVES_TO",
        "symbol:consumer.py:BrokenConsumer",
        unresolved_key,
    ) in _edges(program)
