from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional

@dataclass
class PrivacyFlags:
    contains_source_code: bool
    secrets_redacted: bool

@dataclass
class TechnicalFinding:
    finding_id: str
    finding_type: str
    file_path: str
    line_number: Optional[int]
    matched_rule_id: str
    confidence: float
    # We will allow arbitrary extra fields by using a dictionary if needed, 
    # but this covers the core fields. We can add kwargs support.
    
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

@dataclass
class EvidencePayload:
    job_id: str
    snapshot_id: str
    schema_version: str
    tools_version: Dict[str, str]
    config_hash: str
    findings: List[Any] # Can be TechnicalFinding or dict
    privacy_flags: PrivacyFlags
    quality_state: str
    coverage_limitations: List[str]
    scan_graph: Dict[str, Any]
    scanned_at: str
    
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
