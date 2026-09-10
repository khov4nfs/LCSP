"""Bounded tools exposed only to the Legal Rule Triage subagent.

`assessment_id` is intentionally not accepted by these legal reasoning tools. An
Assessment readiness gate may emit an automatic ENGINEERING_RULE_NOT_READY request,
but customer identity must not cross the Legal Rule Triage tool boundary or influence
legal reasoning. Root Orchestration owns every cross-agent workflow transition.
"""

from __future__ import annotations

from typing import Any, Literal

from langchain.tools import tool
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .service import LegalRuleTriageService


class GetLegalRuleTriageWorkItemsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    affected_rule_ids: list[str] = Field(default_factory=list, max_length=500)
    include_completed: bool = False
    idempotency_key: str | None = Field(default=None, max_length=240)
    trigger: str = Field(default="LEGAL_MAINTENANCE", min_length=1, max_length=120)
    triage_execution_id: str | None = Field(default=None, max_length=240)


class LegalChunkAnalysisInput(BaseModel):
    """Canonical chunk verdict accepted by the deterministic EngineeringRule gate."""

    model_config = ConfigDict(extra="forbid")

    chunkId: str = Field(min_length=1, max_length=500)
    verdict: Literal[
        "ENGINEERING_RULE_CANDIDATE",
        "CONTEXT_ONLY",
        "REJECT",
    ]
    reason: str = Field(min_length=1, max_length=4000)
    engineeringObligation: str = Field(default="", max_length=8000)
    verificationTargets: list[str] = Field(default_factory=list, max_length=200)


class EngineeringGraphQueryInput(BaseModel):
    """One bounded graph query proposed by Triage for later investigation."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=240)
    startNodeTypes: list[str] = Field(default_factory=list, max_length=100)
    direction: Literal["FORWARD", "BACKWARD", "BOTH"] = "FORWARD"
    followEdges: list[str] = Field(default_factory=list, max_length=100)
    stopNodeTypes: list[str] = Field(default_factory=list, max_length=100)
    semanticTypes: list[str] = Field(default_factory=list, max_length=100)


class EngineeringRuleProposalInput(BaseModel):
    """Model-facing proposal shape consumed by the existing deterministic validator."""

    model_config = ConfigDict(extra="forbid")

    engineeringRuleId: str | None = Field(default=None, max_length=240)
    concept: str = Field(
        min_length=1,
        max_length=240,
        description="Stable technical/operational concept represented by this rule.",
    )
    legalIntent: dict[str, Any] = Field(
        default_factory=dict,
        description="Bounded legal intent preserved from the candidate obligation.",
    )
    investigationGoals: list[str] = Field(
        min_length=1,
        max_length=100,
        description="Concrete implementation and runtime facts the Investigator should establish.",
    )
    startingNodeTypes: list[str] = Field(default_factory=list, max_length=100)
    targetNodeTypes: list[str] = Field(default_factory=list, max_length=100)
    edgeStrategies: list[str] = Field(default_factory=list, max_length=100)
    graphQueries: list[EngineeringGraphQueryInput] = Field(
        default_factory=list, max_length=100
    )
    keywords: list[str] = Field(default_factory=list, max_length=200)
    commonApis: list[str] = Field(default_factory=list, max_length=200)
    commonLibraries: list[str] = Field(default_factory=list, max_length=200)
    patterns: list[str] = Field(default_factory=list, max_length=200)
    requiredEvidence: list[str] = Field(
        min_length=1,
        max_length=200,
        description="Observable evidence required to evaluate this EngineeringRule.",
    )
    supportingEvidence: list[str] = Field(default_factory=list, max_length=200)
    negativeEvidence: list[str] = Field(default_factory=list, max_length=200)
    unresolvedConditions: list[str] = Field(default_factory=list, max_length=200)


class PersistLegalRuleTriageResultInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    triage_execution_id: str = Field(min_length=1, max_length=240)
    legal_rule_id: str = Field(min_length=1, max_length=240)
    legal_rule_catalog_version_id: str = Field(min_length=1, max_length=240)
    legal_corpus_version_id: str = Field(min_length=1, max_length=240)
    # Keep the model-facing tool schema aligned with the downstream deterministic
    # parser. Without the enum constraint the LLM can emit semantically similar
    # strings that are guaranteed to fail persistence and poison-retry the singleton.
    chunk_analyses: list[LegalChunkAnalysisInput] = Field(
        min_length=1, max_length=500
    )
    engineering_rules: list[EngineeringRuleProposalInput] = Field(
        default_factory=list,
        max_length=500,
        description=(
            "MUST contain at least one EngineeringRule proposal when any chunk verdict "
            "is ENGINEERING_RULE_CANDIDATE; MUST be empty when no chunk is a candidate."
        ),
    )
    workflow_run_id: str = Field(min_length=1, max_length=240)
    correlation_id: str | None = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def validate_candidate_rule_handoff(self) -> "PersistLegalRuleTriageResultInput":
        has_candidate = any(
            row.verdict == "ENGINEERING_RULE_CANDIDATE"
            for row in self.chunk_analyses
        )
        if has_candidate and not self.engineering_rules:
            raise ValueError(
                "candidate chunk analyses require at least one EngineeringRule proposal"
            )
        if not has_candidate and self.engineering_rules:
            raise ValueError(
                "EngineeringRule proposals require at least one candidate chunk analysis"
            )
        return self


class FinishLegalRuleTriageExecutionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    triage_execution_id: str = Field(min_length=1, max_length=240)


@tool(args_schema=GetLegalRuleTriageWorkItemsInput)
def get_legal_rule_triage_work_items(
    affected_rule_ids: list[str] | None = None,
    include_completed: bool = False,
    idempotency_key: str | None = None,
    trigger: str = "LEGAL_MAINTENANCE",
    triage_execution_id: str | None = None,
) -> dict[str, Any]:
    """Claim singleton triage work or return ALREADY_RUNNING without creating a queue."""
    return LegalRuleTriageService().get_work_items(
        affected_rule_ids=list(affected_rule_ids or []),
        include_completed=include_completed,
        idempotency_key=idempotency_key,
        trigger=trigger,
        triage_execution_id=triage_execution_id,
    )


@tool(args_schema=PersistLegalRuleTriageResultInput)
def persist_legal_rule_triage_result(
    triage_execution_id: str,
    legal_rule_id: str,
    legal_rule_catalog_version_id: str,
    legal_corpus_version_id: str,
    chunk_analyses: list[LegalChunkAnalysisInput],
    engineering_rules: list[EngineeringRuleProposalInput],
    workflow_run_id: str,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """Persist decisions only for the current singleton triage execution owner."""
    return LegalRuleTriageService().persist_result(
        triage_execution_id=triage_execution_id,
        legal_rule_id=legal_rule_id,
        legal_rule_catalog_version_id=legal_rule_catalog_version_id,
        legal_corpus_version_id=legal_corpus_version_id,
        # LangChain validates args_schema and hands nested models through as model
        # instances, while the deterministic gate downstream reads plain mappings.
        chunk_analyses=[row.model_dump() for row in chunk_analyses],
        engineering_rules=[
            row.model_dump(exclude_none=True, exclude_defaults=True)
            for row in engineering_rules
        ],
        workflow_run_id=workflow_run_id,
        correlation_id=correlation_id,
    )


@tool(args_schema=FinishLegalRuleTriageExecutionInput)
def finish_legal_rule_triage_execution(
    triage_execution_id: str,
) -> dict[str, Any]:
    """Finish the Triage-owned batch and release its singleton lease only.

    Root Orchestration observes the specialist return and owns any subsequent workflow
    transition, including reconciliation of Assessments waiting on EngineeringRules.
    """
    return LegalRuleTriageService().finish_or_drain(
        triage_execution_id=triage_execution_id,
    )
