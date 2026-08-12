from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from lcsp_workers.intelligence.verified_profile_builder import VerifiedProfileBuilder
from lcsp_workers.intelligence.verified_profile_consumer import (
    PendingConflictsExist,
    VerifiedProfileConsumer,
)
from lcsp_workers.platform.api_client import WorkerCallbackError
from lcsp_workers.platform.callback_schemas import VerifiedProfileCallbackPayload
from lcsp_workers.platform.config import WorkerConfig


def _config() -> WorkerConfig:
    return WorkerConfig(
        rabbitmq_url="amqp://guest:guest@localhost/",
        rabbitmq_exchange="test.events",
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )


def _claim(**overrides: object) -> dict:
    claim = {
        "claim_id": "claim-model",
        "ai_usage_flow_id": "auf-1",
        "claim_category": "MODEL_INVOCATION",
        "claim_field": "model_invocation",
        "claim_value": {"invocationDetected": True},
        "lifecycle_state": "VALIDATED",
        "evidence_refs": ["finding-invocation"],
        "confidence": 0.91,
        "is_material": True,
    }
    claim.update(overrides)
    return claim


def _ai_usage_flow(*, claims: list[dict] | None = None, **overrides: object) -> dict:
    flow = {
        "id": "auf-1",
        "ai_usage_flow_id": "auf-1",
        "assessment_id": "assessment-1",
        "organization_id": "org-1",
        "status": "ready",
        "schema_version": "1.0.0",
        "provider_version": "lcsp.ai-usage-flow-worker.v1",
        "verification_source": "TECHNICAL_PLUS_WIZARD",
        "claims": claims if claims is not None else [_claim()],
    }
    flow.update(overrides)
    return flow


def _wizard_profile(**answers: object) -> dict:
    return {
        "id": "wizard-1",
        "assessment_id": "assessment-1",
        "version": "wizard-v1",
        "answers": {
            "businessProcess": "loan_approval",
            "aiPurpose": "credit_scoring_decision_support",
            "humanReview": "present",
            **answers,
        },
    }


def _conflict_record(**overrides: object) -> dict:
    conflict = {
        "conflict_id": "conflict-1",
        "conflict_type": "evidence_contradiction",
        "affected_claim_id": "claim-model",
        "affected_claim_field": "model_invocation",
        "status": "RESOLVED",
        "resolution": "ACCEPT_TECHNICAL_EVIDENCE",
        "resolution_note": "manager private note must not be copied verbatim",
        "resolved_at": "2026-07-25T09:20:00Z",
        "evidence_refs": ["finding-invocation"],
    }
    conflict.update(overrides)
    return conflict


@pytest.mark.p0
def test_t01_all_conflicts_resolved_submits_verified_profile() -> None:
    api_client = MagicMock()
    api_client.get_verified_profile_reconciliation_context.return_value = {
        "ai_usage_flow": _ai_usage_flow(),
        "conflicts": [_conflict_record()],
        "wizard_profile": _wizard_profile(),
        "technical_evidence_report_id": "report-1",
    }
    consumer = VerifiedProfileConsumer(_config(), api_client=api_client)

    consumer.handle(
        {
            "assessmentId": "assessment-1",
            "aiUsageFlowId": "auf-1",
            "conflictsResolvedAt": "2026-07-25T09:30:00Z",
        },
        correlation_id="corr-1",
    )

    api_client.get_verified_profile_reconciliation_context.assert_called_once_with(
        "assessment-1",
        "auf-1",
    )
    api_client.post_verified_profile_callback.assert_called_once()
    payload = api_client.post_verified_profile_callback.call_args.args[0]
    assert isinstance(payload, VerifiedProfileCallbackPayload)
    assert payload.ai_usage_flow_id == "auf-1"
    assert payload.assessment_id == "assessment-1"
    assert payload.wizard_profile_id == "wizard-1"
    assert payload.technical_evidence_report_id == "report-1"
    assert payload.reconciliation_decision_refs == ["reconciliation:conflict-1"]
    assert payload.idempotency_key is not None
    assert payload.gates_passed_at == {
        "conflicts_resolved": "2026-07-25T09:30:00Z"
    }
    assert payload.profile_data["evidence_chain_integrity"] is True
    assert payload.profile_data["merged_profile"]["invocationDetected"] is True
    assert payload.profile_data["fact_evidence_refs"]["invocationDetected"] == [
        "finding-invocation"
    ]
    assert payload.profile_data["evidence_refs"] == ["finding-invocation"]


@pytest.mark.p0
def test_t02_pending_conflicts_signal_is_requeued() -> None:
    api_client = MagicMock()
    api_client.get_verified_profile_reconciliation_context.return_value = {
        "ai_usage_flow": _ai_usage_flow(),
        "conflicts": [_conflict_record()],
        "wizard_profile": _wizard_profile(),
        "technical_evidence_report_id": "report-1",
    }
    api_client.post_verified_profile_callback.side_effect = WorkerCallbackError(
        "PENDING_CONFLICTS_EXIST"
    )
    consumer = VerifiedProfileConsumer(_config(), api_client=api_client)

    with pytest.raises(PendingConflictsExist):
        consumer.handle(
            {
                "assessmentId": "assessment-1",
                "conflictsResolvedAt": "2026-07-25T09:30:00Z",
            },
            correlation_id="corr-1",
        )


@pytest.mark.p0
def test_t03_material_claims_missing_evidence_refs_fail_integrity_flag() -> None:
    profile = VerifiedProfileBuilder().build(
        ai_usage_flow=_ai_usage_flow(
            claims=[_claim(evidence_refs=[], lifecycle_state="VALIDATED")]
        ),
        conflict_records=[],
        wizard_profile=None,
        conflicts_resolved_at="2026-07-25T09:30:00Z",
    )

    assert profile.evidence_chain_integrity is False
    assert profile.verified_claims[0]["evidence_refs"] == []
    assert profile.fact_evidence_refs == {}


@pytest.mark.p0
def test_t04_builder_adds_no_new_claims() -> None:
    claims = [
        _claim(claim_id="claim-model"),
        _claim(
            claim_id="claim-provider",
            claim_category="MODEL_PROVIDER_USAGE",
            claim_field="provider_usage",
        ),
    ]

    profile = VerifiedProfileBuilder().build(
        ai_usage_flow=_ai_usage_flow(claims=claims),
        conflict_records=[_conflict_record()],
        wizard_profile=_wizard_profile(),
        conflicts_resolved_at="2026-07-25T09:30:00Z",
    )

    assert [claim["claim_id"] for claim in profile.verified_claims] == [
        "claim-model",
        "claim-provider",
    ]
    assert profile.verified_claims == claims


@pytest.mark.p0
def test_legal_fact_evidence_requires_validated_claim_at_material_threshold() -> None:
    profile = VerifiedProfileBuilder().build(
        ai_usage_flow=_ai_usage_flow(
            claims=[
                _claim(
                    claim_id="claim-automation",
                    claim_field="automation_level",
                    claim_value={"automationLevel": "FULLY_AUTOMATED"},
                    confidence=0.91,
                    evidence_refs=["ev-automation"],
                ),
                _claim(
                    claim_id="claim-label",
                    claim_category="CONTENT_LABELING",
                    claim_field="content_labeling",
                    claim_value={"contentLabelingStatus": "ABSENT"},
                    confidence=0.70,
                    evidence_refs=["ev-label"],
                ),
            ]
        ),
        conflict_records=[],
        wizard_profile=None,
        conflicts_resolved_at="2026-07-25T09:30:00Z",
    )

    # Reconciled facts remain visible, but only >= 0.75 evidence-backed material
    # claims may become required-fact backing for legal matching.
    assert profile.merged_profile["automationLevel"] == "FULLY_AUTOMATED"
    assert profile.merged_profile["contentLabelingStatus"] == "ABSENT"
    assert profile.fact_evidence_refs == {
        "automationLevel": ["ev-automation"],
    }
    assert profile.evidence_refs == ["ev-automation"]


@pytest.mark.p0
def test_legal_fact_evidence_excludes_conflicted_claim() -> None:
    profile = VerifiedProfileBuilder().build(
        ai_usage_flow=_ai_usage_flow(
            claims=[
                _claim(
                    claim_value={"automationLevel": "FULLY_AUTOMATED"},
                    confidence=0.91,
                    evidence_refs=["ev-automation"],
                    conflict_refs=["conflict-1"],
                )
            ]
        ),
        conflict_records=[],
        wizard_profile=None,
        conflicts_resolved_at="2026-07-25T09:30:00Z",
    )

    assert profile.merged_profile["automationLevel"] == "FULLY_AUTOMATED"
    assert profile.fact_evidence_refs == {}


@pytest.mark.p0
def test_legal_fact_evidence_excludes_non_material_claim() -> None:
    profile = VerifiedProfileBuilder().build(
        ai_usage_flow=_ai_usage_flow(
            claims=[
                _claim(
                    claim_value={"automationLevel": "FULLY_AUTOMATED"},
                    confidence=0.95,
                    evidence_refs=["ev-automation"],
                    is_material=False,
                )
            ]
        ),
        conflict_records=[],
        wizard_profile=None,
        conflicts_resolved_at="2026-07-25T09:30:00Z",
    )

    assert profile.merged_profile["automationLevel"] == "FULLY_AUTOMATED"
    assert profile.fact_evidence_refs == {}
    assert profile.evidence_refs == []


@pytest.mark.p0
def test_conflict_resolution_summaries_do_not_copy_manager_notes() -> None:
    profile = VerifiedProfileBuilder().build(
        ai_usage_flow=_ai_usage_flow(),
        conflict_records=[_conflict_record()],
        wizard_profile=_wizard_profile(),
        conflicts_resolved_at="2026-07-25T09:30:00Z",
    )

    resolution = profile.conflict_resolutions[0]

    assert resolution["conflict_id"] == "conflict-1"
    assert resolution["resolution"] == "ACCEPT_TECHNICAL_EVIDENCE"
    assert "resolution_note" not in resolution
    assert "manager private note" not in str(profile.to_dict())


@pytest.mark.p0
def test_technical_only_has_no_wizard_context_or_conflict_resolutions() -> None:
    profile = VerifiedProfileBuilder().build(
        ai_usage_flow=_ai_usage_flow(
            verification_source="TECHNICAL_ONLY",
            claims=[_claim()],
        ),
        conflict_records=[],
        wizard_profile=_wizard_profile(),
        conflicts_resolved_at="2026-07-25T09:30:00Z",
    )

    assert profile.verification_source == "TECHNICAL_ONLY"
    assert profile.wizard_context is None
    assert profile.conflict_resolutions == []


@pytest.mark.p0
def test_t05_builder_makes_no_network_or_llm_calls() -> None:
    with patch("httpx.post") as http_post, patch("httpx.get") as http_get:
        VerifiedProfileBuilder().build(
            ai_usage_flow=_ai_usage_flow(),
            conflict_records=[],
            wizard_profile=None,
            conflicts_resolved_at="2026-07-25T09:30:00Z",
        )

    http_post.assert_not_called()
    http_get.assert_not_called()
