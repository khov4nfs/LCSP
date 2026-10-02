"""Production vertical: interview-gated engineering assessment against live services.

Migrated from the deleted pipeline architecture
(``ManagedTargetedInvestigatorPipeline``, ``ManagedInvestigatorExecutionStore``,
``EngineeringRulePlanner``) to the per-``EngineeringRule`` runtime:

- one rule dispatches one Repository Analyst task (``analyze_rule``); the
  fake analyst below persists ledger rows through the live
  ``put_rule_assessment`` API instead of driving a durable investigator graph,
- resume-registry assertions now read the per-rule ledger
  (``list_rule_assessments``): a failed resume never erases a prior accepted
  result and one failed rule never invalidates completed siblings,
- planner assertions now use the deterministic applicability gate
  (``evaluate_applicability``): the seeded legal rule authors no facts, so the
  gate reports ``NOT_GATED`` and the rule is eligible for analysis,
- the stale-provenance replay now fails closed with
  ``InterviewRevalidationRequired`` (the deleted Root recovery branch is
  gone).

No absence semantics: ``FINAL_ABSENCE`` stays disabled and ``NOT_OBSERVED``
never yields ``NON_COMPLIANT``. The deleted ``planner``/``planner_decisions``
classification keys are gone with the planner; the ported assertions read the
deterministic ``evaluations`` instead.
"""

from __future__ import annotations

import hashlib
import json
import os
from types import SimpleNamespace
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row

from orchestration.dispatcher import RootSubagentDispatcher
from tools.common.capabilities.assessment.planning.engineering_rule.rule_applicability_gate import (
    APPLICABILITY_STATUSES,
    evaluate_applicability,
    legal_rule_id_index,
)
from tools.common.capabilities.assessment.rule_assessment.values import (
    RULE_ANALYSIS_STATUSES,
    RULE_CRITERION_STATUSES,
    RULE_EVIDENCE_KINDS,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.callback_schemas import ScanCallbackPayload
from tools.common.capabilities.workflow.recovery.interview_boundary import (
    AssessmentInterviewResumeBoundary,
    InterviewRevalidationRequired,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    InterviewGatedEngineeringAssessmentBoundary,
)
from tools.legal.corpus.engineering_rules.contract.models import (
    EngineeringRule,
    GraphQueryTemplate,
    build_legal_reasoning_contract,
)
from tools.legal.corpus.engineering_rules.registry.cache import EngineeringRuleCache
from tools.legal.corpus.engineering_rules.orchestration.service import (
    EngineeringRuleService,
)
from tools.legal.retrieval.legal_basis.chromadb_citation_retriever import (
    ChromaDbCitationRetriever,
)


API_BASE_URL = os.getenv("LCSP_API_BASE_URL")
API_DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("LCSP_API_DATABASE_URL")
CHECKPOINT_URL = os.getenv("LCSP_TEST_CHECKPOINT_DATABASE_URL") or os.getenv(
    "LANGGRAPH_CHECKPOINT_DATABASE_URL"
)
WORKER_KEY = os.getenv("WORKER_API_KEY")


def _is_server_reachable(url: str | None) -> bool:
    if not url:
        return False
    try:
        import socket
        from urllib.parse import urlparse

        parsed = urlparse(url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _is_server_reachable(API_BASE_URL)
    or not API_DATABASE_URL
    or not CHECKPOINT_URL
    or not WORKER_KEY,
    reason="production vertical requires real Nest API, API Postgres and checkpoint Postgres",
)

ASSESSMENT_ID = "assessment-lcsp-278-release"
BLOCKED_ASSESSMENT_ID = "assessment-lcsp-278-blocked"
SCAN_JOB_ID = "scan-lcsp-278-release"
BLOCKED_SCAN_JOB_ID = "scan-lcsp-278-blocked"
SNAPSHOT_ID = "snapshot-lcsp-278-release"
BLOCKED_SNAPSHOT_ID = "snapshot-lcsp-278-blocked"
CORPUS_ID = "corpus-lcsp-278-release"
CATALOG_ID = "catalog-lcsp-278-release"
LEGAL_RULE_ID = "LEGAL-LCSP-278-RELEASE"
# Precompiled ids embed their legal rule so the deterministic applicability
# gate (``legal_rule_id_index``) routes them to the parent LegalRule.
ENGINEERING_RULE_ID = f"{LEGAL_RULE_ID}::PRECOMPILED::lcsp-278-release"
EVIDENCE_REF = "EV-LCSP-278-RELEASE"
ANALYST_QUESTION = "Who approves the AI recommendation before action?"
ANALYST_OBSERVATION = "Approval owner is unclear from the repository."


# Initial CONTEXT_READY must resolve the minimum planning context in one confirmed answer.
INITIAL_SYSTEM_PURPOSE = (
    "AI-assisted recommendation: the AI model drafts recommendations in the customer "
    "onboarding workflow; a human reviewer approves every action before any status "
    "update; affected subjects are customers; data sources are customer profile "
    "records and repository code."
)


def _confirmed_context(
    assessment_id: str,
    topic: str,
    statement: str,
    *,
    revision: int,
    resolves_criterion_id: str | None = None,
) -> dict[str, Any]:
    return {
        "assessmentId": assessment_id,
        "contextRevision": revision,
        "authority": "CUSTOMER_CONFIRMED_CONFIRMED_ONLY",
        "statements": [
            {
                "statementId": f"stmt-{topic}",
                "topic": topic,
                "statement": statement,
                "normalizedValue": statement,
                "scope": {"topic": topic},
                "evidenceRefs": [EVIDENCE_REF],
                "respondentRef": "actor:authenticated-production",
                "createdAt": "2026-09-05T00:00:00Z",
                "source": "CUSTOMER_CONFIRMED",
                "resolutionState": "CONFIRMED",
                **(
                    {"resolvesCriterionId": resolves_criterion_id}
                    if resolves_criterion_id
                    else {}
                ),
            }
        ],
        "limitations": ["customer-confirmed current statements only"],
        "sourceVersionRef": SNAPSHOT_ID,
        "pgeVersion": "production-pge:v1",
        "guidanceVersion": "guidance-production-1",
    }


class _ScriptedSpecialistFactory:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = list(responses)
        self.invoke_count = 0

    def __call__(self, **_kwargs: Any) -> Any:
        factory = self

        class _Agent:
            def invoke(self, _payload: dict[str, Any], *, config=None, context=None):
                _ = config, context
                if not factory.responses:
                    raise AssertionError("unexpected extra Interview specialist invocation")
                factory.invoke_count += 1
                return {"structured_response": factory.responses.pop(0)}

        return _Agent()


class _LedgerAnalystAgent:
    """Fake repository-analyst: persists per-rule ledger rows via the live API.

    ``mode`` is ``"needs_then_completed"`` (first dispatch pauses on the
    customer-owned criterion, later dispatches conclude) or
    ``"always_needs"`` (the blocked vertical never resolves).
    """

    def __init__(self, api: WorkerApiClient, mode: str) -> None:
        self._api = api
        self._mode = mode
        self.calls = 0
        self.instructions: list[str] = []

    def invoke(self, payload: dict[str, Any], *, config=None, context=None):
        _ = config
        messages = payload.get("messages") if isinstance(payload, dict) else []
        instruction = ""
        if messages:
            last = messages[-1]
            content = last.get("content") if isinstance(last, dict) else getattr(last, "content", None)
            if isinstance(content, str):
                instruction = content
            elif isinstance(content, list):
                instruction = "".join(
                    block.get("text", "") if isinstance(block, dict) else str(block)
                    for block in content
                )
        self.calls += 1
        self.instructions.append(instruction)
        assert context is not None and len(context.engineering_rule_ids) == 1
        if self._mode == "needs_then_completed" and self.calls > 1:
            row = _completed_ledger_row(context)
        else:
            row = _needs_context_ledger_row(context)
        self._api.put_rule_assessment(
            context.assessment_id, context.engineering_rule_ids[0], row
        )
        return {"messages": []}


class _BranchingSpecialistFactory:
    """Serve Interview turns from the script and analyst tasks from the ledger fake."""

    def __init__(self, interview_factory: _ScriptedSpecialistFactory, analyst: _LedgerAnalystAgent) -> None:
        self._interview_factory = interview_factory
        self._analyst = analyst

    @property
    def invoke_count(self) -> int:
        return self._interview_factory.invoke_count

    def __call__(self, **kwargs: Any) -> Any:
        name = str(kwargs.get("name") or "")
        if "interview" in name:
            return self._interview_factory(**kwargs)
        if "repository-analyst" in name:
            analyst = self._analyst

            class _Agent:
                def invoke(self, payload: dict[str, Any], *, config=None, context=None):
                    return analyst.invoke(payload, config=config, context=context)

            return _Agent()
        raise AssertionError(f"unexpected specialist dispatch: {name!r}")


def _needs_context_ledger_row(context: Any) -> dict[str, Any]:
    rule_id = context.engineering_rule_ids[0]
    digest = hashlib.sha256(ANALYST_QUESTION.encode("utf-8")).hexdigest()[:12]
    return {
        "resultId": f"rar_prod_needs_{_call_id(context)}",
        "assessmentId": context.assessment_id,
        "engineeringRuleId": rule_id,
        "engineeringRuleVersion": context.engineering_rule_version,
        "repositoryVersion": context.commit_sha,
        "contextRevision": context.context_revision,
        "status": RULE_ANALYSIS_STATUSES["needsContext"],
        "criteria": [
            {
                "criterionId": criterion_id,
                "status": RULE_CRITERION_STATUSES["businessContextRequired"],
                "evidenceRefs": [],
                "evidence": [],
                "technicalFacts": [],
                "limitations": [],
                "businessContextNeed": {
                    "needId": f"need:{rule_id}:{criterion_id}:{digest}",
                    "question": ANALYST_QUESTION,
                    "observation": ANALYST_OBSERVATION,
                    "resolutionCriterionIds": [criterion_id],
                },
            }
            for criterion_id in context.criterion_ids
        ],
        "limitations": [],
        "execution": {"attempt": 1, "runId": context.workflow_run_id},
    }


def _completed_ledger_row(context: Any) -> dict[str, Any]:
    rule_id = context.engineering_rule_ids[0]
    criteria = []
    for criterion_id in context.criterion_ids:
        evidence_ref = f"source:{context.commit_sha}:src/recommendation_service.py#L12-L24"
        criteria.append(
            {
                "criterionId": criterion_id,
                "status": RULE_CRITERION_STATUSES["evidenceFound"],
                "evidenceKind": RULE_EVIDENCE_KINDS["supportsRequirement"],
                "evidenceRefs": [evidence_ref],
                "evidence": [
                    {
                        "ref": evidence_ref,
                        "path": "src/recommendation_service.py",
                        "startLine": 12,
                        "endLine": 24,
                        "provenance": {
                            "assessmentId": context.assessment_id,
                            "repositoryVersion": context.commit_sha,
                            "engineeringRuleId": rule_id,
                            "criterionId": criterion_id,
                            "validator": "lcsp.rule_assessment.v1",
                        },
                    }
                ],
                "technicalFacts": ["A human manager approves before action."],
                "limitations": [],
            }
        )
    return {
        "resultId": f"rar_prod_completed_{_call_id(context)}",
        "assessmentId": context.assessment_id,
        "engineeringRuleId": rule_id,
        "engineeringRuleVersion": context.engineering_rule_version,
        "repositoryVersion": context.commit_sha,
        "contextRevision": context.context_revision,
        "status": RULE_ANALYSIS_STATUSES["completed"],
        "criteria": criteria,
        "limitations": [],
        "execution": {"attempt": 1, "runId": context.workflow_run_id},
    }


def _call_id(context: Any) -> str:
    return hashlib.sha256(str(context.workflow_run_id).encode("utf-8")).hexdigest()[:12]


def _ledger_rows(api: WorkerApiClient, assessment_id: str) -> list[dict[str, Any]]:
    return api.list_rule_assessments(assessment_id)


def test_release_gate_crosses_real_api_outbox_checkpoint_and_callback(
    tmp_path,
) -> None:
    """Root cause: the old test drove deleted durable-investigator internals.

    Fix: the same live release gate now runs the per-rule loop. The fake
    analyst persists NEEDS_CONTEXT then COMPLETED ledger rows through the
    live rule-assessment API; resume-registry assertions read
    ``list_rule_assessments`` and planner assertions use the deterministic
    applicability gate. Stale provenance fails closed with
    ``InterviewRevalidationRequired`` (the Root recovery branch is gone).
    """
    assert API_BASE_URL and API_DATABASE_URL and CHECKPOINT_URL and WORKER_KEY
    os.environ["LEGAL_CHROMA_PATH"] = str(tmp_path / "chroma")

    api = WorkerApiClient(API_BASE_URL, WORKER_KEY)
    report_id = _post_scan_callback(api)
    accepted_event = _outbox_payload(
        "event.technical-evidence.accepted.v1",
        aggregate_id=report_id,
    )
    assert accepted_event["assessmentId"] == ASSESSMENT_ID
    assert accepted_event["evidenceReportId"] == report_id
    assert "source_code" not in json.dumps(accepted_event)

    _seed_engineering_rule_cache(api, report_id)
    config = SimpleNamespace(
        nestjs_api_base_url=API_BASE_URL,
        worker_api_key=WORKER_KEY,
        langgraph_checkpoint_database_url=CHECKPOINT_URL,
    )
    interview_factory = _ScriptedSpecialistFactory(
        [
            {
                "expectedContextRevision": 0,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "question-lcsp-278-initial",
                    "intent": "ASK",
                    "control": "FREE_TEXT",
                    "prompt": "What is the business purpose of this AI-supported flow?",
                    "frontier": {
                        "owner": "CUSTOMER",
                        "materiality": "MATERIAL",
                        "description": "AI-supported flow business purpose",
                        "evidenceRefs": [EVIDENCE_REF],
                    },
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 1,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "CONTEXT_READY",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    ASSESSMENT_ID,
                    "system_purpose",
                    INITIAL_SYSTEM_PURPOSE,
                    revision=1,
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 1,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "CONTEXT_READY",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    ASSESSMENT_ID,
                    "system_purpose",
                    INITIAL_SYSTEM_PURPOSE,
                    revision=1,
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 2,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "CONTEXT_READY",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    ASSESSMENT_ID,
                    "system_purpose",
                    INITIAL_SYSTEM_PURPOSE,
                    revision=2,
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 2,
                "mode": "BUSINESS_CONTEXT_RESOLUTION",
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "question-lcsp-278-targeted",
                    "intent": "CLARIFY",
                    "control": "FREE_TEXT",
                    "prompt": "Who must approve the recommendation before action?",
                    "frontier": {
                        "owner": "CUSTOMER",
                        "materiality": "MATERIAL",
                        "description": "Who must approve the recommendation before action?",
                        "evidenceRefs": [EVIDENCE_REF],
                    },
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 3,
                "mode": "BUSINESS_CONTEXT_RESOLUTION",
                "outcome": "CONTEXT_RESOLVED",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    ASSESSMENT_ID,
                    "decision_authority",
                    "A human manager must approve before action",
                    revision=3,
                    resolves_criterion_id="CONTROL",
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 3,
                "mode": "BUSINESS_CONTEXT_RESOLUTION",
                "outcome": "CONTEXT_RESOLVED",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    ASSESSMENT_ID,
                    "decision_authority",
                    "A human manager must approve before action",
                    revision=3,
                    resolves_criterion_id="CONTROL",
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 4,
                "mode": "BUSINESS_CONTEXT_RESOLUTION",
                "outcome": "CONTEXT_RESOLVED",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    ASSESSMENT_ID,
                    "decision_authority",
                    "A human manager must approve before action",
                    revision=4,
                    resolves_criterion_id="CONTROL",
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
        ]
    )
    analyst = _LedgerAnalystAgent(api, "needs_then_completed")
    factory = _BranchingSpecialistFactory(interview_factory, analyst)
    dispatcher = RootSubagentDispatcher(agent_factory=factory)

    boundary = InterviewGatedEngineeringAssessmentBoundary(
        config,
        api_client=api,
        interview_dispatcher=dispatcher,
    )
    boundary.handle(accepted_event, "corr-lcsp-278-accepted")

    public_initial = _public_interview_state()
    assert public_initial["activeQuestion"]["id"] == "question-lcsp-278-initial"
    assert _classification_count() == 0
    # No rule analysis runs before the initial Interview guard resolves.
    assert analyst.calls == 0

    _submit_answer(
        "question-lcsp-278-initial",
        free_text="The system provides recommendations only.",
    )
    initial_resume = _latest_resume_payload()
    initial_resume_boundary = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
    )
    initial_resume_boundary.handle(initial_resume, "corr-lcsp-278-initial-answer")
    assert _public_interview_state()["activeQuestion"]["control"] == "CONFIRM_ADJUST"

    _submit_answer(
        _public_interview_state()["activeQuestion"]["id"],
        confirmed=True,
    )
    initial_resume_boundary.handle(
        _latest_resume_payload(),
        "corr-lcsp-278-initial-confirmed",
    )

    ready_state = _thread_state()
    assert ready_state["state"]["outcome"] == "WAITING_FOR_CUSTOMER"
    assert ready_state["private"]["targetedNeed"]["needId"].startswith(
        f"need:{ENGINEERING_RULE_ID}:CONTROL:"
    )
    assert ready_state["private"]["targetedNeed"]["question"] == ANALYST_QUESTION
    # The ledger replaces the investigator execution registry: one
    # NEEDS_CONTEXT row pauses the rule on the customer-owned criterion.
    rows = _ledger_rows(api, ASSESSMENT_ID)
    assert len(rows) == 1
    assert rows[0]["engineeringRuleId"] == ENGINEERING_RULE_ID
    assert rows[0]["status"] == RULE_ANALYSIS_STATUSES["needsContext"]
    assert analyst.calls == 1
    assert _classification_count() == 0

    targeted_resume = _latest_resume_payload()
    targeted_resume_boundary = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
    )
    targeted_resume_boundary.handle(
        targeted_resume,
        "corr-lcsp-278-targeted-question",
    )
    assert _public_interview_state()["activeQuestion"]["prompt"] == (
        "Who must approve the recommendation before action?"
    )
    targeted_resume_boundary.handle(
        targeted_resume,
        "corr-lcsp-278-targeted-question-replay",
    )
    assert interview_factory.invoke_count == 5

    _submit_answer(
        "question-lcsp-278-targeted",
        free_text="A human manager must approve before action.",
    )
    targeted_resume_boundary.handle(
        _latest_resume_payload(),
        "corr-lcsp-278-targeted-confirm",
    )
    targeted_confirmation = _public_interview_state()["activeQuestion"]
    assert targeted_confirmation["control"] == "CONFIRM_ADJUST"
    assert (
        targeted_confirmation["proposedInterpretation"]
        == "A human manager must approve before action"
    )

    _submit_answer(targeted_confirmation["id"], confirmed=True)
    resolved_resume = _latest_resume_payload()
    targeted_resume_boundary.handle(
        resolved_resume,
        "corr-lcsp-278-targeted-resolved",
    )

    # The resumed rule re-analyzes with the confirmed answer: the Interview
    # owns customer-context reasoning, so its stamped statements travel
    # verbatim into the analyst task and no stated/uncertain text leaks in.
    assert analyst.calls == 2
    assert len(analyst.instructions) == 2
    resumed_instruction = analyst.instructions[-1]
    assert "ConfirmedStructuredBusinessContext(" not in resumed_instruction
    assert '"authority": "CUSTOMER_CONFIRMED_CONFIRMED_ONLY"' in resumed_instruction
    assert '"contextRevision": 4' in resumed_instruction
    assert '"topic": "decision_authority"' in resumed_instruction
    assert '"source": "CUSTOMER_CONFIRMED"' in resumed_instruction
    assert '"resolutionState": "CONFIRMED"' in resumed_instruction
    assert "CUSTOMER_STATED" not in resumed_instruction
    assert "UNCERTAIN" not in resumed_instruction
    assert "CONFLICTED" not in resumed_instruction
    assert "SUPERSEDED" not in resumed_instruction
    rows = _ledger_rows(api, ASSESSMENT_ID)
    assert any(
        row["engineeringRuleId"] == ENGINEERING_RULE_ID
        and row["status"] == RULE_ANALYSIS_STATUSES["completed"]
        for row in rows
    )
    assert not any(
        row["status"] == RULE_ANALYSIS_STATUSES["failed"] for row in rows
    )
    result = _classification_result()
    data = result["classificationData"]
    assert result["assessmentId"] == ASSESSMENT_ID
    assert data["technical_evidence_report_id"] == report_id
    assert data["snapshot_id"] == SNAPSHOT_ID
    assert data["summary"]["total"] == 1
    assert data["summary"]["compliant"] == 1
    assert data["evaluations"][0]["engineering_rule_id"] == ENGINEERING_RULE_ID
    assert data["evaluations"][0]["status"] == "COMPLIANT"

    targeted_resume_boundary.handle(
        resolved_resume,
        "corr-lcsp-278-targeted-resolved-replay",
    )
    assert analyst.calls == 2
    assert _classification_count() == 1

    _mutate_snapshot_provenance()
    stale_resume = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
    )
    # Stale provenance fails closed: no Interview turn, no rule resume.
    with pytest.raises(InterviewRevalidationRequired):
        stale_resume.handle(initial_resume, "corr-lcsp-278-stale-replay")
    assert interview_factory.invoke_count == 8
    assert analyst.calls == 2


def test_release_gate_blocks_unresolved_targeted_context_without_resume(
    tmp_path,
) -> None:
    """Root cause: the old test asserted deleted registry/planner internals.

    Fix: the blocked vertical keeps its Interview gating (BLOCKED_OR_UNRESOLVED
    with bounded actions) while the paused rule stays a NEEDS_CONTEXT ledger
    row; nothing concludes and nothing is classified.
    """
    assert API_BASE_URL and API_DATABASE_URL and CHECKPOINT_URL and WORKER_KEY
    os.environ["LEGAL_CHROMA_PATH"] = str(tmp_path / "blocked-chroma")

    api = WorkerApiClient(API_BASE_URL, WORKER_KEY)
    report_id = _post_scan_callback(
        api,
        scan_job_id=BLOCKED_SCAN_JOB_ID,
        snapshot_id=BLOCKED_SNAPSHOT_ID,
    )
    accepted_event = _outbox_payload(
        "event.technical-evidence.accepted.v1",
        aggregate_id=report_id,
    )
    assert accepted_event["assessmentId"] == BLOCKED_ASSESSMENT_ID

    _seed_engineering_rule_cache(api, report_id)
    config = SimpleNamespace(
        nestjs_api_base_url=API_BASE_URL,
        worker_api_key=WORKER_KEY,
        langgraph_checkpoint_database_url=CHECKPOINT_URL,
    )
    interview_factory = _ScriptedSpecialistFactory(
        [
            {
                "expectedContextRevision": 0,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "question-lcsp-278-blocked-initial",
                    "intent": "ASK",
                    "control": "FREE_TEXT",
                    "prompt": "What is the business purpose of this AI-supported flow?",
                    "frontier": {
                        "owner": "CUSTOMER",
                        "materiality": "MATERIAL",
                        "description": "AI-supported flow business purpose",
                        "evidenceRefs": [EVIDENCE_REF],
                    },
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 1,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "CONTEXT_READY",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    BLOCKED_ASSESSMENT_ID,
                    "system_purpose",
                    INITIAL_SYSTEM_PURPOSE,
                    revision=1,
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 1,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "CONTEXT_READY",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    BLOCKED_ASSESSMENT_ID,
                    "system_purpose",
                    INITIAL_SYSTEM_PURPOSE,
                    revision=1,
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 2,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "CONTEXT_READY",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    BLOCKED_ASSESSMENT_ID,
                    "system_purpose",
                    INITIAL_SYSTEM_PURPOSE,
                    revision=2,
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 2,
                "mode": "BUSINESS_CONTEXT_RESOLUTION",
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "question-lcsp-278-blocked-targeted",
                    "intent": "CLARIFY",
                    "control": "FREE_TEXT",
                    "prompt": "Who must approve the recommendation before action?",
                    "frontier": {
                        "owner": "CUSTOMER",
                        "materiality": "MATERIAL",
                        "description": "Who must approve the recommendation before action?",
                        "evidenceRefs": [EVIDENCE_REF],
                    },
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 3,
                "mode": "BUSINESS_CONTEXT_RESOLUTION",
                "outcome": "BLOCKED_OR_UNRESOLVED",
                "contextAuthority": "CUSTOMER_STATED",
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [
                    "PROVIDE_MORE_CONTEXT",
                    "CHECK_INTERNALLY",
                    "SAVE_AND_EXIT",
                ],
                "targetedResolution": {},
            },
        ]
    )
    analyst = _LedgerAnalystAgent(api, "always_needs")
    factory = _BranchingSpecialistFactory(interview_factory, analyst)
    dispatcher = RootSubagentDispatcher(agent_factory=factory)

    boundary = InterviewGatedEngineeringAssessmentBoundary(
        config,
        api_client=api,
        interview_dispatcher=dispatcher,
    )
    boundary.handle(accepted_event, "corr-lcsp-278-blocked-accepted")
    assert (
        _public_interview_state(BLOCKED_ASSESSMENT_ID)["activeQuestion"]["id"]
        == "question-lcsp-278-blocked-initial"
    )
    assert analyst.calls == 0

    _submit_answer(
        "question-lcsp-278-blocked-initial",
        assessment_id=BLOCKED_ASSESSMENT_ID,
        free_text="The system provides recommendations only.",
    )
    resume_boundary = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
    )
    resume_boundary.handle(
        _latest_resume_payload(BLOCKED_ASSESSMENT_ID),
        "corr-lcsp-278-blocked-initial-answer",
    )
    assert (
        _public_interview_state(BLOCKED_ASSESSMENT_ID)["activeQuestion"]["control"]
        == "CONFIRM_ADJUST"
    )
    _submit_answer(
        _public_interview_state(BLOCKED_ASSESSMENT_ID)["activeQuestion"]["id"],
        assessment_id=BLOCKED_ASSESSMENT_ID,
        confirmed=True,
    )
    resume_boundary.handle(
        _latest_resume_payload(BLOCKED_ASSESSMENT_ID),
        "corr-lcsp-278-blocked-initial-confirmed",
    )
    state = _thread_state(BLOCKED_ASSESSMENT_ID)
    assert state["private"]["targetedNeed"]["needId"].startswith(
        f"need:{ENGINEERING_RULE_ID}:CONTROL:"
    )
    assert analyst.calls == 1

    # The ledger replaces the investigator execution registry: the rule waits
    # on its customer-owned criterion instead of holding a WAITING execution.
    rows = _ledger_rows(api, BLOCKED_ASSESSMENT_ID)
    assert len(rows) == 1
    assert rows[0]["engineeringRuleId"] == ENGINEERING_RULE_ID
    assert rows[0]["status"] == RULE_ANALYSIS_STATUSES["needsContext"]

    resume_boundary.handle(
        _latest_resume_payload(BLOCKED_ASSESSMENT_ID),
        "corr-lcsp-278-blocked-targeted-question",
    )
    assert (
        _public_interview_state(BLOCKED_ASSESSMENT_ID)["activeQuestion"]["prompt"]
        == "Who must approve the recommendation before action?"
    )

    _submit_answer(
        "question-lcsp-278-blocked-targeted",
        assessment_id=BLOCKED_ASSESSMENT_ID,
        free_text="I do not know who approves it yet.",
    )
    resume_boundary.handle(
        _latest_resume_payload(BLOCKED_ASSESSMENT_ID),
        "corr-lcsp-278-blocked-targeted-answer",
    )

    blocked_state = _public_interview_state(BLOCKED_ASSESSMENT_ID)
    assert blocked_state["outcome"] == "BLOCKED_OR_UNRESOLVED"
    assert blocked_state["blockedActions"] == [
        "PROVIDE_MORE_CONTEXT",
        "CHECK_INTERNALLY",
        "SAVE_AND_EXIT",
    ]
    assert blocked_state.get("activeQuestion") is None
    assert analyst.calls == 1
    assert interview_factory.invoke_count == 6
    assert _classification_count(BLOCKED_ASSESSMENT_ID) == 0


def _post_scan_callback(
    api: WorkerApiClient,
    *,
    scan_job_id: str = SCAN_JOB_ID,
    snapshot_id: str = SNAPSHOT_ID,
) -> str:
    result = api.post_scan_callback(
        scan_job_id,
        ScanCallbackPayload(
            scan_job_id=scan_job_id,
            status="SUCCESS",
            tools_version={"deepagents": "0.7.17", "repository-analysis": "1.0.0"},
            config_hash={"repository-analysis": "sha256:lcsp-278-release"},
            evidence_payload={"evidence_graph": _program_graph(snapshot_id)},
            privacy_flags={
                "containsSourceCode": False,
                "secretsRedacted": True,
                "sourceStrippedFromFindings": True,
            },
            schema_version="1.0.0",
        ),
    )
    assert result.accepted is True
    assert result.evidence_report_id
    return str(result.evidence_report_id)


def _seed_engineering_rule_cache(api: WorkerApiClient, report_id: str) -> None:
    retriever = ChromaDbCitationRetriever()
    cache = EngineeringRuleCache()
    service = EngineeringRuleService(retriever=retriever, cache=cache)
    corpus = api.get_legal_corpus_chunks(CORPUS_ID)
    chunks = [item for item in corpus.get("chunks", []) if isinstance(item, dict)]
    retriever.index_corpus(CORPUS_ID, chunks)
    catalog = api.get_active_legal_rule_catalog()
    legal_rule = next(
        rule
        for rule in catalog.get("rules", [])
        if isinstance(rule, dict) and rule.get("legalRuleId") == LEGAL_RULE_ID
    )
    legal_context, fingerprint = service.resolve_source_identity(
        legal_rule=legal_rule,
        legal_corpus_version_id=CORPUS_ID,
    )
    rule = EngineeringRule(
        engineering_rule_id=ENGINEERING_RULE_ID,
        legal_rule_id=LEGAL_RULE_ID,
        legal_rule_catalog_version_id=CATALOG_ID,
        legal_corpus_version_id=CORPUS_ID,
        concept="approval authority",
        legal_intent={"requires": "human approval authority"},
        investigation_goals=("inspect approval authority",),
        starting_node_types=("AI_MODEL_INVOCATION",),
        target_node_types=("AI_MODEL_INVOCATION",),
        edge_strategies=(),
        graph_queries=(
            GraphQueryTemplate(
                name="approval_authority_ai_invocation",
                start_node_types=("AI_MODEL_INVOCATION",),
            ),
        ),
        keywords=("approval", "authority", "recommendation"),
        required_evidence=("CONTROL",),
        source_chunk_ids=tuple(str(item["id"]) for item in legal_context),
        source_locators=tuple(str(item["locator"]) for item in legal_context),
        legal_reasoning_contract=build_legal_reasoning_contract(
            legal_rule=legal_rule,
            legal_rule_catalog_version_id=CATALOG_ID,
            legal_corpus_version_id=CORPUS_ID,
            legal_context=legal_context,
            required_evidence=("CONTROL",),
            supporting_evidence=(),
            negative_evidence=(),
        ),
        source_fingerprint=fingerprint,
        compiler_model="lcsp-278-release-seed",
        compiler_version="lcsp-278-release-seed",
        prompt_version="lcsp-278-release-seed",
    )
    cache.put(fingerprint, [rule])
    # The deterministic applicability gate replaces EngineeringRulePlanner: a
    # legal rule authoring no facts is NOT_GATED, so the rule is eligible.
    gate = evaluate_applicability(
        [{"legalRuleId": LEGAL_RULE_ID}],
        ai_discovery=None,
        confirmed_statements=(),
        engineering_rule_ids_by_legal=legal_rule_id_index([ENGINEERING_RULE_ID]),
    )
    assert gate[LEGAL_RULE_ID]["status"] == APPLICABILITY_STATUSES["not_gated"]


def _program_graph(snapshot_id: str = SNAPSHOT_ID) -> dict[str, Any]:
    return {
        "graph_id": "graph-lcsp-278-release",
        "snapshot_id": snapshot_id,
        "commit_sha": "0123456789abcdef0123456789abcdef01234567",
        "node_count": 1,
        "edge_count": 0,
        "coverage_state": "PARTIAL",
        "coverage_notes": ["dynamic configuration remains bounded but incomplete"],
        "partialCoveragePolicyDecision": {
            "policyDecisionRef": f"coverage-policy:{snapshot_id}",
            "policyVersion": "partial-coverage-policy-v1",
            "permittedForInterview": True,
            "limitations": ["dynamic configuration remains bounded but incomplete"],
        },
        "nodes": [
            {
                "node_id": "node:approval-authority-ai",
                "node_type": "AI_MODEL_INVOCATION",
                "label": "approval authority recommendation model invocation",
                "source": {
                    "file_path": "src/recommendation_service.py",
                    "symbol_ref": "build_recommendation",
                    "start_line": 12,
                    "end_line": 24,
                },
                "attributes": {"purpose": "recommendation approval authority"},
                "semantic_types": ["approval_authority", "recommendation"],
                "evidence_refs": [EVIDENCE_REF],
                "origin": "DEEP_AGENT",
                "resolution_state": "OBSERVED",
                "support_refs": [],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "evidence_refs": [EVIDENCE_REF],
        "graph_hash": "sha256:lcsp-278-release",
    }


def _submit_answer(
    question_id: str,
    *,
    assessment_id: str = ASSESSMENT_ID,
    free_text: str | None = None,
    confirmed: bool | None = None,
) -> dict[str, Any]:
    token = _sign_in()
    state = _public_interview_state(assessment_id)
    active_question = state.get("activeQuestion") or {}
    assert active_question.get("id") == question_id, state
    thread_id = state.get("threadId")
    context_revision = state.get("contextRevision")
    assert isinstance(thread_id, str) and thread_id, state
    assert isinstance(context_revision, int), state
    answer = _canonical_customer_answer(active_question, free_text, confirmed)
    payload: dict[str, Any] = {
        "contractVersion": "interview-technical-contract-v1.0.0",
        "assessmentId": assessment_id,
        "sessionId": thread_id,
        "questionRef": question_id,
        "expectedSessionRevision": context_revision,
        "clientRequestId": (
            f"production-vertical:{assessment_id}:{question_id}:{context_revision}"
        ),
        "answer": answer,
    }
    with httpx.Client(base_url=API_BASE_URL, timeout=30.0) as client:
        response = client.post(
            f"/assessments/{assessment_id}/interview/answers",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
    assert response.status_code == 201, response.text
    return _unwrap(response.json())


def _canonical_customer_answer(
    active_question: dict[str, Any],
    free_text: str | None,
    confirmed: bool | None,
) -> dict[str, Any]:
    control = active_question.get("control")
    if control == "FREE_TEXT":
        assert free_text is not None and free_text.strip(), active_question
        return {"kind": "FREE_TEXT", "text": free_text}
    if control == "CONFIRM_ADJUST":
        if confirmed is True:
            return {"kind": "CONFIRM_ADJUST", "action": "CONFIRM"}
        assert free_text is not None and free_text.strip(), active_question
        return {
            "kind": "CONFIRM_ADJUST",
            "action": "ADJUST",
            "adjustmentText": free_text,
        }
    raise AssertionError(f"Unsupported production vertical question control: {control}")


def _public_interview_state(assessment_id: str = ASSESSMENT_ID) -> dict[str, Any]:
    token = _sign_in()
    with httpx.Client(base_url=API_BASE_URL, timeout=30.0) as client:
        response = client.get(
            f"/assessments/{assessment_id}/interview",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 200, response.text
    return _unwrap(response.json())


def _sign_in() -> str:
    with httpx.Client(base_url=API_BASE_URL, timeout=30.0) as client:
        response = client.post(
            "/auth/sign-in",
            json={
                "email": "manager@acme.test",
                "password": "CorrectHorseBatteryStaple!",
                "organization_id": "org-1",
            },
        )
    assert response.status_code in {200, 201}, response.text
    token = _unwrap(response.json())["session_token"]
    return str(token)


def _latest_resume_payload(assessment_id: str = ASSESSMENT_ID) -> dict[str, Any]:
    return _outbox_payload(
        "command.assessment-interview.resume-agent.v1",
        aggregate_id=assessment_id,
    )


def _outbox_payload(event_type: str, *, aggregate_id: str) -> dict[str, Any]:
    with _api_connection() as connection:
        row = connection.execute(
            """
            SELECT payload
            FROM "OutboxMessage"
            WHERE "eventType" = %s AND "aggregateId" = %s
            ORDER BY "createdAt" DESC
            LIMIT 1
            """,
            (event_type, aggregate_id),
        ).fetchone()
    assert row is not None, f"missing outbox event {event_type}"
    payload = row["payload"]
    assert isinstance(payload, dict)
    return payload


def _thread_state(assessment_id: str = ASSESSMENT_ID) -> dict[str, Any]:
    with _api_connection() as connection:
        row = connection.execute(
            """
            SELECT "stateJson", "privateContextJson"
            FROM "AssessmentInterviewThread"
            WHERE "assessmentId" = %s
            """,
            (assessment_id,),
        ).fetchone()
    assert row is not None
    private = row["privateContextJson"]
    assert isinstance(private, dict)
    return {"state": row["stateJson"], "private": private}


def _classification_count(assessment_id: str = ASSESSMENT_ID) -> int:
    with _api_connection() as connection:
        row = connection.execute(
            'SELECT COUNT(*) AS count FROM "ClassificationResult" WHERE "assessmentId" = %s',
            (assessment_id,),
        ).fetchone()
    assert row is not None
    return int(row["count"])


def _classification_result() -> dict[str, Any]:
    with _api_connection() as connection:
        row = connection.execute(
            """
            SELECT "assessmentId", "classificationData", "guardrailStatus"
            FROM "ClassificationResult"
            WHERE "assessmentId" = %s
            ORDER BY "createdAt" DESC
            LIMIT 1
            """,
            (ASSESSMENT_ID,),
        ).fetchone()
    assert row is not None
    assert isinstance(row["classificationData"], dict)
    return dict(row)


def _mutate_snapshot_provenance() -> None:
    with _api_connection() as connection:
        connection.execute(
            """
            UPDATE "RepositorySnapshot"
            SET "commitSha" = 'fedcba9876543210fedcba9876543210fedcba98'
            WHERE id = %s
            """,
            (SNAPSHOT_ID,),
        )
        connection.commit()


def _api_connection():
    assert API_DATABASE_URL
    return psycopg.connect(_libpq_url(API_DATABASE_URL), row_factory=dict_row)


def _libpq_url(value: str) -> str:
    parsed = urlsplit(value)
    query = urlencode(
        [(key, item) for key, item in parse_qsl(parsed.query) if key != "schema"]
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


def _unwrap(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("ok") is True and isinstance(value.get("data"), dict):
        return value["data"]
    return value
