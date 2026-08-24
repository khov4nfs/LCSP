from __future__ import annotations

from tools.graph.scanner.program_graph.semantic_ir import (
    SemanticEdgeFact,
    SemanticNodeFact,
    SemanticProgram,
)
from tools.graph.scanner.program_graph.source_roles import (
    exclude_test_sources_from_semantic_program,
)


def _edges(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {
        (edge.edge_type, edge.source_key, edge.target_key)
        for edge in program.edges
    }


def test_command_handler_removed_by_test_filter_becomes_unresolved() -> None:
    program = SemanticProgram()
    program.add_node(
        SemanticNodeFact(
            "call:src/controller.ts:10:commandBus.execute",
            "CALL_SITE",
            "commandBus.execute",
            "src/controller.ts",
            10,
            10,
        )
    )
    program.add_node(SemanticNodeFact("command:DoThingCommand", "COMMAND", "DoThingCommand"))
    program.add_node(
        SemanticNodeFact(
            "framework-method:tests/do-thing.handler.spec.ts:FakeHandler.execute",
            "METHOD",
            "execute",
            "tests/do-thing.handler.spec.ts",
            5,
            8,
            "FakeHandler.execute",
        )
    )
    program.add_edge(
        SemanticEdgeFact(
            "PUBLISHES_COMMAND",
            "call:src/controller.ts:10:commandBus.execute",
            "command:DoThingCommand",
        )
    )
    program.add_edge(
        SemanticEdgeFact(
            "HANDLES_COMMAND",
            "command:DoThingCommand",
            "framework-method:tests/do-thing.handler.spec.ts:FakeHandler.execute",
        )
    )

    exclude_test_sources_from_semantic_program(program)

    unresolved = [
        node
        for node in program.nodes
        if node.node_type == "UNRESOLVED_DYNAMIC_TARGET"
        and node.label == "COMMAND:DoThingCommand"
        and (node.attributes or {}).get("postFilterFinalizer") is True
    ]
    assert len(unresolved) == 1
    assert (
        "HANDLES_COMMAND",
        "command:DoThingCommand",
        unresolved[0].key,
    ) in _edges(program)
    assert unresolved[0].key in program.unresolved_frontiers


def test_di_provider_removed_by_test_filter_becomes_unresolved() -> None:
    program = SemanticProgram()
    owner = "symbol:src/service.ts:Service"
    token = "di-token:REPOSITORY_PORT"
    test_provider = "symbol:tests/repository.spec.ts:FakeRepository"
    program.add_node(
        SemanticNodeFact(owner, "CLASS", "Service", "src/service.ts", 1, 20, "Service")
    )
    program.add_node(
        SemanticNodeFact(
            token,
            "TYPE",
            "REPOSITORY_PORT",
            attributes={"frameworkBoundary": "DI", "bindingKey": "REPOSITORY_PORT"},
        )
    )
    program.add_node(
        SemanticNodeFact(
            test_provider,
            "CLASS",
            "FakeRepository",
            "tests/repository.spec.ts",
            1,
            10,
            "FakeRepository",
        )
    )
    program.add_edge(SemanticEdgeFact("DEPENDS_ON", owner, token))
    program.add_edge(SemanticEdgeFact("RESOLVES_TO", token, test_provider))

    exclude_test_sources_from_semantic_program(program)

    unresolved = [
        node
        for node in program.nodes
        if node.node_type == "UNRESOLVED_DYNAMIC_TARGET"
        and node.label == "DI:REPOSITORY_PORT"
        and (node.attributes or {}).get("postFilterFinalizer") is True
    ]
    assert len(unresolved) == 1
    assert ("RESOLVES_TO", token, unresolved[0].key) in _edges(program)
    assert unresolved[0].key in program.unresolved_frontiers


def test_filtered_unresolved_node_does_not_leave_stale_frontier_id() -> None:
    program = SemanticProgram()
    frontier = "framework-unresolved:DI:test-only"
    program.add_node(
        SemanticNodeFact(
            frontier,
            "UNRESOLVED_DYNAMIC_TARGET",
            "DI:test-only",
            "tests/provider.spec.ts",
            4,
            4,
            coverage_state="LIMITED",
        )
    )
    program.unresolved_frontiers.append(frontier)

    exclude_test_sources_from_semantic_program(program)

    assert frontier not in program.unresolved_frontiers
    assert all(node.key != frontier for node in program.nodes)
