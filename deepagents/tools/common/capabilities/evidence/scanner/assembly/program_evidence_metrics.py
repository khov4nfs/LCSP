"""Canonical Program Evidence overview metrics derived from the final graph."""

from __future__ import annotations

from typing import Any, Iterable


SYMBOL_NODE_TYPES = frozenset(
    {
        "CLASS",
        "FUNCTION",
        "METHOD",
        "HTTP_ROUTE",
        "GRPC_METHOD",
        "GRAPHQL_OPERATION",
        "COMMAND",
        "QUERY",
    }
)
EXCLUDED_COVERAGE_NODE_TYPES = frozenset(
    {"REPOSITORY", "COVERAGE_GAP", "UNRESOLVED_DYNAMIC_TARGET"}
)


def aggregate_program_evidence_metrics(
    nodes: Iterable[dict[str, Any]],
) -> dict[str, int | None]:
    """Calculate all four metrics from canonical, already-deduplicated nodes."""
    canonical_nodes = list(nodes)
    eligible = [
        node
        for node in canonical_nodes
        if str(node.get("node_type") or "") not in EXCLUDED_COVERAGE_NODE_TYPES
    ]
    mapped = sum(
        bool(node.get("evidence_refs") or node.get("support_refs"))
        for node in eligible
    )
    evidence_scope = None if not eligible else (mapped * 100 + len(eligible) // 2) // len(eligible)
    return {
        "modules_analyzed": sum(
            str(node.get("node_type") or "") == "MODULE" for node in canonical_nodes
        ),
        "code_symbols_indexed": sum(
            str(node.get("node_type") or "") in SYMBOL_NODE_TYPES
            for node in canonical_nodes
        ),
        "ai_model_invocations": sum(
            str(node.get("node_type") or "") == "AI_MODEL_INVOCATION"
            for node in canonical_nodes
        ),
        "evidence_mapped_scope": evidence_scope,
    }
