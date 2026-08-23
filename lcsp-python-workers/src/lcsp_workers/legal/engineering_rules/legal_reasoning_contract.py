"""Mandatory legal boundary for LegalRule -> EngineeringRule reasoning."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


LEGAL_REASONING_CONTRACT_SCHEMA_VERSION = "1.0.0"
LEGAL_REASONING_PLANNER_AUTHORITY = "INVESTIGATION_SCOPE_ONLY"
DEFAULT_LEGAL_JURISDICTION = "VN"
UNKNOWN_EFFECTIVE_DATE = "UNSPECIFIED"
REQUIRED_VALIDATION_POLICIES = {
    "noCitationNoLegalClaim": True,
    "noSourceAnchorNoRepoClaim": True,
    "failClosedOnMissingEvidence": True,
    "separateApplicabilityFromCompliance": True,
    "deterministicValidatorsBeforeLlmTrust": True,
    "humanLegalSignoffRequired": True,
    "plannerAuthority": LEGAL_REASONING_PLANNER_AUTHORITY,
}


class LegalReasoningContractValidationError(ValueError):
    pass


@dataclass(frozen=True)
class LegalReasoningContract:
    """The only legal authority allowed downstream of approved LegalRule compile.

    LLM components may plan or investigate technical evidence only inside this
    contract. They may not infer legal applicability, compliance, or risk tier from
    raw legal text outside this citation/version/policy boundary.
    """

    legal_rule_id: str
    applicability_criteria: dict[str, Any]
    required_evidence: tuple[str, ...]
    accepted_evidence_types: tuple[str, ...]
    negative_evidence_types: tuple[str, ...]
    citation_set: tuple[dict[str, Any], ...]
    jurisdiction: str
    effective_date: str
    legal_corpus_version_id: str
    legal_rule_catalog_version_id: str
    validation_policy: dict[str, Any]
    schema_version: str = LEGAL_REASONING_CONTRACT_SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_prompt_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "legalRuleId": self.legal_rule_id,
            "applicabilityCriteria": self.applicability_criteria,
            "requiredEvidence": list(self.required_evidence),
            "acceptedEvidenceTypes": list(self.accepted_evidence_types),
            "negativeEvidenceTypes": list(self.negative_evidence_types),
            "citationSet": list(self.citation_set),
            "jurisdiction": self.jurisdiction,
            "effectiveDate": self.effective_date,
            "legalCorpusVersionId": self.legal_corpus_version_id,
            "legalRuleCatalogVersionId": self.legal_rule_catalog_version_id,
            "validationPolicy": self.validation_policy,
        }


def build_legal_reasoning_contract(
    *,
    legal_rule: dict[str, Any],
    legal_rule_catalog_version_id: str,
    legal_corpus_version_id: str,
    legal_context: list[dict[str, Any]],
    required_evidence: tuple[str, ...],
    supporting_evidence: tuple[str, ...],
    negative_evidence: tuple[str, ...],
) -> LegalReasoningContract:
    """Derive the bounded legal reasoning contract before any LLM planner sees it."""

    legal_rule_id = str(
        legal_rule.get("legalRuleId")
        or legal_rule.get("legal_rule_id")
        or legal_rule.get("id")
        or ""
    )
    citation_set = tuple(
        {
            "chunkId": str(item.get("id") or ""),
            "documentId": str(item.get("documentId") or item.get("document_id") or ""),
            "locator": str(item.get("locator") or ""),
            "legalStatus": str(item.get("legalStatus") or item.get("legal_status") or ""),
            "contentSha256": str(
                item.get("contentSha256") or item.get("content_sha256") or ""
            ),
            "role": str(item.get("role") or ""),
        }
        for item in legal_context
        if item.get("id")
    )
    return validate_legal_reasoning_contract(
        LegalReasoningContract(
            legal_rule_id=legal_rule_id,
            applicability_criteria={
                "requiredFacts": legal_rule.get("requiredFacts")
                or legal_rule.get("required_facts")
                or [],
                "blockingFacts": legal_rule.get("blockingFacts")
                or legal_rule.get("blocking_facts")
                or [],
                "unknownFactPolicy": str(
                    legal_rule.get("unknownFactPolicy")
                    or legal_rule.get("unknown_fact_policy")
                    or "BLOCK_ON_UNKNOWN"
                ),
            },
            required_evidence=required_evidence,
            accepted_evidence_types=tuple(
                dict.fromkeys((*required_evidence, *supporting_evidence))
            ),
            negative_evidence_types=negative_evidence,
            citation_set=citation_set,
            jurisdiction=str(
                legal_rule.get("jurisdiction")
                or legal_rule.get("jurisdictionCode")
                or legal_rule.get("jurisdiction_code")
                or DEFAULT_LEGAL_JURISDICTION
            ),
            effective_date=str(
                legal_rule.get("effectiveDate")
                or legal_rule.get("effective_date")
                or UNKNOWN_EFFECTIVE_DATE
            ),
            legal_corpus_version_id=legal_corpus_version_id,
            legal_rule_catalog_version_id=legal_rule_catalog_version_id,
            validation_policy=dict(REQUIRED_VALIDATION_POLICIES),
        )
    )


def legal_reasoning_contract_from_dict(
    value: Any,
) -> LegalReasoningContract | None:
    if isinstance(value, LegalReasoningContract):
        return value
    if not isinstance(value, dict):
        return None

    def tup(snake: str, camel: str | None = None) -> tuple[str, ...]:
        return tuple(
            str(item)
            for item in (value.get(snake) or value.get(camel or snake) or [])
            if str(item)
        )

    raw_citations = value.get("citation_set") or value.get("citationSet") or []
    citation_set = tuple(
        dict(item) for item in raw_citations if isinstance(item, dict)
    )
    return LegalReasoningContract(
        legal_rule_id=str(value.get("legal_rule_id") or value.get("legalRuleId") or ""),
        applicability_criteria=dict(
            value.get("applicability_criteria")
            or value.get("applicabilityCriteria")
            or {}
        ),
        required_evidence=tup("required_evidence", "requiredEvidence"),
        accepted_evidence_types=tup(
            "accepted_evidence_types", "acceptedEvidenceTypes"
        ),
        negative_evidence_types=tup(
            "negative_evidence_types", "negativeEvidenceTypes"
        ),
        citation_set=citation_set,
        jurisdiction=str(value.get("jurisdiction") or ""),
        effective_date=str(value.get("effective_date") or value.get("effectiveDate") or ""),
        legal_corpus_version_id=str(
            value.get("legal_corpus_version_id")
            or value.get("legalCorpusVersionId")
            or ""
        ),
        legal_rule_catalog_version_id=str(
            value.get("legal_rule_catalog_version_id")
            or value.get("legalRuleCatalogVersionId")
            or ""
        ),
        validation_policy=dict(
            value.get("validation_policy") or value.get("validationPolicy") or {}
        ),
        schema_version=str(
            value.get("schema_version")
            or value.get("schemaVersion")
            or LEGAL_REASONING_CONTRACT_SCHEMA_VERSION
        ),
    )


def validate_legal_reasoning_contract(
    contract: LegalReasoningContract,
) -> LegalReasoningContract:
    if contract.schema_version != LEGAL_REASONING_CONTRACT_SCHEMA_VERSION:
        raise LegalReasoningContractValidationError(
            "unsupported legal reasoning contract schema"
        )
    if not contract.legal_rule_id:
        raise LegalReasoningContractValidationError("legal rule id required")
    if not contract.legal_corpus_version_id or not contract.legal_rule_catalog_version_id:
        raise LegalReasoningContractValidationError("versioned legal provenance required")
    if not contract.jurisdiction:
        raise LegalReasoningContractValidationError("jurisdiction required")
    if not contract.effective_date:
        raise LegalReasoningContractValidationError("effective date required")
    if not contract.required_evidence:
        raise LegalReasoningContractValidationError("required evidence required")
    if not contract.accepted_evidence_types:
        raise LegalReasoningContractValidationError("accepted evidence types required")
    validate_citation_set(contract.citation_set)
    validate_validation_policy(contract.validation_policy)
    return contract


def validate_citation_set(citation_set: tuple[dict[str, Any], ...]) -> None:
    if not citation_set:
        raise LegalReasoningContractValidationError("citation set required")
    seen: set[str] = set()
    for citation in citation_set:
        chunk_id = str(citation.get("chunkId") or citation.get("chunk_id") or "")
        locator = str(citation.get("locator") or "")
        content_hash = str(
            citation.get("contentSha256") or citation.get("content_sha256") or ""
        )
        legal_status = str(citation.get("legalStatus") or citation.get("legal_status") or "")
        if not chunk_id or not locator or not content_hash:
            raise LegalReasoningContractValidationError("citation identity incomplete")
        if legal_status == "REPEALED":
            raise LegalReasoningContractValidationError("citation references repealed law")
        if chunk_id in seen:
            raise LegalReasoningContractValidationError("duplicate citation chunk")
        seen.add(chunk_id)


def validate_validation_policy(policy: dict[str, Any]) -> None:
    for key, expected in REQUIRED_VALIDATION_POLICIES.items():
        if policy.get(key) != expected:
            raise LegalReasoningContractValidationError(
                f"legal reasoning contract policy mismatch: {key}"
            )
