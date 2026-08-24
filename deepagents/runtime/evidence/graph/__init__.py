"""Program Evidence Graph runtime grouped by owned capability."""
from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from typing import Final

_SCHEMA_MODULES: Final[frozenset[str]] = frozenset(
    {"models", "semantic_ir", "source_roles", "vocabulary"}
)
_CONSTRUCTION_MODULES: Final[frozenset[str]] = frozenset(
    {
        "assembler",
        "builder",
        "extractor",
        "semantic_integrity",
        "source_evidence",
        "validator",
    }
)
_LINEAGE_MODULES: Final[frozenset[str]] = frozenset(
    {
        "ai_invocation_gate",
        "ai_lifecycle",
        "contract_flow",
        "contract_lineage",
        "data_lineage",
        "database_lineage",
        "decision_influence",
        "sensitive_data",
        "sensitive_lineage_gate",
    }
)
_RESOLUTION_MODULES: Final[frozenset[str]] = frozenset(
    {
        "api_boundary_resolution",
        "framework_boundary_finalizer",
        "framework_links",
        "framework_metadata",
        "framework_resolution",
        "generic_dispatch_resolution",
        "javascript_architecture_resolution",
        "managed_architecture_resolution",
        "protocol_resolution",
        "python_agent_boundary_resolution",
        "python_architecture_resolution",
        "python_framework_adapters",
        "redux_extended_resolution",
    }
)
_QUERY_MODULES: Final[frozenset[str]] = frozenset({"query_engine"})
_CAPABILITY_MODULES: Final[dict[str, frozenset[str]]] = {
    "schema": _SCHEMA_MODULES,
    "construction": _CONSTRUCTION_MODULES,
    "lineage": _LINEAGE_MODULES,
    "resolution": _RESOLUTION_MODULES,
    "query": _QUERY_MODULES,
}
_PREFIX = f"{__name__}."


def _owner(module: str) -> str | None:
    for capability, modules in _CAPABILITY_MODULES.items():
        if module in modules:
            return capability
    return None


def _canonical_graph_name(fullname: str) -> str | None:
    if not fullname.startswith(_PREFIX):
        return None
    suffix = fullname[len(_PREFIX) :]
    parts = suffix.split(".")

    # Historical flat import: runtime.evidence.graph.models -> schema.models.
    if len(parts) >= 1 and parts[0] not in _CAPABILITY_MODULES:
        owner = _owner(parts[0])
        if owner is None:
            return None
        target = f"{_PREFIX}{owner}.{parts[0]}"
        tail = ".".join(parts[1:])
        return f"{target}.{tail}" if tail else target

    # A moved implementation may still use a sibling relative import. Route that
    # dependency to its physical owner instead of creating shim files.
    if len(parts) >= 2 and parts[0] in _CAPABILITY_MODULES:
        owner = _owner(parts[1])
        if owner is not None and owner != parts[0]:
            target = f"{_PREFIX}{owner}.{parts[1]}"
            tail = ".".join(parts[2:])
            return f"{target}.{tail}" if tail else target
    return None


class _GraphCapabilityAliasFinder(importlib.abc.MetaPathFinder):
    """Resolve flat and cross-capability migration imports into graph owners."""

    def find_spec(self, fullname: str, path=None, target=None):  # type: ignore[override]
        canonical = _canonical_graph_name(fullname)
        if canonical is None or canonical == fullname:
            return None
        canonical_spec = importlib.util.find_spec(canonical)
        if canonical_spec is None or canonical_spec.origin is None:
            return None
        locations = canonical_spec.submodule_search_locations
        return importlib.util.spec_from_file_location(
            fullname,
            canonical_spec.origin,
            submodule_search_locations=list(locations) if locations is not None else None,
        )


def _install_graph_aliases() -> None:
    if not any(isinstance(finder, _GraphCapabilityAliasFinder) for finder in sys.meta_path):
        sys.meta_path.insert(0, _GraphCapabilityAliasFinder())


_install_graph_aliases()

from .construction.assembler import ProgramGraphAssembler
from .construction.builder import ProgramGraphBuilder
from .construction.extractor import RepositorySemanticExtractor
from .construction.source_evidence import SourceEvidenceReader
from .construction.validator import ProgramGraphValidationError, validate_program_graph
from .query.query_engine import GraphQueryResult, ProgramGraphQueryEngine
from .resolution.framework_links import FrameworkBoundaryExtractor
from .schema.models import (
    ProgramEdge,
    ProgramEvidenceGraph,
    ProgramNode,
    SourceEvidenceAnchor,
    SourceLocation,
)
from .schema.vocabulary import EDGE_TYPES, NODE_TYPES, PROGRAM_GRAPH_SCHEMA_VERSION

__all__ = [
    "ProgramGraphAssembler",
    "ProgramGraphBuilder",
    "RepositorySemanticExtractor",
    "FrameworkBoundaryExtractor",
    "ProgramEvidenceGraph",
    "ProgramEdge",
    "ProgramNode",
    "SourceEvidenceAnchor",
    "SourceLocation",
    "GraphQueryResult",
    "ProgramGraphQueryEngine",
    "SourceEvidenceReader",
    "ProgramGraphValidationError",
    "validate_program_graph",
    "EDGE_TYPES",
    "NODE_TYPES",
    "PROGRAM_GRAPH_SCHEMA_VERSION",
]
