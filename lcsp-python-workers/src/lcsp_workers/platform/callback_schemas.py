from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


# Mirrors packages/contracts/src/scan/callback.ts at the Python boundary.
SCAN_CALLBACK_STATUSES = {
    "success": "SUCCESS",
    "partial": "PARTIAL",
    "failed": "FAILED",
}


class CallbackResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    success: Optional[bool] = None
    accepted: Optional[bool] = None
    evidence_report_id: Optional[str] = None
    technical_profile_id: Optional[str] = None
    verified_profile_id: Optional[str] = None
    ai_usage_flow_id: Optional[str] = None
    legal_rule_match_id: Optional[str] = None
    classification_result_id: Optional[str] = None
    conflict_count: Optional[int] = None
    guardrail_status: Optional[str] = None
    status: Optional[str] = None
    correlation_id: Optional[str] = None
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


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


class TechnicalProfileCallbackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence_report_id: str
    assessment_id: str
    schema_version: str
    provider_version: str
    profile_data: Dict[str, Any]
    privacy_flags: Dict[str, Any]
    scan_job_id: Optional[str] = None


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
    model_config = ConfigDict(extra="forbid")
    ai_usage_flow_id: str
    assessment_id: str
    schema_version: str
    provider_version: str
    profile_data: Dict[str, Any]
    gates_passed_at: Dict[str, Any]


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
