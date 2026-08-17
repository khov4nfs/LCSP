from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


# Mirrors packages/contracts/src/scan/callback.ts at the Python boundary.
SCAN_CALLBACK_STATUSES = {
    "success": "SUCCESS",
    "partial": "PARTIAL",
    "failed": "FAILED",
}


class CallbackResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    success: Optional[bool] = None
    accepted: Optional[bool] = None
    evidence_report_id: Optional[str] = None
    technical_profile_id: Optional[str] = None
    verified_profile_id: Optional[str] = Field(default=None, alias="verifiedProfileId")
    ai_usage_flow_id: Optional[str] = None
    legal_rule_match_id: Optional[str] = None
    classification_result_id: Optional[str] = None
    conflict_count: Optional[int] = None
    guardrail_status: Optional[str] = None
    status: Optional[str] = None
    correlationId: Optional[str] = Field(default=None, alias="correlationId")
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

    def __init__(self, **data: Any) -> None:
        # Handle API envelope shape { ok: True, data: { ... } } or legacy callback wrapper
        # If result is nested or present inside data
        result = data.get("result")
        if isinstance(result, dict):
            # Extract fields from result and overlay them to top level
            for k, v in result.items():
                if k not in data or data[k] is None:
                    data[k] = v
            # Specifically map verifiedProfileId if present in result
            if "verifiedProfileId" in result and not data.get("verified_profile_id"):
                data["verified_profile_id"] = result["verifiedProfileId"]
        super().__init__(**data)


class ScanCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    scan_job_id: Optional[str] = None
    tools_version: Dict[str, str] = Field(default_factory=dict)
    config_hash: Dict[str, str] = Field(default_factory=dict)
    evidence_payload: Dict[str, Any] = Field(default_factory=dict)
    privacy_flags: Dict[str, Any] = Field(default_factory=dict)
    schema_version: str = "1.0.0"
    error_code: Optional[str] = None
    findings: List[Dict[str, Any]] = Field(default_factory=list)
    is_artifact_reference: Optional[bool] = None
    artifact_manifest: Optional[Dict[str, Any]] = None


class TechnicalProfileCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence_report_id: str
    assessment_id: str
    schema_version: str
    provider_version: str
    profile_data: Optional[Dict[str, Any]] = None
    privacy_flags: Dict[str, Any]
    scan_job_id: Optional[str] = None
    is_artifact_reference: Optional[bool] = None
    artifact_manifest: Optional[Dict[str, Any]] = None


class AIUsageFlowCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    technical_profile_id: str
    assessment_id: str
    schema_version: str
    provider_version: str
    claims: List[Dict[str, Any]]
    unknown_usages: List[Dict[str, Any]]
    privacy_flags: Dict[str, Any]
    flow_data: Dict[str, Any] = Field(default_factory=dict)


class ConflictDetectionCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ai_usage_flow_id: str
    assessment_id: str
    schema_version: str
    provider_version: str
    conflicts: List[Dict[str, Any]] = Field(default_factory=list)
    privacy_flags: Dict[str, Any]


class VerifiedProfileCallbackPayload(BaseModel):
    """Pinned inputs for the canonical Nest reconciliation command.

    Python no longer builds a competing VerifiedProfile payload. Nest validates
    these source identities, conflict decision refs and idempotency key before
    persisting the single immutable profile representation.
    """

    model_config = ConfigDict(extra="forbid")
    ai_usage_flow_id: str
    assessment_id: str
    wizard_profile_id: str
    technical_evidence_report_id: str
    reconciliation_decision_refs: List[str]
    idempotency_key: str
    organization_id: str


class LegalRuleMatchCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verified_profile_id: str
    assessment_id: str
    corpus_version_id: str
    legal_rule_catalog_version_id: str
    schema_version: str = "1.0.0"
    matches: List[Dict[str, Any]]
    citation_allowlist: List[str] = Field(default_factory=list)
    overall_coverage_status: str = "NO_CITATION"


class ClassificationCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    legal_rule_match_id: str
    verified_profile_id: str
    assessment_id: str
    schema_version: str
    classification_data: Dict[str, Any]
    guardrail_status: str


class AuditExportCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    export_url: Optional[str] = None
    error_message: Optional[str] = None
