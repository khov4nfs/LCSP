"""Tests for LCSP-285: Governed evidence tools and customer-safe evidence projection for Interview Agent."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4
import json
import os
import pytest

from orchestration.context import LCSPRunContext
from subagents.interview.customer_safe_projection import (
    GovernedEvidenceMetadata,
    InterviewEvidenceDTO,
    InterviewFrontier,
    TurnEvidenceLedger,
    build_why_are_we_asking_explanation,
    evaluate_question_eligibility,
    get_active_turn_evidence_ledger,
    is_customer_owned_frontier,
    normalize_coverage_state,
    project_customer_safe_evidence,
    reset_active_turn_evidence_ledger,
    sanitize_customer_facing_text,
    set_active_turn_evidence_ledger,
    validate_evidence_refs,
)
from subagents.interview.definition import SUBAGENT, TOOLS
from tools.common.capabilities.agentic_evidence.entrypoints.program_graph_tool_entrypoints import (
    get_scan_coverage as entry_get_scan_coverage,
    inspect_data_path as entry_inspect_data_path,
    inspect_decision_path as entry_inspect_decision_path,
    inspect_human_review_path as entry_inspect_human_review_path,
    search_evidence as entry_search_evidence,
)
from tools.common.capabilities.agentic_evidence.governance.registry import (
    AgenticToolBudget,
    AgenticToolRequest,
    AgenticToolValidationError,
)
from tools.common.capabilities.agentic_evidence.entrypoints.tool_entrypoints import (
    AgenticToolExecutionContext,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    InterviewGatedEngineeringAssessmentBoundary,
)
from tools.common.capabilities.workflow.recovery.interview_boundary import (
    AssessmentInterviewResumeBoundary,
    _interview_instruction,
)
from tools.common.runtime_envelope import (
    AgenticToolInvocationError,
    dispatch_agentic_tool,
    set_agentic_tool_api_client,
    trusted_request_from_model_input,
)
from tools.common.search_program_graph.code import (
    SearchProgramGraphRequest,
    search_program_graph,
)
from tools.investigator.inspect_data_path.code import (
    InspectDataPathRequest,
    inspect_data_path,
)
from tools.investigator.inspect_decision_path.code import (
    InspectDecisionPathRequest,
    inspect_decision_path,
)
from tools.investigator.inspect_human_review_path.code import (
    InspectHumanReviewPathRequest,
    inspect_human_review_path,
)
from tools.planner.get_scan_coverage.code import (
    ScanCoverageRequest,
    get_scan_coverage,
)


def _mock_graph(
    coverage_state: str = "SUFFICIENT",
    coverage_notes: list[str] | None = None,
    unresolved_frontiers: list[str] | None = None,
) -> dict:
    return {
        "graph_id": "graph:test-1",
        "schema_version": "2.0.0",
        "snapshot_id": "snap-1",
        "commit_sha": "abc1234",
        "node_count": 3,
        "edge_count": 2,
        "nodes": [
            {
                "node_id": "node:node-rec-101",
                "node_type": "RECOMMENDATION",
                "label": "AI Loan Recommendation",
                "source": {"file_path": "src/services/loan.ts", "start_line": 10},
                "attributes": {"confidence": 0.95, "internal_secret": "sk_test_secret_123"},
                "semantic_types": ["AI_RECOMMENDATION"],
                "resolution_state": "OBSERVED",
                "evidence_refs": ["evidence:symbol:loan_rec"],
            },
            {
                "node_id": "node:node-dec-101",
                "node_type": "BUSINESS_DECISION",
                "label": "Automated Approval",
                "source": {"file_path": "src/controllers/loan.ts", "start_line": 50},
                "attributes": {},
                "semantic_types": ["DECISION_FLOW"],
                "resolution_state": "INFERRED",
                "evidence_refs": ["evidence:symbol:approval_action"],
            },
            {
                "node_id": "node:node-human-101",
                "node_type": "HUMAN_REVIEW",
                "label": "Supervisor Override",
                "source": {"file_path": "src/workflows/review.ts", "start_line": 20},
                "attributes": {},
                "semantic_types": ["HUMAN_REVIEW"],
                "resolution_state": "UNRESOLVED",
                "evidence_refs": ["evidence:symbol:human_override"],
            },
        ],
        "edges": [
            {
                "edge_id": "edge-1",
                "source_node_id": "node:node-rec-101",
                "target_node_id": "node:node-dec-101",
                "source_id": "node:node-rec-101",
                "target_id": "node:node-dec-101",
                "edge_type": "INFLUENCES",
                "evidence_refs": ["evidence:flow:rec_to_dec"],
            },
            {
                "edge_id": "edge-2",
                "source_node_id": "node:node-dec-101",
                "target_node_id": "node:node-human-101",
                "source_id": "node:node-dec-101",
                "target_id": "node:node-human-101",
                "edge_type": "REQUIRES_APPROVAL",
                "evidence_refs": ["evidence:flow:dec_to_human"],
            },
        ],
        "source_anchors": [],
        "indexes": {
            "RECOMMENDATION": ["node:node-rec-101"],
            "BUSINESS_DECISION": ["node:node-dec-101"],
            "HUMAN_REVIEW": ["node:node-human-101"],
        },
        "unresolved_frontiers": unresolved_frontiers or [
            "BUSINESS: Whether supervisor approval is mandatory before loan disbursement",
            "TECHNICAL: Dynamic call target unresolved in payment gateway",
        ],
        "coverage_state": coverage_state,
        "coverage_notes": coverage_notes or ["Coverage limited to backend service API."],
        "provenance": {"producer": "scanner-v2"},
        "evidence_refs": ["evidence:symbol:loan_rec", "evidence:symbol:approval_action"],
        "graph_hash": "sha256:testgraphhash",
    }


# ============================================================================
# Group A — Initial Interview Runtime Tests
# ============================================================================

def test_initial_interview_receives_trusted_lcsp_run_context() -> None:
    """Initial Interview boundary constructs and passes authoritative LCSPRunContext to dispatcher."""
    report_id = "ter-init-1"
    mock_dispatcher = MagicMock()
    mock_dispatcher.dispatch.return_value = {
        "handoff": {
            "outcome": "WAITING_FOR_CUSTOMER",
            "activeQuestion": {
                "id": "q-init",
                "prompt": "Is approval mandatory?",
                "frontier": {
                    "owner": "CUSTOMER",
                    "materiality": "MATERIAL",
                    "description": "Approval threshold",
                    "evidenceRefs": [f"technicalEvidenceReport:{report_id}"],
                },
            },
        }
    }
    mock_api = MagicMock()
    mock_api.get_interview_worker_state.return_value = {
        "outcome": "WAITING_FOR_CUSTOMER",
        "contextRevision": 0,
        "activeQuestion": None,
        "authenticatedActorId": "user-cust-123",
    }

    boundary = InterviewGatedEngineeringAssessmentBoundary(
        config=MagicMock(),
        api_client=mock_api,
        interview_dispatcher=mock_dispatcher,
    )

    asmt_id = str(uuid4())
    evidence_report = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-init-1",
        "sourceVersion": "snap-init-1:sha1",
        "pgeVersion": "ter-init-1:2.0.0",
        "guidanceVersion": "guidance-v1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }

    workflow_run_id = str(uuid4())
    boundary._prepare_interview(
        evidence_report=evidence_report,
        evidence_report_id=report_id,
        assessment_id=asmt_id,
        correlation_id=str(uuid4()),
        workflow_run_id=workflow_run_id,
    )

    mock_dispatcher.dispatch.assert_called_once()
    call_kwargs = mock_dispatcher.dispatch.call_args.kwargs
    passed_context: LCSPRunContext = call_kwargs["context"]

    assert passed_context is not None
    assert passed_context.assessment_id == asmt_id
    assert passed_context.user_id == "user-cust-123"
    assert UUID(str(passed_context.workflow_run_id))  # Valid UUID
    assert passed_context.artifact_versions["technicalEvidenceReportId"] == report_id
    assert passed_context.artifact_versions["repositorySnapshotId"] == "snap-init-1"


# ============================================================================
# Group B — Resume Interview Runtime Tests
# ============================================================================

def test_resume_interview_boundary_dispatches_with_distinct_thread_and_workflow_id() -> None:
    """AssessmentInterviewResumeBoundary uses real UUID workflowRunId separate from threadId."""
    mock_dispatcher = MagicMock()
    mock_dispatcher.dispatch.return_value = {
        "handoff": {
            "outcome": "WAITING_FOR_CUSTOMER",
            "activeQuestion": {
                "id": "q-1",
                "prompt": "Is the loan recommendation advisory?",
                "whyEvidenceRefs": ["interviewRuntime:assessment-interview-runtime-v1"],
                "frontier": {
                    "owner": "CUSTOMER",
                    "materiality": "MATERIAL",
                    "description": "Loan recommendation advisory",
                    "evidenceRefs": ["interviewRuntime:assessment-interview-runtime-v1"],
                },
            },
        }
    }
    mock_api = MagicMock()
    boundary = AssessmentInterviewResumeBoundary(
        config=MagicMock(),
        api_client=mock_api,
        dispatcher=mock_dispatcher,
    )

    asmt_id = str(uuid4())
    thread_id = f"interview:{asmt_id}"
    wf_uuid = str(uuid4())
    context = {
        "status": "CURRENT",
        "threadId": thread_id,
        "workflowRunId": wf_uuid,
        "authenticatedActorId": "customer-actor-999",
        "sourceVersion": "snap-1:commit1",
        "pgeVersion": "ter-1:2.0.0",
        "guidanceVersion": "guidance-v1",
        "technicalCoverageState": "PARTIAL",
        "coverageLimitations": ["Payment gateway unindexed"],
        "privateRevision": {
            "actorId": "customer-actor-999",
            "governedEvidenceRefs": ["repositorySnapshot:snap-1"],
        },
        "publicState": {
            "outcome": "WAITING_FOR_CUSTOMER",
        },
    }

    decision = boundary._run_interview(
        assessment_id=asmt_id,
        thread_id=thread_id,
        question_id="q-1",
        context_revision=1,
        resume_reason="INTERVIEW_AGENT_DECISION_REQUIRED",
        context=context,
        correlationId=str(uuid4()),
    )

    assert decision["expectedContextRevision"] == 1
    mock_dispatcher.dispatch.assert_called_once()
    call_kwargs = mock_dispatcher.dispatch.call_args.kwargs
    passed_context: LCSPRunContext = call_kwargs["context"]

    assert passed_context.assessment_id == asmt_id
    assert passed_context.user_id == "customer-actor-999"
    assert passed_context.workflow_run_id == wf_uuid
    assert passed_context.workflow_run_id != thread_id  # Separate identity
    assert call_kwargs["thread_id"] == thread_id


# ============================================================================
# Group C — Runtime Routing (Canonical Binding vs Env Vars) Tests
# ============================================================================

def test_pge_tools_execute_locally_even_when_nestjs_env_is_set(monkeypatch) -> None:
    """PGE graph tools execute locally via canonical PYTHON_LOCAL binding even with NESTJS_API_BASE_URL set."""
    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }
    mock_api.rbac_client.check.return_value = "allow"
    set_agentic_tool_api_client(mock_api)

    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://api.production.internal:3000")
    monkeypatch.setenv("WORKER_API_KEY", "worker-secret-key")

    run_context = LCSPRunContext(
        assessment_id=asmt_id,
        user_id="user-1",
        workflow_run_id=wf_id,
        artifact_versions={"technicalEvidenceReportId": "ter-1", "repositorySnapshotId": "snap-1"},
    )
    runtime = SimpleNamespace(context=run_context)

    # All 5 tools execute Python-locally without attempting HTTP POST to mock URL
    cov = get_scan_coverage.func(runtime, maxResults=10)
    assert cov["coverageState"] == "READY"

    search = search_program_graph.func(runtime, query="AI Loan", maxResults=5)
    assert "nodes" in search

    dec = inspect_decision_path.func(runtime, subjectRef="node:node-rec-101", maxHops=3)
    assert "decisionNodes" in dec or "paths" in dec or "nodes" in dec

    data = inspect_data_path.func(runtime, subjectRef="node:node-rec-101", maxHops=3)
    assert "nodes" in data or "paths" in data

    hr = inspect_human_review_path.func(runtime, subjectRef="node:node-dec-101", maxHops=3)
    assert "reviewNodes" in hr or "overridePaths" in hr or "unresolvedFrontiers" in hr

    set_agentic_tool_api_client(None)


# ============================================================================
# Group D — Governance (Schema, Budget, RBAC, Safe Output) Tests
# ============================================================================

def test_tool_fails_without_trusted_runtime_context() -> None:
    """Tool execution must fail closed when runtime context is absent."""
    with pytest.raises(AgenticToolInvocationError, match="requires ToolRuntime context"):
        search_program_graph.func(runtime=None, query="loan")


def test_trusted_request_overlays_runtime_context_and_forbids_model_override() -> None:
    """Model input cannot provide or mutate assessmentId, userId, or artifactVersions."""
    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    run_context = LCSPRunContext(
        assessment_id=asmt_id,
        user_id="user-trusted-456",
        workflow_run_id=wf_id,
        artifact_versions={
            "technicalEvidenceReportId": "ter-1",
            "repositorySnapshotId": "snap-1",
        },
    )
    runtime = SimpleNamespace(context=run_context)

    trusted = trusted_request_from_model_input(
        {"query": "automated loan", "assessment_id": str(uuid4())},
        runtime=runtime,
    )
    assert trusted.assessment_id == asmt_id
    assert trusted.user_id == "user-trusted-456"
    assert trusted.workflow_run_id == wf_id
    assert trusted.artifact_versions["technicalEvidenceReportId"] == "ter-1"


# ============================================================================
# Group E — Workflow ID vs Thread ID Validation Tests
# ============================================================================

def test_invalid_workflow_run_id_format_fails_validation() -> None:
    """Using a non-UUID string like 'interview:asmt-1' directly as workflowRunId fails UUID validation."""
    with pytest.raises(Exception):
        AgenticToolRequest.model_validate({
            "toolName": "get_scan_coverage",
            "requestId": str(uuid4()),
            "assessmentId": str(uuid4()),
            "workflowRunId": "interview:not-a-valid-uuid",
            "artifactVersions": {"technicalEvidenceReportId": "ter-1"},
            "correlationId": str(uuid4()),
            "budget": {"maxItems": 10, "maxDepth": 5, "maxBytes": 16384, "maxDurationMs": 1000},
            "input": {},
        })


# ============================================================================
# Group F — Tool Schema & Argument Mapping Tests
# ============================================================================

def test_missing_start_ref_raises_deterministic_validation_error() -> None:
    """Traversal tools must fail deterministically when subject/start ref is empty."""
    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }
    set_agentic_tool_api_client(mock_api)

    req = AgenticToolRequest.model_validate({
        "toolName": "inspect_decision_path",
        "requestId": str(uuid4()),
        "assessmentId": asmt_id,
        "workflowRunId": wf_id,
        "artifactVersions": {"technicalEvidenceReportId": "ter-1", "repositorySnapshotId": "snap-1"},
        "correlationId": str(uuid4()),
        "budget": {"maxItems": 10, "maxDepth": 5, "maxBytes": 16384, "maxDurationMs": 1000},
        "input": {"maxResults": 10},  # startRef missing
    })
    ctx = AgenticToolExecutionContext(mock_api, "user-1")

    with pytest.raises(ValueError, match="startRef or subjectRef is required"):
        entry_inspect_decision_path(req, ctx)

    set_agentic_tool_api_client(None)


# ============================================================================
# Group G — Artifact Ownership & Provenance Pinning Tests
# ============================================================================

def test_report_assessment_mismatch_fails_closed() -> None:
    """Report belonging to a different assessment must be rejected."""
    asmt_id = str(uuid4())
    other_asmt_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": other_asmt_id,
        "snapshotId": "snap-1",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }

    req = AgenticToolRequest.model_validate({
        "toolName": "get_scan_coverage",
        "requestId": str(uuid4()),
        "assessmentId": asmt_id,
        "workflowRunId": str(uuid4()),
        "artifactVersions": {"technicalEvidenceReportId": "ter-1"},
        "correlationId": str(uuid4()),
        "budget": {"maxItems": 10, "maxDepth": 5, "maxBytes": 16384, "maxDurationMs": 1000},
        "input": {},
    })
    ctx = AgenticToolExecutionContext(mock_api, "user-1")

    with pytest.raises(ValueError, match="EVIDENCE_REPORT_ASSESSMENT_MISMATCH"):
        entry_get_scan_coverage(req, ctx)


def test_stale_snapshot_report_mismatch_fails_closed() -> None:
    """Report generated from snapshot V1 when assessment is pinned to V2 must be rejected."""
    asmt_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-v1",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }

    req = AgenticToolRequest.model_validate({
        "toolName": "get_scan_coverage",
        "requestId": str(uuid4()),
        "assessmentId": asmt_id,
        "workflowRunId": str(uuid4()),
        "artifactVersions": {
            "technicalEvidenceReportId": "ter-1",
            "repositorySnapshotId": "snap-v2-CURRENT",
        },
        "correlationId": str(uuid4()),
        "budget": {"maxItems": 10, "maxDepth": 5, "maxBytes": 16384, "maxDurationMs": 1000},
        "input": {},
    })
    ctx = AgenticToolExecutionContext(mock_api, "user-1")

    with pytest.raises(ValueError, match="EVIDENCE_REPORT_SNAPSHOT_MISMATCH"):
        entry_get_scan_coverage(req, ctx)


def test_rejected_report_status_fails_closed() -> None:
    """Report marked as REJECTED fails closed."""
    asmt_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "REJECTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }

    req = AgenticToolRequest.model_validate({
        "toolName": "get_scan_coverage",
        "requestId": str(uuid4()),
        "assessmentId": asmt_id,
        "workflowRunId": str(uuid4()),
        "artifactVersions": {"technicalEvidenceReportId": "ter-1"},
        "correlationId": str(uuid4()),
        "budget": {"maxItems": 10, "maxDepth": 5, "maxBytes": 16384, "maxDurationMs": 1000},
        "input": {},
    })
    ctx = AgenticToolExecutionContext(mock_api, "user-1")

    with pytest.raises(ValueError, match="EVIDENCE_REPORT_REJECTED"):
        entry_get_scan_coverage(req, ctx)


# ============================================================================
# Group H — Coverage Normalization & Limitations Preservation Tests
# ============================================================================

def test_coverage_state_normalization() -> None:
    """SUFFICIENT maps to READY, LIMITED maps to PARTIAL, UNAVAILABLE maps to UNAVAILABLE."""
    assert normalize_coverage_state("SUFFICIENT") == "READY"
    assert normalize_coverage_state("READY") == "READY"
    assert normalize_coverage_state("LIMITED") == "PARTIAL"
    assert normalize_coverage_state("PARTIAL") == "PARTIAL"
    assert normalize_coverage_state("UNAVAILABLE") == "UNAVAILABLE"
    assert normalize_coverage_state("UNKNOWN_VAL") == "UNAVAILABLE"


def test_coverage_state_and_limitations_survive_instruction_serialization() -> None:
    """READY / PARTIAL / UNAVAILABLE and coverageLimitations survive serialization into interview worker."""
    instruction = _interview_instruction(
        assessment_id=str(uuid4()),
        question_id="q-1",
        context_revision=2,
        resume_reason="PROVIDE_MORE_CONTEXT",
        context={
            "sourceVersion": "snap-1:sha1",
            "pgeVersion": "ter-1:schema2",
            "technicalCoverageState": "PARTIAL",
            "coverageLimitations": ["Payment gateway unindexed", "Dynamic router unresolved"],
            "guidanceVersion": "gv-1",
        },
    )

    assert '"technicalCoverageState": "PARTIAL"' in instruction
    assert "Payment gateway unindexed" in instruction
    assert "Dynamic router unresolved" in instruction


# ============================================================================
# Group I — Resolution State & "Why are we asking?" Explanation Tests
# ============================================================================

def test_resolution_state_distinguishes_observed_inferred_unresolved() -> None:
    """Customer-safe projection preserves OBSERVED, INFERRED, and UNRESOLVED resolution states."""
    projection = project_customer_safe_evidence(_mock_graph())

    nodes_by_label = {node["label"]: node for node in projection["nodes"]}
    assert nodes_by_label["AI Loan Recommendation"]["resolutionState"] == "OBSERVED"
    assert nodes_by_label["Automated Approval"]["resolutionState"] == "INFERRED"
    assert nodes_by_label["Supervisor Override"]["resolutionState"] == "UNRESOLVED"


def test_why_are_we_asking_adapts_to_resolution_and_coverage() -> None:
    """Explanation reflects certainty according to resolution state and coverage."""
    # OBSERVED
    obs_why = build_why_are_we_asking_explanation(
        topic="loan approval",
        evidence_observation="an AI model recommendation path",
        resolution_state="OBSERVED",
        coverage_state="READY",
    )
    assert "We found evidence that an AI model recommendation path" in obs_why

    # INFERRED
    inf_why = build_why_are_we_asking_explanation(
        topic="loan approval",
        evidence_observation="automated decision triggering",
        resolution_state="INFERRED",
        coverage_state="READY",
    )
    assert "We found evidence suggesting that automated decision triggering" in inf_why

    # UNRESOLVED
    unres_why = build_why_are_we_asking_explanation(
        topic="supervisor review",
        evidence_observation="supervisor override is required",
        resolution_state="UNRESOLVED",
        coverage_state="PARTIAL",
    )
    assert "The available technical evidence does not establish whether supervisor review" in unres_why

    # UNAVAILABLE
    unavail_why = build_why_are_we_asking_explanation(
        topic="payment processing",
        resolution_state="UNRESOLVED",
        coverage_state="UNAVAILABLE",
    )
    assert "Technical evidence is unavailable to determine whether payment processing" in unavail_why


# ============================================================================
# Group J — Turn-Scoped Evidence Ledger & Ref Validation Tests
# ============================================================================

def test_turn_evidence_ledger_records_and_validates_refs() -> None:
    """TurnEvidenceLedger accumulates retrieved evidence refs and detects unauthorized ones."""
    ledger = TurnEvidenceLedger(initial_authorized_refs=["repositorySnapshot:snap-1"])
    ledger.record_retrieved_refs(["evidence:symbol:loan_rec", "evidence:flow:rec_to_dec"])

    assert ledger.is_authorized("repositorySnapshot:snap-1") is True
    assert ledger.is_authorized("evidence:symbol:loan_rec") is True
    assert ledger.is_authorized("evidence:symbol:approval_action") is False

    auth, rejected = ledger.validate_refs([
        "evidence:symbol:loan_rec",
        "evidence:fabricated:fake_ref",
    ])
    assert auth == ["evidence:symbol:loan_rec"]
    assert rejected == ["evidence:fabricated:fake_ref"]


def test_validate_evidence_refs_accepts_authorized_and_rejects_fabricated() -> None:
    """Fabricated or cross-assessment evidence refs are strictly rejected."""
    authorized = {"repositorySnapshot:snap-1", "technicalEvidenceReport:ter-1", "evidence:symbol:123"}

    # Authorized refs pass
    assert validate_evidence_refs(["repositorySnapshot:snap-1", "evidence:symbol:123"], authorized) == [
        "evidence:symbol:123",
        "repositorySnapshot:snap-1",
    ]

    # Fabricated ref fails
    with pytest.raises(ValueError, match="unauthorized or fabricated refs"):
        validate_evidence_refs(["repositorySnapshot:snap-1", "evidence:fabricated:999"], authorized)


# ============================================================================
# Group K — Customer Frontier & Question Eligibility Guard Tests
# ============================================================================

def test_question_eligibility_guard_enforces_customer_and_material() -> None:
    """Question guard passes CUSTOMER + MATERIAL and rejects technical or non-material frontiers."""
    ledger = TurnEvidenceLedger(["evidence:symbol:loan_rec"])

    # Eligible
    frontier_eligible = InterviewFrontier(
        owner="CUSTOMER",
        materiality="MATERIAL",
        description="Whether loan officer approval is required before disbursement",
        evidence_refs=["evidence:symbol:loan_rec"],
    )
    ok, reason = evaluate_question_eligibility(frontier_eligible, ledger)
    assert ok is True
    assert reason == "ELIGIBLE"

    # Non-material => rejected
    frontier_non_mat = InterviewFrontier(
        owner="CUSTOMER",
        materiality="NON_MATERIAL",
        description="UI button theme color",
    )
    ok, reason = evaluate_question_eligibility(frontier_non_mat, ledger)
    assert ok is False
    assert "not MATERIAL" in reason

    # Technical owner => rejected
    frontier_tech = InterviewFrontier(
        owner="TECHNICAL",
        materiality="MATERIAL",
        description="Dynamic call target in payment gateway",
    )
    ok, reason = evaluate_question_eligibility(frontier_tech, ledger)
    assert ok is False
    assert "not CUSTOMER-owned" in reason

    # Unauthorized evidence ref => raises ValueError
    frontier_unauth = InterviewFrontier(
        owner="CUSTOMER",
        materiality="MATERIAL",
        description="Business logic clarification",
        evidence_refs=["evidence:fabricated:999"],
    )
    with pytest.raises(ValueError, match="unauthorized or fabricated refs"):
        evaluate_question_eligibility(frontier_unauth, ledger)


# ============================================================================
# Group L — Secret, Source, and Internal Token Leakage Protection Tests
# ============================================================================

def test_sanitize_customer_facing_text_strips_credentials_and_secrets() -> None:
    """Sanitizer and allowlist projection strip API keys, Bearer tokens, JWTs, DB URLs, and AWS keys."""
    raw_text = (
        "Found apiKey='sk_live_1234567890abcdef' and Authorization: Bearer eyJhbGciOiJIUzI1Ni.eyJzdWIiOiIx.test "
        "connecting to postgres://user:secretpassword@db.example.com/production with AWS AKIAIOSFODNN7EXAMPLE "
        "in src/config/database.ts:88 with checkpointId='cp-1234' and threadId='thread-5678'."
    )
    sanitized = sanitize_customer_facing_text(raw_text)

    assert "sk_live_" not in sanitized
    assert "secretpassword" not in sanitized
    assert "AKIAIOSFODNN7EXAMPLE" not in sanitized
    assert "src/config/database.ts:88" not in sanitized
    assert "cp-1234" not in sanitized
    assert "thread-5678" not in sanitized
    assert "[redacted secret]" in sanitized or "[file reference]" in sanitized


def test_customer_safe_projection_excludes_internal_node_ids_and_attributes() -> None:
    """Customer-safe projection must not leak internal node_id or raw attributes."""
    projection = project_customer_safe_evidence(_mock_graph())

    for node in projection["nodes"]:
        assert "id" not in node
        assert "node_id" not in node
        assert "attributes" not in node
        assert "source" not in node
        assert "internal_secret" not in str(node)


# ============================================================================
# Minimal Tool Surface Verification
# ============================================================================

def test_interview_has_no_engineering_or_raw_repository_tools() -> None:
    """Interview specialist tool list contains only governed evidence query tools."""
    tool_names = tuple(getattr(t, "name") for t in TOOLS)
    assert tool_names == (
        "search_program_graph",
        "get_scan_coverage",
        "inspect_decision_path",
        "inspect_data_path",
        "inspect_human_review_path",
    )

    disallowed_tools = {
        "get_finding_detail",
        "retrieve_engineering_rules",
        "propose_gap_remediation",
        "retrieve_verified_episodes",
        "retrieve_legal_basis",
        "maintain_legal_catalog",
        "read_file",
        "run_command",
    }
    for tool in disallowed_tools:
        assert tool not in tool_names


# ============================================================================
# Regression Suite — P0-1 to P0-8 & P1 Failure Modes
# ============================================================================

def test_unauthorized_rbac_fails_closed() -> None:
    """When RBAC check evaluates to non-allow (deny), tool dispatch fails closed with AGENTIC_TOOL_RBAC_BLOCKED."""
    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }
    # RBAC returns deny
    mock_api.rbac_client.check.return_value = "deny"
    set_agentic_tool_api_client(mock_api)

    run_context = LCSPRunContext(
        assessment_id=asmt_id,
        user_id="unauthorized-actor-attacker",
        workflow_run_id=wf_id,
        artifact_versions={"technicalEvidenceReportId": "ter-1", "repositorySnapshotId": "snap-1"},
    )
    runtime = SimpleNamespace(context=run_context)

    with pytest.raises((AgenticToolInvocationError, AgenticToolValidationError), match="AGENTIC_TOOL_RBAC_BLOCKED"):
        search_program_graph.func(runtime, query="Loan", maxResults=5)

    set_agentic_tool_api_client(None)


def test_rbac_client_missing_fails_closed() -> None:
    """When api_client does not have rbac_client, tool dispatch fails closed with AGENTIC_TOOL_RBAC_UNAVAILABLE."""
    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    mock_api = MagicMock(spec=["get_accepted_technical_evidence_report"])
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }
    set_agentic_tool_api_client(mock_api)

    run_context = LCSPRunContext(
        assessment_id=asmt_id,
        user_id="unauthorized-actor-attacker",
        workflow_run_id=wf_id,
        artifact_versions={"technicalEvidenceReportId": "ter-1", "repositorySnapshotId": "snap-1"},
    )
    runtime = SimpleNamespace(context=run_context)

    with pytest.raises((AgenticToolInvocationError, AgenticToolValidationError), match="AGENTIC_TOOL_RBAC_UNAVAILABLE"):
        search_program_graph.func(runtime, query="Loan", maxResults=5)

    set_agentic_tool_api_client(None)


def test_secrets_in_attributes_are_stripped_from_agent_nodes() -> None:
    """Nodes returned by PGE tools must not leak nested attributes, internal secrets, or source paths."""
    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }
    mock_api.rbac_client.check.return_value = "allow"
    set_agentic_tool_api_client(mock_api)

    run_context = LCSPRunContext(
        assessment_id=asmt_id,
        user_id="user-1",
        workflow_run_id=wf_id,
        artifact_versions={"technicalEvidenceReportId": "ter-1", "repositorySnapshotId": "snap-1"},
    )
    runtime = SimpleNamespace(context=run_context)

    result = search_program_graph.func(runtime, query="AI Loan", maxResults=5)
    nodes = result["nodes"]
    assert len(nodes) > 0

    for node in nodes:
        assert "attributes" not in node
        assert "source" not in node
        assert "internal_secret" not in str(node)
        assert "sk_test_secret_123" not in str(node)
        assert "file_path" not in str(node)

    set_agentic_tool_api_client(None)


def test_search_program_graph_with_query_filters_nodes() -> None:
    """search_program_graph text query must filter nodes and not return unmatched nodes."""
    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }
    mock_api.rbac_client.check.return_value = "allow"
    set_agentic_tool_api_client(mock_api)

    run_context = LCSPRunContext(
        assessment_id=asmt_id,
        user_id="user-1",
        workflow_run_id=wf_id,
        artifact_versions={"technicalEvidenceReportId": "ter-1", "repositorySnapshotId": "snap-1"},
    )
    runtime = SimpleNamespace(context=run_context)

    # Query matching only "Approval"
    result_approval = search_program_graph.func(runtime, query="Approval", maxResults=5)
    labels = [n["label"] for n in result_approval["nodes"]]
    assert "Automated Approval" in labels
    assert "AI Loan Recommendation" not in labels

    # Query matching nothing
    result_none = search_program_graph.func(runtime, query="THIS QUERY SHOULD FILTER OUT EVERYTHING", maxResults=5)
    assert len(result_none["nodes"]) == 0

    set_agentic_tool_api_client(None)


def test_missing_materiality_fails_closed() -> None:
    """Missing, None, or unknown materiality must fail closed (not assume MATERIAL)."""
    ledger = TurnEvidenceLedger(["evidence:symbol:loan_rec"])

    # Missing materiality
    frontier_missing_mat = {"owner": "CUSTOMER", "description": "Clarify loan limits"}
    ok, reason = evaluate_question_eligibility(frontier_missing_mat, ledger)
    assert ok is False
    assert "not MATERIAL" in reason

    # None materiality
    frontier_none_mat = {"owner": "CUSTOMER", "materiality": None, "description": "Clarify loan limits"}
    ok, reason = evaluate_question_eligibility(frontier_none_mat, ledger)
    assert ok is False
    assert "not MATERIAL" in reason

    # Unknown string materiality
    frontier_unknown_mat = {"owner": "CUSTOMER", "materiality": "UNKNOWN_VALUE", "description": "Clarify loan limits"}
    ok, reason = evaluate_question_eligibility(frontier_unknown_mat, ledger)
    assert ok is False
    assert "not MATERIAL" in reason


def test_turn_ledger_authorizes_runtime_retrieved_refs() -> None:
    """TurnEvidenceLedger accumulates refs returned during tool dispatch in the current turn."""
    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }
    mock_api.rbac_client.check.return_value = "allow"
    set_agentic_tool_api_client(mock_api)

    from subagents.interview.customer_safe_projection import (
        set_active_turn_evidence_ledger,
    )

    ledger = TurnEvidenceLedger(initial_authorized_refs=["repositorySnapshot:snap-1"])
    set_active_turn_evidence_ledger(ledger)

    run_context = LCSPRunContext(
        assessment_id=asmt_id,
        user_id="user-1",
        workflow_run_id=wf_id,
        artifact_versions={"technicalEvidenceReportId": "ter-1", "repositorySnapshotId": "snap-1"},
    )
    runtime = SimpleNamespace(context=run_context)

    try:
        # Before tool call, evidence:symbol:loan_rec is not in ledger
        assert ledger.is_authorized("evidence:symbol:loan_rec") is False

        # Run search tool that returns evidence:symbol:loan_rec
        search_program_graph.func(runtime, query="AI Loan", maxResults=5)

        # After tool call, ledger dynamically records returned evidenceRefs
        assert ledger.is_authorized("evidence:symbol:loan_rec") is True
        # Unreturned/fabricated ref remains blocked
        assert ledger.is_authorized("evidence:fabricated:fake") is False
    finally:
        set_active_turn_evidence_ledger(None)
        set_agentic_tool_api_client(None)


def test_initial_interview_fails_closed_without_actor_id() -> None:
    """Initial Interview boundary fails closed when no trusted authenticated principal is present."""
    mock_dispatcher = MagicMock()
    mock_api = MagicMock()
    mock_api.get_interview_worker_state.return_value = {
        "outcome": "WAITING_FOR_CUSTOMER",
        "contextRevision": 0,
        "activeQuestion": None,
    }

    boundary = InterviewGatedEngineeringAssessmentBoundary(
        config=MagicMock(),
        api_client=mock_api,
        interview_dispatcher=mock_dispatcher,
    )

    asmt_id = str(uuid4())
    report_id = "ter-init-1"
    evidence_report = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-init-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }

    with pytest.raises(ValueError, match="Initial Interview requires a trusted authenticated principal"):
        boundary._prepare_interview(
            evidence_report=evidence_report,
            evidence_report_id=report_id,
            assessment_id=asmt_id,
            correlation_id=str(uuid4()),
            workflow_run_id=str(uuid4()),
        )


def test_turn_evidence_ledger_concurrency_isolation() -> None:
    """Two concurrent turns running in separate threads observe only their own turn-scoped ledgers."""
    from concurrent.futures import ThreadPoolExecutor
    import time
    from subagents.interview.customer_safe_projection import (
        get_active_turn_evidence_ledger,
        reset_active_turn_evidence_ledger,
        set_active_turn_evidence_ledger,
    )

    ledger_a = TurnEvidenceLedger(initial_authorized_refs=["evidence:turn:A"])
    ledger_b = TurnEvidenceLedger(initial_authorized_refs=["evidence:turn:B"])

    results = {}

    def worker_a():
        token = set_active_turn_evidence_ledger(ledger_a)
        try:
            time.sleep(0.05)
            active = get_active_turn_evidence_ledger()
            results["a_sees_a"] = active.is_authorized("evidence:turn:A") if active else False
            results["a_sees_b"] = active.is_authorized("evidence:turn:B") if active else False
        finally:
            reset_active_turn_evidence_ledger(token)

    def worker_b():
        token = set_active_turn_evidence_ledger(ledger_b)
        try:
            time.sleep(0.05)
            active = get_active_turn_evidence_ledger()
            results["b_sees_b"] = active.is_authorized("evidence:turn:B") if active else False
            results["b_sees_a"] = active.is_authorized("evidence:turn:A") if active else False
        finally:
            reset_active_turn_evidence_ledger(token)

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(worker_a)
        f2 = executor.submit(worker_b)
        f1.result()
        f2.result()

    assert results["a_sees_a"] is True
    assert results["a_sees_b"] is False
    assert results["b_sees_b"] is True
    assert results["b_sees_a"] is False


def test_secrets_in_edge_attributes_are_stripped_from_traversal_tools() -> None:
    """Traversing edges with secret bearer tokens or internal debug attributes never leaks to agent."""
    asmt_id = str(uuid4())
    wf_id = str(uuid4())

    graph_with_secret_edge = _mock_graph()
    # Inject sensitive debug credentials into edge attributes
    graph_with_secret_edge["edges"] = [
        {
            "edge_id": "edge:flow-1",
            "source_node_id": "node:node-rec-101",
            "target_node_id": "node:node-dec-101",
            "source_id": "node:node-rec-101",
            "target_id": "node:node-dec-101",
            "edge_type": "CALLS",
            "resolution_state": "OBSERVED",
            "evidence_refs": ["evidence:flow:rec_to_dec"],
            "attributes": {
                "debug": "Authorization: Bearer TOP_SECRET_BEARER_TOKEN_999",
                "secret": "db_password_12345",
                "raw_source": "function evaluateLoan() { secret(); }",
            },
        }
    ]

    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": graph_with_secret_edge},
    }
    mock_api.rbac_client.check.return_value = "allow"
    set_agentic_tool_api_client(mock_api)

    run_context = LCSPRunContext(
        assessment_id=asmt_id,
        user_id="user-1",
        workflow_run_id=wf_id,
        artifact_versions={"technicalEvidenceReportId": "ter-1", "repositorySnapshotId": "snap-1"},
    )
    runtime = SimpleNamespace(context=run_context)

    try:
        # 1. inspect_data_path
        data_res = inspect_data_path.func(runtime, startRef="node:node-rec-101", maxHops=3)
        str_data = str(data_res)
        assert "TOP_SECRET" not in str_data
        assert "Bearer" not in str_data
        assert "db_password" not in str_data
        assert "attributes" not in str_data
        assert "debug" not in str_data
        assert "raw_source" not in str_data
        assert data_res["edges"][0]["source_node_id"] == "node:node-rec-101"
        assert data_res["edges"][0]["edge_type"] == "CALLS"

        # 2. inspect_decision_path
        dec_res = inspect_decision_path.func(runtime, startRef="node:node-rec-101", maxHops=3)
        str_dec = str(dec_res)
        assert "TOP_SECRET" not in str_dec
        assert "Bearer" not in str_dec
        assert "db_password" not in str_dec
        assert "attributes" not in str_dec
        assert "debug" not in str_dec

        # 3. inspect_human_review_path
        hr_res = inspect_human_review_path.func(runtime, startRef="node:node-rec-101", maxHops=3)
        str_hr = str(hr_res)
        assert "TOP_SECRET" not in str_hr
        assert "Bearer" not in str_hr
        assert "db_password" not in str_hr
        assert "attributes" not in str_hr
        assert "debug" not in str_hr
    finally:
        set_agentic_tool_api_client(None)


def test_waiting_question_requires_customer_material_frontier() -> None:
    """A WAITING_FOR_CUSTOMER outcome strictly requires frontier with owner=CUSTOMER and materiality=MATERIAL."""
    from subagents.interview.customer_safe_projection import evaluate_question_eligibility

    ledger = TurnEvidenceLedger(initial_authorized_refs=["evidence:symbol:loan_rec"])

    # 1. Missing frontier -> not a dict
    # (Checked by boundary: raises ValueError)

    # 2. CUSTOMER + MATERIAL -> ELIGIBLE
    eligible, reason = evaluate_question_eligibility(
        {"owner": "CUSTOMER", "materiality": "MATERIAL", "description": "Loan approval threshold", "evidenceRefs": ["evidence:symbol:loan_rec"]},
        ledger,
    )
    assert eligible is True
    assert reason == "ELIGIBLE"

    # 3. CUSTOMER + NON_MATERIAL -> NOT ELIGIBLE
    eligible, reason = evaluate_question_eligibility(
        {"owner": "CUSTOMER", "materiality": "NON_MATERIAL", "description": "Minor UI text", "evidenceRefs": ["evidence:symbol:loan_rec"]},
        ledger,
    )
    assert eligible is False
    assert "MATERIAL" in reason

    # 4. TECHNICAL + MATERIAL -> NOT ELIGIBLE
    eligible, reason = evaluate_question_eligibility(
        {"owner": "TECHNICAL", "materiality": "MATERIAL", "description": "Dynamic dispatcher target", "evidenceRefs": ["evidence:symbol:loan_rec"]},
        ledger,
    )
    assert eligible is False
    assert "CUSTOMER" in reason

    # 5. Missing / unknown materiality -> fails closed
    eligible, reason = evaluate_question_eligibility(
        {"owner": "CUSTOMER", "description": "Unknown materiality", "evidenceRefs": ["evidence:symbol:loan_rec"]},
        ledger,
    )
    assert eligible is False

    # 6. Unauthorized ref in frontier -> raises ValueError
    with pytest.raises(ValueError, match="unauthorized or fabricated"):
        evaluate_question_eligibility(
            {"owner": "CUSTOMER", "materiality": "MATERIAL", "description": "Fabricated ref", "evidenceRefs": ["evidence:fabricated:unknown"]},
            ledger,
        )


def test_why_are_we_asking_explanation_pipeline() -> None:
    """Verify deterministic Why explanation reflects evidence resolution and coverage states."""
    # OBSERVED
    exp_obs = build_why_are_we_asking_explanation(
        topic="loan approval overrides",
        evidence_observation="manual override capability exists in loan.ts",
        resolution_state="OBSERVED",
        coverage_state="READY",
    )
    assert "We found evidence that" in exp_obs or "We found evidence of" in exp_obs
    assert "loan approval overrides" in exp_obs

    # INFERRED
    exp_inf = build_why_are_we_asking_explanation(
        topic="supervisor sign-off",
        evidence_observation="role checks appear in workflow routing",
        resolution_state="INFERRED",
        coverage_state="READY",
    )
    assert "We found evidence suggesting that" in exp_inf
    assert "supervisor sign-off" in exp_inf

    # UNRESOLVED
    exp_unres = build_why_are_we_asking_explanation(
        topic="automatic decline rules",
        evidence_observation="rule enforcement is dynamic",
        resolution_state="UNRESOLVED",
        coverage_state="READY",
    )
    assert "The available technical evidence does not establish whether" in exp_unres
    assert "automatic decline rules" in exp_unres

    # UNAVAILABLE coverage
    exp_unavail = build_why_are_we_asking_explanation(
        topic="payment processing",
        resolution_state="UNRESOLVED",
        coverage_state="UNAVAILABLE",
    )
    assert "Technical evidence is unavailable" in exp_unavail or "not available" in exp_unavail


def test_why_explanation_default_missing_certainty_to_unresolved() -> None:
    """If resolution metadata or certainty cannot be established, fail closed to UNRESOLVED, never OBSERVED."""
    ledger = TurnEvidenceLedger(initial_authorized_refs=["evidence:ref:unknown"])
    # ledger has no metadata for "evidence:ref:unknown"
    exp = build_why_are_we_asking_explanation(
        topic="whether supervisor approval is mandatory",
        ledger=ledger,
        evidence_refs=["evidence:ref:unknown"],
    )
    assert "The available technical evidence does not establish whether" in exp
    assert "We found evidence of" not in exp
    assert "We found evidence that" not in exp


def test_why_explanation_preserves_partial_coverage_limitation() -> None:
    """When technical coverage is PARTIAL, relevant limitation is explicitly preserved in explanation."""
    ledger = TurnEvidenceLedger(initial_authorized_refs=["evidence:symbol:partial_flow"])
    ledger.record_evidence_metadata(
        "evidence:symbol:partial_flow",
        GovernedEvidenceMetadata(
            evidence_ref="evidence:symbol:partial_flow",
            resolution_state="UNRESOLVED",
            coverage_state="PARTIAL",
            coverage_limitations=["dynamic supervisor approval path could not be resolved"],
            safe_observation="supervisor check detected",
        ),
    )
    exp = build_why_are_we_asking_explanation(
        topic="whether supervisor approval is required",
        coverage_limitations=["dynamic supervisor approval path could not be resolved"],
        ledger=ledger,
        evidence_refs=["evidence:symbol:partial_flow"],
    )
    assert "The available technical evidence does not establish whether" in exp
    assert "dynamic supervisor approval path could not be resolved" in exp
    assert "We found evidence of" not in exp


def test_why_explanation_no_negative_inference_from_missing_or_partial_evidence() -> None:
    """Missing, partial, unresolved, or unavailable evidence must never be claimed as non-existent or absent."""
    for res_state in ["UNRESOLVED", "UNAVAILABLE"]:
        for cov_state in ["PARTIAL", "UNAVAILABLE"]:
            exp = build_why_are_we_asking_explanation(
                topic="fraud prevention checks",
                resolution_state=res_state,
                coverage_state=cov_state,
            )
            assert "does not exist" not in exp.lower()
            assert "is absent" not in exp.lower()
            assert "not implemented" not in exp.lower()
            assert "does not support" not in exp.lower()


def test_model_authored_why_overclaim_is_overwritten_by_runtime() -> None:
    """Model-authored unsafe Why is overwritten by runtime-controlled explanation based on ledger metadata."""
    asmt_id = str(uuid4())
    snap_id = str(uuid4())
    rep_id = str(uuid4())
    evidence_ref = "evidence:symbol:human_override"

    mock_dispatcher = MagicMock()

    def mock_dispatch(*args, **kwargs):
        # Record rich metadata in the active ledger during turn
        ledger = get_active_turn_evidence_ledger()
        if ledger:
            ledger.record_evidence_metadata(
                evidence_ref,
                GovernedEvidenceMetadata(
                    evidence_ref=evidence_ref,
                    resolution_state="UNRESOLVED",
                    coverage_state="PARTIAL",
                    coverage_limitations=("dynamic path unresolved",),
                    safe_observation="override handler exists",
                ),
            )
        return {
            "handoff": {
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "q-101",
                    "intent": "CLARIFY",
                    "control": "BOOLEAN",
                    "prompt": "Is supervisor sign-off mandatory?",
                    "whyAreWeAsking": "The code proves supervisor approval is mandatory in all cases.",
                    "frontier": {
                        "owner": "CUSTOMER",
                        "materiality": "MATERIAL",
                        "description": "Whether supervisor approval is mandatory",
                        "evidenceRefs": [evidence_ref],
                    },
                },
            }
        }

    mock_dispatcher.dispatch.side_effect = mock_dispatch

    mock_api = MagicMock()
    mock_api.get_runtime_context.return_value = {
        "assessmentId": asmt_id,
        "workflowRunId": str(uuid4()),
        "actorId": "user-123",
        "repositorySnapshotId": snap_id,
        "technicalEvidenceReportId": rep_id,
        "sourceVersion": "snap-1:sha1",
        "pgeVersion": "rep-1:v1",
        "guidanceVersion": "guidance-v1",
        "contextRevision": 1,
        "technicalCoverageState": "PARTIAL",
        "coverageLimitations": ["dynamic path unresolved"],
    }
    boundary = AssessmentInterviewResumeBoundary(
        config=MagicMock(),
        api_client=mock_api,
        dispatcher=mock_dispatcher,
    )
    context = {
        "assessmentId": asmt_id,
        "workflowRunId": str(uuid4()),
        "actorId": "user-123",
        "repositorySnapshotId": snap_id,
        "technicalEvidenceReportId": rep_id,
        "sourceVersion": "snap-1:sha1",
        "pgeVersion": "rep-1:v1",
        "guidanceVersion": "guidance-v1",
        "contextRevision": 1,
        "technicalCoverageState": "PARTIAL",
        "coverageLimitations": ["dynamic path unresolved"],
    }
    result = boundary._run_interview(
        assessment_id=asmt_id,
        thread_id=f"interview:{asmt_id}",
        question_id="q-101",
        context_revision=1,
        resume_reason="CUSTOMER_ANSWER_SUBMITTED",
        context=context,
        correlationId=str(uuid4()),
    )
    assert result["outcome"] == "WAITING_FOR_CUSTOMER"
    why = result["activeQuestion"]["whyAreWeAsking"]
    # Assert model overclaim was wiped out
    assert "The code proves supervisor approval is mandatory" not in why
    assert "The available technical evidence does not establish whether" in why


def test_turn_evidence_ledger_concurrent_metadata_isolation() -> None:
    """Ledger metadata (resolutionState, coverageState, coverageLimitations, safeObservation) remains turn-local."""
    import time
    from concurrent.futures import ThreadPoolExecutor
    from tools.common.runtime_envelope import (
        get_active_turn_evidence_ledger,
        reset_active_turn_evidence_ledger,
        set_active_turn_evidence_ledger,
    )

    ledger_a = TurnEvidenceLedger(initial_authorized_refs=["evidence:turn:A"])
    ledger_a.record_evidence_metadata(
        "evidence:turn:A",
        GovernedEvidenceMetadata(
            evidence_ref="evidence:turn:A",
            resolution_state="OBSERVED",
            coverage_state="READY",
            coverage_limitations=(),
            safe_observation="Turn A observation",
        ),
    )

    ledger_b = TurnEvidenceLedger(initial_authorized_refs=["evidence:turn:B"])
    ledger_b.record_evidence_metadata(
        "evidence:turn:B",
        GovernedEvidenceMetadata(
            evidence_ref="evidence:turn:B",
            resolution_state="UNRESOLVED",
            coverage_state="PARTIAL",
            coverage_limitations=("Turn B limitation",),
            safe_observation="Turn B observation",
        ),
    )

    results = {}

    def worker_a():
        token = set_active_turn_evidence_ledger(ledger_a)
        try:
            time.sleep(0.05)
            active = get_active_turn_evidence_ledger()
            if active:
                results["a_sees_a_ref"] = active.is_authorized("evidence:turn:A")
                results["a_sees_b_ref"] = active.is_authorized("evidence:turn:B")
                meta_a = active.get_evidence_metadata("evidence:turn:A")
                results["a_meta_a_res"] = meta_a.resolution_state if meta_a else None
                meta_b = active.get_evidence_metadata("evidence:turn:B")
                results["a_meta_b"] = meta_b is not None
                res_state, cov_state, lims, obs = active.get_aggregated_certainty(["evidence:turn:A"])
                results["a_agg_res"] = res_state
        finally:
            reset_active_turn_evidence_ledger(token)

    def worker_b():
        token = set_active_turn_evidence_ledger(ledger_b)
        try:
            time.sleep(0.05)
            active = get_active_turn_evidence_ledger()
            if active:
                results["b_sees_b_ref"] = active.is_authorized("evidence:turn:B")
                results["b_sees_a_ref"] = active.is_authorized("evidence:turn:A")
                meta_b = active.get_evidence_metadata("evidence:turn:B")
                results["b_meta_b_res"] = meta_b.resolution_state if meta_b else None
                meta_a = active.get_evidence_metadata("evidence:turn:A")
                results["b_meta_a"] = meta_a is not None
                res_state, cov_state, lims, obs = active.get_aggregated_certainty(["evidence:turn:B"])
                results["b_agg_res"] = res_state
        finally:
            reset_active_turn_evidence_ledger(token)

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(worker_a)
        f2 = executor.submit(worker_b)
        f1.result()
        f2.result()

    assert results["a_sees_a_ref"] is True
    assert results["a_sees_b_ref"] is False
    assert results["a_meta_a_res"] == "OBSERVED"
    assert results["a_meta_b"] is False
    assert results["a_agg_res"] == "OBSERVED"

    assert results["b_sees_b_ref"] is True
    assert results["b_sees_a_ref"] is False
    assert results["b_meta_b_res"] == "UNRESOLVED"
    assert results["b_meta_a"] is False
    assert results["b_agg_res"] == "UNRESOLVED"


# ============================================================================
# Group M — P0-1..P0-5 & P1 Coverage, Certainty, and Schema Mapping Regressions
# ============================================================================

def test_every_pge_tool_propagates_coverage_and_limitations() -> None:
    """All 5 Interview tools return canonical coverageState and coverageLimitations from the pinned graph."""
    graph_dict = _mock_graph()
    graph_dict["coverage_state"] = "LIMITED"
    graph_dict["coverage_notes"] = ["Partial AST index for Python runtime"]
    asmt_uuid = str(uuid4())
    report_dict = {
        "assessmentId": asmt_uuid,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": graph_dict},
    }

    mock_client = MagicMock()
    mock_client.get_accepted_technical_evidence_report.return_value = report_dict

    from tools.common.capabilities.agentic_evidence.entrypoints.program_graph_tool_entrypoints import (
        get_scan_coverage,
        inspect_data_path,
        inspect_decision_path,
        inspect_human_review_path,
        search_evidence,
    )
    from tools.common.capabilities.agentic_evidence.governance.registry import AgenticToolBudget, AgenticToolRequest

    base_req = {
        "toolName": "test",
        "requestId": str(uuid4()),
        "assessmentId": asmt_uuid,
        "workflowRunId": str(uuid4()),
        "artifactVersions": {
            "technicalEvidenceReportId": "report-1",
            "repositorySnapshotId": "snap-1",
        },
        "correlationId": str(uuid4()),
        "budget": {"maxItems": 50, "maxDepth": 5, "maxBytes": 65536, "maxDurationMs": 5000},
        "input": {"startRef": "node:n1", "query": "auth"},
    }

    class Ctx:
        api_client = mock_client

    # 1. get_scan_coverage
    cov_res = get_scan_coverage(AgenticToolRequest.model_validate(base_req), Ctx())
    assert cov_res["coverageState"] == "PARTIAL"
    assert "Partial AST index for Python runtime" in cov_res["coverageLimitations"]

    # 2. search_evidence
    search_res = search_evidence(AgenticToolRequest.model_validate(base_req), Ctx())
    assert search_res["coverageState"] == "PARTIAL"
    assert "Partial AST index for Python runtime" in search_res["coverageLimitations"]

    # 3. inspect_data_path
    data_res = inspect_data_path(AgenticToolRequest.model_validate(base_req), Ctx())
    assert data_res["coverageState"] == "PARTIAL"
    assert "Partial AST index for Python runtime" in data_res["coverageLimitations"]

    # 4. inspect_decision_path
    dec_res = inspect_decision_path(AgenticToolRequest.model_validate(base_req), Ctx())
    assert dec_res["coverageState"] == "PARTIAL"
    assert "Partial AST index for Python runtime" in dec_res["coverageLimitations"]

    # 5. inspect_human_review_path
    rev_res = inspect_human_review_path(AgenticToolRequest.model_validate(base_req), Ctx())
    assert rev_res["coverageState"] == "PARTIAL"
    assert "Partial AST index for Python runtime" in rev_res["coverageLimitations"]


def test_seeded_provenance_refs_preserve_partial_coverage_in_initial_and_resume() -> None:
    """TurnEvidenceLedger initialized with PARTIAL coverage preserves limitations when frontier cites report/snapshot."""
    report_id = "ter-partial-1"
    initial_refs = [f"technicalEvidenceReport:{report_id}", "repositorySnapshot:snap-1"]
    limitations = ["Dynamic imports unanalyzed in worker module"]

    # Initialize ledger with PARTIAL coverage from runtime/report
    ledger = TurnEvidenceLedger(
        initial_authorized_refs=initial_refs,
        initial_coverage_state="PARTIAL",
        initial_coverage_limitations=limitations,
    )

    # Assert ledger metadata retains PARTIAL and limitations
    res, cov, lims, _ = ledger.get_aggregated_certainty([f"technicalEvidenceReport:{report_id}"])
    assert cov == "PARTIAL"
    assert "Dynamic imports unanalyzed in worker module" in lims

    # Attempting to record a READY ref must NOT upgrade PARTIAL to READY
    ledger.record_metadata(
        GovernedEvidenceMetadata(
            evidence_ref=f"technicalEvidenceReport:{report_id}",
            resolution_state="OBSERVED",
            coverage_state="READY",
        )
    )
    res2, cov2, lims2, _ = ledger.get_aggregated_certainty([f"technicalEvidenceReport:{report_id}"])
    assert cov2 == "PARTIAL"
    assert "Dynamic imports unanalyzed in worker module" in lims2

    # Generating Why explanation preserves limitation
    why = build_why_are_we_asking_explanation(
        topic="dynamic import worker configuration",
        ledger=ledger,
        evidence_refs=[f"technicalEvidenceReport:{report_id}"],
    )
    assert "Dynamic imports unanalyzed in worker module" in why


def test_missing_resolution_defaults_to_unresolved_universally() -> None:
    """Missing, unknown, or malformed resolution state defaults to UNRESOLVED everywhere, never OBSERVED."""
    from tools.common.capabilities.agentic_evidence.entrypoints.program_graph_tool_entrypoints import (
        _project_safe_edge,
        _project_safe_node,
    )

    # Incomplete legacy node with no resolution_state
    raw_node = {"node_id": "n-legacy", "node_type": "SERVICE", "label": "LegacyService"}
    projected_node = _project_safe_node(raw_node)
    assert projected_node["resolution_state"] == "UNRESOLVED"

    # Node with invalid resolution_state
    raw_node_bad = {"node_id": "n-bad", "label": "BadRes", "resolution_state": "SOMETHING_RANDOM"}
    assert _project_safe_node(raw_node_bad)["resolution_state"] == "UNRESOLVED"

    # Edge with missing resolution_state
    raw_edge = {"source_node_id": "n1", "target_node_id": "n2", "edge_type": "CALLS"}
    projected_edge = _project_safe_edge(raw_edge)
    assert projected_edge["resolution_state"] == "UNRESOLVED"

    # Customer-safe evidence projection
    raw_graph = {"nodes": [raw_node], "edges": [raw_edge]}
    safe_graph = project_customer_safe_evidence(raw_graph)
    assert safe_graph["resolutionState"] == "UNRESOLVED"
    assert safe_graph["nodes"][0]["resolutionState"] == "UNRESOLVED"

    # Why explanation uses uncertainty language
    why = build_why_are_we_asking_explanation(
        topic="payment gateway routing",
        resolution_state="",  # missing resolution
    )
    assert "The available technical evidence does not establish whether" in why


def test_get_scan_coverage_strict_allowlisted_dto_and_secret_redaction() -> None:
    """get_scan_coverage strips raw scanner provenance, file paths, and secret tokens."""
    leaked_secret = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-kJ"
    leaked_db_url = "postgres://admin:supersecretpassword@10.0.0.1:5432/production"
    leaked_path = "src/internal/scanner/scanner_config.py:42"

    graph_dict = _mock_graph()
    graph_dict["coverage_notes"] = [
        f"Scanner failed on {leaked_path} with token {leaked_secret}",
        f"Database connection: {leaked_db_url}",
    ]
    graph_dict["unresolved_frontiers"] = [
        {"owner": "TECHNICAL", "materiality": "MATERIAL", "description": f"Frontier on {leaked_path}"},
        f"Raw frontier with secret {leaked_secret}",
    ]
    graph_dict["provenance"] = {
        "internal_config": "scanner_v3_internal",
        "db_secret": leaked_db_url,
        "note": f"Internal note with {leaked_secret}",
    }

    asmt_uuid = str(uuid4())
    mock_client = MagicMock()
    mock_client.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_uuid,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": graph_dict},
    }

    from tools.common.capabilities.agentic_evidence.entrypoints.program_graph_tool_entrypoints import get_scan_coverage
    from tools.common.capabilities.agentic_evidence.governance.registry import AgenticToolBudget, AgenticToolRequest

    req = AgenticToolRequest.model_validate({
        "toolName": "get_scan_coverage",
        "requestId": str(uuid4()),
        "assessmentId": asmt_uuid,
        "workflowRunId": str(uuid4()),
        "artifactVersions": {
            "technicalEvidenceReportId": "report-1",
            "repositorySnapshotId": "snap-1",
        },
        "correlationId": str(uuid4()),
        "budget": {"maxItems": 50, "maxDepth": 5, "maxBytes": 65536, "maxDurationMs": 5000},
        "input": {},
    })

    class Ctx:
        api_client = mock_client

    coverage_dto = get_scan_coverage(req, Ctx())

    # Verify strict allowlisted keys only
    allowed_keys = {"coverageState", "coverageLimitations", "unresolvedFrontiers", "nodeCount", "edgeCount", "truncated"}
    assert set(coverage_dto.keys()) == allowed_keys

    # Verify provenance dictionary is omitted
    assert "provenance" not in coverage_dto

    # Verify no secrets leak into limitations or frontiers
    dto_str = json.dumps(coverage_dto)
    assert "supersecretpassword" not in dto_str
    assert "eyJhbGciOiJIUzI1Ni" not in dto_str
    assert "src/internal/scanner" not in dto_str
    assert "[redacted secret]" in dto_str or "[redacted token]" in dto_str or "[file reference]" in dto_str or "[redacted url]" in dto_str


def test_workflow_identity_separation_in_initial_interview() -> None:
    """Initial Interview maintains strict separation: workflowRunId != correlationId != threadId."""
    report_id = "ter-init-distinct"
    mock_dispatcher = MagicMock()
    mock_dispatcher.dispatch.return_value = {
        "handoff": {
            "outcome": "WAITING_FOR_CUSTOMER",
            "activeQuestion": {
                "id": "q-distinct",
                "prompt": "Distinct IDs prompt?",
                "frontier": {
                    "owner": "CUSTOMER",
                    "materiality": "MATERIAL",
                    "description": "Distinct IDs verification",
                    "evidenceRefs": [f"technicalEvidenceReport:{report_id}"],
                },
            },
        }
    }
    mock_api = MagicMock()
    mock_api.get_interview_worker_state.return_value = {
        "outcome": "WAITING_FOR_CUSTOMER",
        "contextRevision": 0,
        "activeQuestion": None,
        "authenticatedActorId": "user-cust-456",
    }

    boundary = InterviewGatedEngineeringAssessmentBoundary(
        config=MagicMock(),
        api_client=mock_api,
        interview_dispatcher=mock_dispatcher,
    )

    asmt_id = str(uuid4())
    workflow_run_id = str(uuid4())
    correlation_id = str(uuid4())
    evidence_report = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-distinct-1",
        "sourceVersion": "snap-distinct-1:sha1",
        "pgeVersion": f"{report_id}:2.0.0",
        "guidanceVersion": "guidance-v1",
        "status": "ACCEPTED",
        "scanJobId": workflow_run_id,
        "evidence_payload": {"evidence_graph": _mock_graph()},
    }

    boundary._prepare_interview(
        evidence_report=evidence_report,
        evidence_report_id=report_id,
        assessment_id=asmt_id,
        correlation_id=correlation_id,
        workflow_run_id=workflow_run_id,
    )

    mock_dispatcher.dispatch.assert_called_once()
    call_kwargs = mock_dispatcher.dispatch.call_args.kwargs
    passed_context: LCSPRunContext = call_kwargs["context"]
    thread_id = call_kwargs["thread_id"]

    assert passed_context.workflow_run_id == workflow_run_id
    assert passed_context.workflow_run_id != correlation_id
    assert thread_id == f"interview:{asmt_id}"
    assert thread_id != workflow_run_id
    assert thread_id != correlation_id




# ============================================================================
# Final closure regressions — cross-boundary safety semantics
# ============================================================================

def test_all_interview_pge_tools_sanitize_coverage_metadata() -> None:
    """Coverage notes are safe regardless of which of the five Interview tools returns them."""
    graph_dict = _mock_graph()
    graph_dict["coverage_notes"] = [
        "src/private/config.ts Authorization: Bearer TOP_SECRET_TOKEN_123456789 postgres://u:pass@db.internal/prod"
    ]
    asmt_uuid = str(uuid4())
    client = MagicMock()
    client.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_uuid,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {"evidence_graph": graph_dict},
    }

    class Ctx:
        api_client = client

    base = {
        "toolName": "test",
        "requestId": str(uuid4()),
        "assessmentId": asmt_uuid,
        "workflowRunId": str(uuid4()),
        "artifactVersions": {
            "technicalEvidenceReportId": "report-1",
            "repositorySnapshotId": "snap-1",
        },
        "correlationId": str(uuid4()),
        "budget": {"maxItems": 20, "maxDepth": 5, "maxBytes": 65536, "maxDurationMs": 5000},
        "input": {"startRef": "node:node-rec-101", "query": "AI Loan", "maxResults": 20},
    }
    request = AgenticToolRequest.model_validate(base)
    results = [
        entry_get_scan_coverage(request, Ctx()),
        entry_search_evidence(request, Ctx()),
        entry_inspect_data_path(request, Ctx()),
        entry_inspect_decision_path(request, Ctx()),
        entry_inspect_human_review_path(request, Ctx()),
    ]
    for result in results:
        text = json.dumps(result)
        assert "TOP_SECRET_TOKEN" not in text
        assert "postgres://u:pass" not in text
        assert "src/private/config.ts" not in text
        assert "u:pass@db.internal" not in text


def test_same_ref_conflicting_resolution_merges_conservatively() -> None:
    """A later unresolved observation can never remain silently OBSERVED."""
    ledger = TurnEvidenceLedger(initial_authorized_refs=["evidence:flow:shared"])
    ledger.record_metadata(
        GovernedEvidenceMetadata(
            evidence_ref="evidence:flow:shared",
            resolution_state="OBSERVED",
            coverage_state="READY",
        )
    )
    ledger.record_metadata(
        GovernedEvidenceMetadata(
            evidence_ref="evidence:flow:shared",
            resolution_state="UNRESOLVED",
            coverage_state="PARTIAL",
            coverage_limitations=("dynamic target unresolved",),
        )
    )
    metadata = ledger.get_metadata("evidence:flow:shared")
    assert metadata is not None
    assert metadata.resolution_state == "UNRESOLVED"
    assert metadata.coverage_state == "PARTIAL"
    assert "dynamic target unresolved" in metadata.coverage_limitations


def test_removed_unsupported_tool_arguments_fail_at_model_schema() -> None:
    """Previously ignored scoped/search arguments are rejected instead of silently dropped."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SearchProgramGraphRequest.model_validate({"subjectRef": "node:node-rec-101"})
    with pytest.raises(ValidationError):
        SearchProgramGraphRequest.model_validate({"nodeTypes": ["BUSINESS_DECISION"]})
    with pytest.raises(ValidationError):
        ScanCoverageRequest.model_validate({"pathPrefixes": ["src/"]})
    with pytest.raises(ValidationError):
        ScanCoverageRequest.model_validate({"languages": ["PYTHON"]})


def test_resume_interview_never_uses_correlation_id_as_workflow_run_id() -> None:
    """Normal resume fails closed when server-owned workflowRunId is missing."""
    boundary = AssessmentInterviewResumeBoundary(
        config=MagicMock(),
        api_client=MagicMock(),
        dispatcher=MagicMock(),
    )
    with pytest.raises(ValueError, match="workflowRunId"):
        boundary._run_interview(
            assessment_id=str(uuid4()),
            thread_id="interview:assessment-test",
            question_id="q-1",
            context_revision=1,
            resume_reason="INTERVIEW_AGENT_DECISION_REQUIRED",
            context={
                "authenticatedActorId": "customer-1",
                "sourceVersion": "snap-1:abc",
                "pgeVersion": "ter-1:v1",
            },
            correlationId=str(uuid4()),
        )
