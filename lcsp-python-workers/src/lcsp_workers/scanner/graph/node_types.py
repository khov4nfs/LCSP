from dataclasses import dataclass, field
from typing import Dict, List, Optional

NODE_TYPES = [
    "REPOSITORY",           
    "FILE",                 
    "MODULE",               
    "FUNCTION",             
    "METHOD",               
    "CLASS",                
    "CONTROLLER",           
    "ROUTE",                
    "AI_PROVIDER",          
    "AI_MODEL_INVOCATION",  
    "AI_INPUT",             
    "AI_OUTPUT",            
    "DECISION_RULE",        
    "HUMAN_REVIEW_STEP",    
    "PACKAGE_DEPENDENCY",   
    "UNSUPPORTED_FLOW",     
    "COVERAGE_GAP",         
]

@dataclass
class GraphNode:
    node_id: str
    node_type: str
    label: str
    file_path: Optional[str]
    line_number: Optional[int]
    attributes: Dict
    finding_ids: List[str] = field(default_factory=list)
    provenance: Dict = field(default_factory=dict)
    coverage_state: str = "SUFFICIENT"
    evidence_refs: List[str] = field(default_factory=list)
