"""Version-pinned dossier contracts over immutable LCSP artifacts."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class DossierSourceArtifacts:
    """Immutable artifact identifiers that make a dossier reproducible."""

    repository_snapshot_id: str
    program_evidence_graph_id: str
    technical_evidence_report_id: str
    wizard_profile_id: str
    verified_profile_id: str
    legal_corpus_version_id: str
    legal_rule_catalog_version_id: str
    classification_result_id: str
    gap_matrix_ref: str


@dataclass(frozen=True)
class Dossier:
    """Derived dossier view; source artifacts remain the system of record."""

    dossier_id: str
    dossier_type: str
    assessment_id: str
    organization_id: str
    version: int
    status: str
    source_artifacts: DossierSourceArtifacts
    sections: dict[str, Any]
    evidence_appendix: tuple[dict[str, Any], ...] = ()
    missing_requirements: tuple[str, ...] = ()
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
