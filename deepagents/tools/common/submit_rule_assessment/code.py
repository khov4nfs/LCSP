"""Governed result boundary for the Repository Analyst: one assessment per EngineeringRule."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import BaseModel, ConfigDict, Field

from orchestration.context import LCSPRunContext, coerce_run_context
from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
    EvidenceClaimValidationError,
)
from tools.common.capabilities.assessment.rule_assessment.evidence_refs import (
    cite_verified_source,
)
from tools.common.capabilities.assessment.rule_assessment.validation import (
    RuleAssessmentValidationError,
    validate_rule_assessment,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config
from tools.common.capabilities.platform.subject_repository_tools import (
    SUBJECT_REPOSITORY_ROOT,
)
from tools.common.runtime_envelope import RuntimeInjectedInput

_CAMEL = ConfigDict(extra="forbid", populate_by_name=True)


class BusinessContextNeedSubmission(BaseModel):
    model_config = _CAMEL

    question: str = Field(min_length=1, max_length=1000)
    observation: str = Field(min_length=1, max_length=1000)
    authored_condition_index: int | None = Field(default=None, alias="authoredConditionIndex", ge=0)
    resolution_criterion_ids: list[str] = Field(default_factory=list, alias="resolutionCriterionIds")


class CriterionSubmission(BaseModel):
    model_config = _CAMEL

    criterion_id: str = Field(alias="criterionId", min_length=1)
    status: str
    evidence_kind: str | None = Field(default=None, alias="evidenceKind")
    evidence_refs: list[str] = Field(default_factory=list, alias="evidenceRefs", max_length=10)
    technical_facts: list[str] = Field(default_factory=list, alias="technicalFacts", max_length=10)
    limitations: list[str] = Field(default_factory=list, max_length=8)
    business_context_need: BusinessContextNeedSubmission | None = Field(
        default=None, alias="businessContextNeed"
    )


class SubmitRuleAssessmentRequest(RuntimeInjectedInput):
    """The one assessment for the assigned rule; last successful submit wins."""

    model_config = _CAMEL

    engineering_rule_id: str = Field(alias="engineeringRuleId")
    engineering_rule_version: str = Field(alias="engineeringRuleVersion")
    repository_version: str = Field(alias="repositoryVersion")
    criteria: list[CriterionSubmission] = Field(default_factory=list)


def _runtime_context(runtime: ToolRuntime | None) -> LCSPRunContext | None:
    return coerce_run_context(getattr(runtime, "context", None))


@tool(args_schema=SubmitRuleAssessmentRequest, parse_docstring=True)
def submit_rule_assessment(
    runtime: ToolRuntime = None,
    **request: Any,
) -> dict[str, Any]:
    """Submit the assessment of the assigned rule's criteria. Call when analysis is done.

    Each criterion is EVIDENCE_FOUND (evidenceRefs from cite_repository_source or
    get_code_snippet, plus evidenceKind SUPPORTS_REQUIREMENT or DEMONSTRATES_VIOLATION),
    BUSINESS_CONTEXT_REQUIRED (a customer-safe question), TECHNICAL_UNRESOLVED or
    NOT_OBSERVED (with limitation codes). NOT_OBSERVED only means this investigation did not
    establish the fact; it never concludes the rule. Errors list what to correct; resubmit.

    Args:
        request: Rule identity, repository version and one entry per criterion.
    """
    context = _runtime_context(runtime)
    if context is None or not context.assessment_id:
        return {"ok": False, "errors": ["trusted runtime context is unavailable"]}
    submission = SubmitRuleAssessmentRequest.model_validate(request).model_dump(by_alias=True)
    try:
        accepted = validate_rule_assessment(
            submission,
            context,
            context.repository_path or SUBJECT_REPOSITORY_ROOT,
            execution={"runId": context.workflow_run_id},
        )
    except RuleAssessmentValidationError as error:
        return {"ok": False, "errors": error.problems}
    payload = accepted.to_payload()
    config = load_config()
    try:
        WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key).put_rule_assessment(
            context.assessment_id, payload["engineeringRuleId"], payload
        )
    except Exception as error:  # noqa: BLE001 - never leak transport detail to the model
        return {
            "ok": False,
            "errors": [f"assessment could not be persisted ({type(error).__name__}); resubmit"],
        }
    return {"ok": True, "assessment": payload}


class CiteRepositorySourceRequest(RuntimeInjectedInput):
    """Verify a repository line range and return an evidenceRef to cite in submit_rule_assessment."""

    model_config = _CAMEL

    path: str = Field(min_length=1, max_length=1024)
    start_line: int = Field(alias="startLine", ge=1)
    end_line: int = Field(alias="endLine", ge=1)
    symbol: str | None = Field(default=None, max_length=300)


@tool(args_schema=CiteRepositorySourceRequest, parse_docstring=True)
def cite_repository_source(
    runtime: ToolRuntime = None,
    **request: Any,
) -> dict[str, Any]:
    """Verify a repository line range and return an evidenceRef to cite in submit_rule_assessment.

    Args:
        request: Repository-relative path and inclusive line range.
    """
    context = _runtime_context(runtime)
    value = CiteRepositorySourceRequest.model_validate(request)
    try:
        citation = cite_verified_source(
            context,
            value.path,
            value.start_line,
            value.end_line,
            (context.repository_path if context else None) or SUBJECT_REPOSITORY_ROOT,
        )
    except EvidenceClaimValidationError as error:
        return {"ok": False, "error": str(error)}
    return {"ok": True, **citation}
