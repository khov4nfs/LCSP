"""Bounded tools exposed only to the Legal Rule Triage subagent.

`assessment_id` is intentionally not accepted by these legal reasoning tools. An
Assessment readiness gate may emit an automatic ENGINEERING_RULE_NOT_READY request,
but customer identity must not cross the Legal Rule Triage tool boundary or influence
legal reasoning. Root Orchestration owns every cross-agent workflow transition.
"""

from __future__ import annotations

from typing import Any

from langchain.tools import tool
from pydantic import BaseModel, ConfigDict, Field

from .service import LegalRuleTriageService


class GetLegalRuleTriageWorkItemsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    affected_rule_ids: list[str] = Field(default_factory=list, max_length=500)
    include_completed: bool = False
    idempotency_key: str | None = Field(default=None, max_length=240)
    trigger: str = Field(default="LEGAL_MAINTENANCE", min_length=1, max_length=120)
    triage_execution_id: str | None = Field(default=None, max_length=240)


class PersistLegalRuleTriageResultInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    triage_execution_id: str = Field(min_length=1, max_length=240)
    legal_rule_id: str = Field(min_length=1, max_length=240)
    legal_rule_catalog_version_id: str = Field(min_length=1, max_length=240)
    legal_corpus_version_id: str = Field(min_length=1, max_length=240)
    chunk_analyses: list[dict[str, Any]] = Field(min_length=1, max_length=500)
    engineering_rules: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    workflow_run_id: str = Field(min_length=1, max_length=240)
    correlation_id: str | None = Field(default=None, max_length=160)


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
    chunk_analyses: list[dict[str, Any]],
    engineering_rules: list[dict[str, Any]],
    workflow_run_id: str,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """Persist decisions only for the current singleton triage execution owner."""
    return LegalRuleTriageService().persist_result(
        triage_execution_id=triage_execution_id,
        legal_rule_id=legal_rule_id,
        legal_rule_catalog_version_id=legal_rule_catalog_version_id,
        legal_corpus_version_id=legal_corpus_version_id,
        chunk_analyses=chunk_analyses,
        engineering_rules=engineering_rules,
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
