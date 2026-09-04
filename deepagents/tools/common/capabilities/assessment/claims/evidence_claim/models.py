"""Evidence-backed outputs from EngineeringRule-guided Program Evidence Graph investigation."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


ENGINEERING_EVIDENCE_CLAIM_TYPES = {
    "requirement_met": "RULE_REQUIREMENT_MET",
    "requirement_not_met": "RULE_REQUIREMENT_NOT_MET",
    "unresolved": "UNRESOLVED_ENGINEERING_FACT",
}

# Keep these values in parity with @lcsp/contracts/scan ENGINEERING_LIMITATION_CODES.
# Limitation arrays are machine-readable codes only; narrative explanation belongs
# in controlled evaluation reason/notes fields rather than model-authored free text.
ENGINEERING_LIMITATION_CODES = {
    "no_legal_corpus_source": "NO_LEGAL_CORPUS_SOURCE",
    "no_legal_rule_catalog": "NO_LEGAL_RULE_CATALOG",
    "no_engineering_rule_source_rules": "NO_ENGINEERING_RULE_SOURCE_RULES",
    "no_engineering_rule_candidates": "NO_ENGINEERING_RULE_CANDIDATES",
    "engineering_rule_compilation_failed": "ENGINEERING_RULE_COMPILATION_FAILED",
    "engineering_investigation_failed": "ENGINEERING_INVESTIGATION_FAILED",
    "investigation_returned_no_valid_claims": "INVESTIGATION_RETURNED_NO_VALID_CLAIMS",
    "model_limitation_code_invalid": "MODEL_LIMITATION_CODE_INVALID",
    "engineering_evidence_insufficient": "ENGINEERING_EVIDENCE_INSUFFICIENT",
    "conflicting_engineering_evidence": "CONFLICTING_ENGINEERING_EVIDENCE",
    "dynamic_path_unresolved": "DYNAMIC_PATH_UNRESOLVED",
    "external_boundary_unresolved": "EXTERNAL_BOUNDARY_UNRESOLVED",
    "graph_coverage_limited": "GRAPH_COVERAGE_LIMITED",
    "search_coverage_incomplete": "SEARCH_COVERAGE_INCOMPLETE",
}

MODEL_SELECTABLE_LIMITATION_CODES = (
    ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],
    ENGINEERING_LIMITATION_CODES["dynamic_path_unresolved"],
    ENGINEERING_LIMITATION_CODES["external_boundary_unresolved"],
    ENGINEERING_LIMITATION_CODES["graph_coverage_limited"],
    ENGINEERING_LIMITATION_CODES["search_coverage_incomplete"],
)


@dataclass(frozen=True)
class EvidenceClaim:
    claim_id: str
    engineering_rule_id: str
    claim_type: str
    value: bool | None
    evidence_refs: tuple[str, ...]
    graph_path_refs: tuple[str, ...] = ()
    source_anchor_refs: tuple[str, ...] = ()
    confidence: float = 0.0
    limitations: tuple[str, ...] = ()
    criterion: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class InvestigationPacket:
    engineering_rule_id: str
    concept: str
    investigation_goals: tuple[str, ...]
    initial_results: tuple[dict[str, Any], ...]
    starting_node_types: tuple[str, ...] = ()
    target_node_types: tuple[str, ...] = ()
    edge_strategies: tuple[str, ...] = ()
    graph_queries: tuple[dict[str, Any], ...] = ()
    keywords: tuple[str, ...] = ()
    common_apis: tuple[str, ...] = ()
    common_libraries: tuple[str, ...] = ()
    patterns: tuple[str, ...] = ()
    unresolved_frontiers: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    customer_context: dict[str, Any] = field(default_factory=dict)
    confirmed_customer_context: dict[str, Any] = field(default_factory=dict)
    required_evidence: tuple[str, ...] = ()
    supporting_evidence: tuple[str, ...] = ()
    negative_evidence: tuple[str, ...] = ()
    unresolved_conditions: tuple[str, ...] = ()
