"""Language-neutral semantic facts emitted before graph assembly."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Iterable

@dataclass(frozen=True)
class SemanticNodeFact:
    key: str
    node_type: str
    label: str
    file_path: str | None = None
    start_line: int | None = None
    end_line: int | None = None
    symbol_ref: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)
    semantic_types: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    coverage_state: str = "SUFFICIENT"

@dataclass(frozen=True)
class SemanticEdgeFact:
    edge_type: str
    source_key: str
    target_key: str
    confidence: float = 1.0
    attributes: dict[str, Any] = field(default_factory=dict)
    evidence_refs: tuple[str, ...] = ()
    coverage_state: str = "SUFFICIENT"

@dataclass
class SemanticProgram:
    nodes: list[SemanticNodeFact] = field(default_factory=list)
    edges: list[SemanticEdgeFact] = field(default_factory=list)
    coverage_notes: list[str] = field(default_factory=list)
    unresolved_frontiers: list[str] = field(default_factory=list)

    def add_node(self, value: SemanticNodeFact) -> None: self.nodes.append(value)
    def add_edge(self, value: SemanticEdgeFact) -> None: self.edges.append(value)
    def add_nodes(self, values: Iterable[SemanticNodeFact]) -> None: self.nodes.extend(values)
    def add_edges(self, values: Iterable[SemanticEdgeFact]) -> None: self.edges.extend(values)
    def extend(self, other: "SemanticProgram") -> None:
        self.nodes.extend(other.nodes); self.edges.extend(other.edges)
        self.coverage_notes.extend(other.coverage_notes)
        self.unresolved_frontiers.extend(other.unresolved_frontiers)
