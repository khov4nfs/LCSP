from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from tools.common.capabilities.assessment.claims.conflict_detection.conflict_detection_boundary import (
    ConflictDetectionBoundary,
)
from tools.common.capabilities.assessment.claims.conflict_detection.conflict_detector import ConflictDetector
from tools.common.capabilities.assessment.claims.conflict_detection.conflict_score_calculator import (
    ConflictScoreCalculator,
)
from tools.common.capabilities.platform.callback_schemas import ConflictDetectionCallbackPayload
from tools.common.capabilities.platform.config import WorkerConfig


def _config() -> WorkerConfig:
    return WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )


def _claim(**overrides: object) -> dict:
    claim = {
        "claim_id": "claim-1",
        "claim_category": "MODEL_INVOCATION",
        "claim_field": "model_invocation",
        "claim_value": {"invocationDetected": True},
        "lifecycle_state": "VALIDATED",
        "evidence_refs": ["finding-invocation"],
        "confidence": 0.9,
    }
    claim.update(overrides)
    return claim


def _ai_usage_flow(*, claims: list[dict] | None = None, **overrides: object) -> dict:
    flow = {
        "id": "auf-1",
        "ai_usage_flow_id": "auf-1",
        "assessment_id": "assessment-1",
        "status": "ready",
        "schema_version": "1.0.0",
        "provider_version": "lcsp.ai-usage-flow-worker.v1",
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
            "external_llm_usage": True,
            "decision_role": "human_decision_support",
            **answers,
        },
    }


@pytest.mark.p0
def test_t01_external_llm_mismatch_creates_evidence_contradiction() -> None:
    conflicts = ConflictDetector().detect(
        ai_usage_flow=_ai_usage_flow(),
        wizard_profile=_wizard_profile(external_llm_usage=False),
    )

    assert [conflict.conflict_type for conflict in conflicts] == [
        "evidence_contradiction"
    ]
    assert conflicts[0].conflict_score == 1.0
    assert conflicts[0].evidence_refs == ["finding-invocation"]
    assert conflicts[0].conflicting_source_refs["wizard_answer"] == (
        "answers.external_llm_usage"
    )
    assert conflicts[0].explanation_basis["affected_field"] == "model_invocation"
    assert conflicts[0].explanation_basis["source_values"] == {
        "manager_answer": "No external AI use",
        "technical_evidence": "External model invocation detected",
    }
    assert "legal risk" in conflicts[0].explanation_basis["score_priority_explanation"]


@pytest.mark.p0
def test_t02_agent_pattern_vs_no_autonomous_decision_creates_scope_mismatch() -> None:
    conflicts = ConflictDetector().detect(
        ai_usage_flow=_ai_usage_flow(
            claims=[
                _claim(
                    claim_id="claim-agent",
                    claim_category="AGENT_PATTERN",
                    claim_field="agent_pattern",
                    claim_value={"agentPattern": True},
                    evidence_refs=["finding-agent"],
                    confidence=0.86,
                )
            ]
        ),
        wizard_profile=_wizard_profile(decision_role="no_autonomous_decision"),
    )

    assert [conflict.conflict_type for conflict in conflicts] == ["scope_mismatch"]
    assert conflicts[0].conflict_score == 0.3
    assert conflicts[0].affected_claim_field == "agent_pattern"


@pytest.mark.p0
def test_t03_high_confidence_low_coverage_claim_creates_unverifiable() -> None:
    conflicts = ConflictDetector().detect(
        ai_usage_flow=_ai_usage_flow(
            claims=[
                _claim(
                    claim_id="claim-low-coverage",
                    evidence_refs=["finding-low"],
                    evidence_ref_details=[
                        {"evidence_ref": "finding-low", "coverage": "low"}
                    ],
                    confidence=0.91,
                )
            ]
        ),
        wizard_profile=_wizard_profile(),
    )

    assert [conflict.conflict_type for conflict in conflicts] == ["unverifiable"]
    assert 0.0 <= conflicts[0].conflict_score <= 1.0
    assert conflicts[0].contradiction_severity == "partial"
    assert (
        conflicts[0].explanation_basis["evidence_context"][0][
            "coverage_limitations"
        ]
        == "Evidence coverage is limited and needs Manager review before the claim is treated as settled."
    )


@pytest.mark.p0
def test_t04_no_conflicts_is_explicit_empty_callback_payload() -> None:
    payload = ConflictDetector().to_callback_payload(
        ai_usage_flow=_ai_usage_flow(
            claims=[
                _claim(
                    claim_value={"invocationDetected": False},
                    claim_category="CONTENT_LABELING",
                    claim_field="content_labeling",
                    confidence=0.62,
                )
            ]
        ),
        wizard_profile=_wizard_profile(external_llm_usage=True),
    )

    callback_payload = ConflictDetectionCallbackPayload(**payload)

    assert callback_payload.conflicts == []
    assert "conflicts" in callback_payload.model_dump()


@pytest.mark.p0
def test_t05_conflict_score_is_bounded_between_zero_and_one() -> None:
    calculator = ConflictScoreCalculator()

    assert calculator.calculate(
        evidence_confidence="high",
        contradiction_severity="direct",
    ) == 1.0
    assert calculator.calculate(
        evidence_confidence="unknown",
        contradiction_severity="scope_only",
        normalization_factor=0.1,
    ) == 0.6
    assert 0.0 <= calculator.calculate(
        evidence_confidence="low",
        contradiction_severity="partial",
    ) <= 1.0


@pytest.mark.p0
def test_t06_detector_makes_no_network_or_llm_calls() -> None:
    with patch("httpx.post") as http_post, patch("httpx.get") as http_get:
        ConflictDetector().detect(
            ai_usage_flow=_ai_usage_flow(),
            wizard_profile=_wizard_profile(external_llm_usage=False),
        )

    http_post.assert_not_called()
    http_get.assert_not_called()


@pytest.mark.p0
def test_t07_score_explanation_uses_business_language() -> None:
    conflict = ConflictDetector().detect(
        ai_usage_flow=_ai_usage_flow(),
        wizard_profile=_wizard_profile(external_llm_usage=False),
    )[0]

    explanation = conflict.score_explanation.lower()

    assert "manager answer" in explanation
    assert "review is needed" in explanation
    assert "function" not in explanation
    assert "class" not in explanation
    assert "method" not in explanation


@pytest.mark.p0
def test_consumer_fetches_ai_usage_flow_and_wizard_profile_then_posts_callback() -> None:
    api_client = MagicMock()
    api_client.get_accepted_ai_usage_flow.return_value = _ai_usage_flow()
    api_client.get_wizard_profile_for_assessment.return_value = _wizard_profile(
        external_llm_usage=False
    )
    boundary = ConflictDetectionBoundary(_config(), api_client=api_client)

    boundary.handle(
        {"aiUsageFlowId": "auf-1", "assessmentId": "assessment-1"},
        correlationId="corr-1",
    )

    api_client.get_accepted_ai_usage_flow.assert_called_once_with("auf-1")
    api_client.get_wizard_profile_for_assessment.assert_called_once_with(
        "assessment-1"
    )
    api_client.post_reconciliation_conflict_callback.assert_called_once()
    payload = api_client.post_reconciliation_conflict_callback.call_args.args[0]
    assert isinstance(payload, ConflictDetectionCallbackPayload)
    assert payload.ai_usage_flow_id == "auf-1"
    assert payload.conflicts[0]["conflict_type"] == "evidence_contradiction"
