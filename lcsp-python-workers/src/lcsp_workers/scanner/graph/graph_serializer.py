from dataclasses import dataclass, asdict, field
from typing import List, Dict, Any


@dataclass
class ScanGraph:
    """Serializable, sanitized evidence graph emitted by one repository scan."""

    graph_id: str
    schema_version: str
    node_count: int
    edge_count: int
    nodes: List[Dict]
    edges: List[Dict]
    ai_provider_nodes: List[str]
    ai_invocation_nodes: List[str]
    coverage_gap_nodes: List[str]
    unsupported_flow_nodes: List[str]
    provenance: Dict[str, str] = field(default_factory=dict)
    coverage_state: str = "SUFFICIENT"
    evidence_refs: List[str] = field(default_factory=list)
    graph_hash: str = ""


def serialize_graph(graph: ScanGraph) -> dict:
    """Convert a scan graph dataclass into the callback persistence shape."""
    return asdict(graph)
