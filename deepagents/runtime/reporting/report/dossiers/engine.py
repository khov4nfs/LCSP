"""Generic dossier engine; dossier types are views over immutable verified artifacts."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .models import Dossier, DossierSourceArtifacts


AI_RISK_CLASSIFICATION = "AI_RISK_CLASSIFICATION"
DOSSIER_SCHEMA_VERSION = "1.0.0"


class DossierEngine:
    """Build deterministic dossier views without creating new evidence claims."""

    REQUIRED = (
        "systemIdentity",
        "intendedUse",
        "technicalAiProfile",
        "dataProcessing",
        "affectedSubjects",
        "decisionImpact",
        "humanOversight",
        "externalProviders",
        "riskIndicators",
        "riskClassification",
        "classificationRationale",
        "applicableProvisions",
        "conflicts",
        "unresolvedEvidence",
        "gaps",
        "remediation",
    )

    def build_classification_dossier(
        self,
        *,
        assessment_id: str,
        organization_id: str,
        version: int,
        source_artifacts: DossierSourceArtifacts,
        context: dict[str, Any],
        evidence_appendix: list[dict[str, Any]],
    ) -> Dossier:
        """Build the first-class AI risk-classification dossier.

        Missing required sections are explicit. The engine does not infer or fill
        absent legal/business facts and therefore cannot hide incomplete upstream
        lifecycle stages.
        """
        if version < 1:
            raise ValueError("dossier version must be positive")
        self._assert_source_artifacts(source_artifacts)

        sections = {key: context.get(key) for key in self.REQUIRED}
        missing = tuple(
            key
            for key, value in sections.items()
            if value in (None, "", [], {})
        )
        source_payload = source_artifacts.__dict__
        seed = json.dumps(
            {
                "assessment": assessment_id,
                "organization": organization_id,
                "version": version,
                "type": AI_RISK_CLASSIFICATION,
                "sources": source_payload,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        dossier_id = "dossier:" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
        provenance_hash = hashlib.sha256(
            json.dumps(
                {
                    "sources": source_payload,
                    "sections": sections,
                    "evidence_appendix": evidence_appendix,
                },
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            ).encode("utf-8")
        ).hexdigest()

        return Dossier(
            dossier_id=dossier_id,
            dossier_type=AI_RISK_CLASSIFICATION,
            assessment_id=assessment_id,
            organization_id=organization_id,
            version=version,
            status="INCOMPLETE" if missing else "COMPLETE",
            source_artifacts=source_artifacts,
            sections=sections,
            evidence_appendix=tuple(evidence_appendix),
            missing_requirements=missing,
            provenance={
                "dossierSchemaVersion": DOSSIER_SCHEMA_VERSION,
                "contentHash": f"sha256:{provenance_hash}",
            },
        )

    @staticmethod
    def _assert_source_artifacts(source_artifacts: DossierSourceArtifacts) -> None:
        missing = [
            key
            for key, value in source_artifacts.__dict__.items()
            if not str(value).strip()
        ]
        if missing:
            raise ValueError(
                "dossier source artifacts are incomplete: " + ",".join(sorted(missing))
            )
