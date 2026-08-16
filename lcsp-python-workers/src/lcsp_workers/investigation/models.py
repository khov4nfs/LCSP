"""Evidence-backed outputs from law-guided Program Evidence Graph investigation."""
from __future__ import annotations
from dataclasses import asdict, dataclass, field
from typing import Any

@dataclass(frozen=True)
class EvidenceClaim:
    claim_id: str; engineering_rule_id: str; claim_type: str; value: Any; evidence_refs: tuple[str, ...]
    graph_path_refs: tuple[str, ...] = (); source_anchor_refs: tuple[str, ...] = (); confidence: float = 0.0; limitations: tuple[str, ...] = ()
    def to_dict(self) -> dict[str, Any]: return asdict(self)

@dataclass(frozen=True)
class InvestigationPacket:
    engineering_rule_id: str; concept: str; investigation_goals: tuple[str, ...]; initial_results: tuple[dict[str, Any], ...]
    unresolved_frontiers: tuple[str, ...] = (); evidence_refs: tuple[str, ...] = (); wizard_context: dict[str, Any] = field(default_factory=dict)
