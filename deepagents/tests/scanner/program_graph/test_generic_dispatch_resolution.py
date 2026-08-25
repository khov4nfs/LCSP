from __future__ import annotations

from tools.common.capabilities.evidence.graph.resolution.dispatch.generic_dispatch_resolution import (
    GenericDispatchResolver,
)
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticProgram


def _edges(program: SemanticProgram) -> set[tuple[str, str, str]]:
    return {(edge.edge_type, edge.source_key, edge.target_key) for edge in program.edges}


def test_go_custom_registry_literal_dispatch_resolves_handler(tmp_path) -> None:
    (tmp_path / "registry.go").write_text(
        '''
package app

func Approve(payload string) string { return payload }

func Configure() {
    registry.Register("approve", Approve)
}

func Run() {
    registry.Dispatch("approve", "payload")
}
''',
        encoding="utf-8",
    )

    program = GenericDispatchResolver(tmp_path).enrich(SemanticProgram())
    edges = _edges(program)
    binding = "generic-dispatch:registry:approve"

    assert ("RESOLVES_TO", binding, "symbol:registry.go:Approve") in edges
    assert any(edge[0] == "RESOLVES_TO" and edge[2] == binding for edge in edges)


def test_dynamic_dispatch_on_registered_namespace_is_explicitly_unresolved(tmp_path) -> None:
    (tmp_path / "registry.rs").write_text(
        '''
fn approve() {}

fn setup() {
    registry.register("approve", approve);
}

fn run(kind: String) {
    registry.dispatch(kind);
}
''',
        encoding="utf-8",
    )

    program = GenericDispatchResolver(tmp_path).enrich(SemanticProgram())

    assert any(
        node.node_type == "UNRESOLVED_DYNAMIC_TARGET"
        and node.attributes.get("frameworkBoundary") == "GENERIC_DISPATCH"
        and "dynamic" in node.label
        for node in program.nodes
    )


def test_generic_dispatch_resolver_ignores_test_sources(tmp_path) -> None:
    tests = tmp_path / "tests"
    tests.mkdir()
    (tests / "registry.go").write_text(
        '''
package tests
func Fake() {}
func Configure() { registry.Register("fake", Fake) }
func Run() { registry.Dispatch("fake") }
''',
        encoding="utf-8",
    )

    program = GenericDispatchResolver(tmp_path).enrich(SemanticProgram())
    assert program.nodes == []
    assert program.edges == []
