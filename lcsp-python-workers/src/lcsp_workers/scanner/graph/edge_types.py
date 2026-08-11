from dataclasses import dataclass, field

EDGE_TYPES = [
    "CONTAINS",         
    "CALLS",            
    "IMPORTS",          
    "PASSES_TO",        
    "FLOWS_TO",         
    "CONTROLS",         
    "REVIEWS",          
    "CORROBORATES",     
    "HAS_LIMITATION",   
]

@dataclass
class GraphEdge:
    edge_id: str
    edge_type: str
    source_node_id: str
    target_node_id: str
    confidence: float
    attributes: dict
    provenance: dict = field(default_factory=dict)
    coverage_state: str = "SUFFICIENT"
    evidence_refs: list[str] = field(default_factory=list)
