from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from tools.classification.classification.classification_boundary import ClassificationBoundary
from tools.engineer_rule.intelligence.ai_usage_flow_boundary import AIUsageFlowBoundary
from tools.common.platform.config import WorkerConfig


def _config() -> WorkerConfig:
    return WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )


def _technical_profile() -> dict:
    return {
        "id": "tp-smoke-1",
        "technical_profile_id": "tp-smoke-1",
        "assessment_id": "assessment-smoke-1",
        "organization_id": "org-1",
        "evidence_report_id": "ter-smoke-1",
        "status": "accepted",
        "schema_version": "1.0.0",
        "provider_version": "lcsp.technical-profile-worker.v1",
        "ai_detected": "confirmed",
        "providers": ["openai"],
        "frameworks": [],
        "model_invocation_count": 1,
        "input_categories": ["personal_data"],
        "output_categories": ["score"],
        "decision_flow_signals": [],
        "human_review_signals": [],
        "coverage_limitations": [],
        "confidence": 0.86,
        "evidence_refs": ["finding-invocation"],
        "privacy_flags": {"containsSourceCode": False, "secretsRedacted": True},
    }


def _evidence_report() -> dict:
    return {
        "id": "ter-smoke-1",
        "status": "accepted",
        "assessment_id": "assessment-smoke-1",
        "organization_id": "org-1",
        "evidence_payload": {
            "ai_usage_signals": [
                {
                    "id": "finding-invocation",
                    "signal_type": "AI_MODEL_INVOCATION",
                    "rule_id": "lcsp.model-call",
                    "evidence_ref": "finding-invocation",
                }
            ],
            "coverage_notes": [],
        },
        "privacy_flags": {"containsSourceCode": False, "secretsRedacted": True},
    }


def _wizard_profile() -> dict:
    return {
        "id": "wizard-smoke-1",
        "answers": {
            "businessProcess": "loan_approval",
            "aiPurpose": "credit_scoring_decision_support",
            "humanReview": "present",
            "affectedSubjects": ["loan_applicant"],
            "dataTypes": ["personal_data"],
        },
    }


@pytest.mark.integration
@pytest.mark.e2e
def test_ai_usage_flow_handle_smoke_e2e_runs_graph_and_submits_callback() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_profile.return_value = _technical_profile()
    api_client.get_accepted_technical_evidence_report.return_value = _evidence_report()
    api_client.get_wizard_profile_for_assessment.return_value = _wizard_profile()

    llm_client = MagicMock()
    llm_response = MagicMock()
    llm_response.structured_response = {
        "summary_updates": {
            "businessProcess": "loan_approval",
            "aiPurpose": "credit_scoring_decision_support",
            "affectedSubjects": ["loan_applicant"],
            "humanReview": "present",
        }
    }
    llm_response.request_id = "req-smoke-ai-1"
    llm_client.complete_structured.return_value = llm_response

    boundary = AIUsageFlowBoundary(
        _config(),
        api_client=api_client,
        llm_client=llm_client,
    )

    boundary.handle(
        {
            "technicalProfileId": "tp-smoke-1",
            "assessmentId": "assessment-smoke-1",
            "evidenceReportId": "ter-smoke-1",
        },
        correlationId="corr-smoke-ai-1",
    )

    api_client.post_ai_usage_flow_callback.assert_called_once()
    callback_payload = api_client.post_ai_usage_flow_callback.call_args.args[0]
    assert callback_payload.technical_profile_id == "tp-smoke-1"
    assert callback_payload.assessment_id == "assessment-smoke-1"
    assert callback_payload.flow_data["summary"]["businessProcess"] == "loan_approval"
    assert callback_payload.privacy_flags["containsSourceCode"] is False

    llm_kwargs = llm_client.complete_structured.call_args.kwargs
    assert llm_kwargs["workflow_run_id"] == "ai-usage-flow:tp-smoke-1:corr-smoke-ai-1"
    assert llm_kwargs["node_name"] == "ai_usage_flow.summary_proposal"


@pytest.mark.integration
@pytest.mark.e2e
def test_classification_handle_smoke_e2e_runs_graph_and_submits_callback() -> None:
    llm_client = MagicMock()
    proposal_response = MagicMock()
    proposal_response.structured_response = {
        "risk_level": "HIGH",
        "applicability_assessment": "applicable",
        "rationale": "This assessment is high risk based on the cited evidence.",
    }
    proposal_response.request_id = "req-smoke-classification-1"
    llm_client.complete_structured.return_value = proposal_response

    boundary = ClassificationBoundary(config=MagicMock(), llm_client=llm_client)

    with patch.object(boundary, "_submit_callback") as mock_submit:
        boundary.handle(
            {
                "assessment_id": "assessment-smoke-2",
                "classification_version": "2.1",
                "usage_claims": [{"claim_category": "MODEL_INVOCATION"}],
                "applicable_rules": [
                    {
                        "confidence": 0.92,
                        "coverage_status": "COMPLETE_CITATION",
                        "citation_chunk_ids": ["ref-smoke-1"],
                    }
                ],
                "citation_allowlist": ["ref-smoke-1"],
            },
            correlationId="corr-smoke-classification-1",
        )

    mock_submit.assert_called_once()
    callback_payload = mock_submit.call_args.args[0]
    assert callback_payload["risk_level"] == "HIGH"
    assert callback_payload["applicability_assessment"] == "applicable"
    assert callback_payload["guardrail_status"] == "passed"
    assert (
        callback_payload["rationale"]
        == "This assessment is high risk based on the cited evidence."
    )

    llm_calls = llm_client.complete_structured.call_args_list
    assert len(llm_calls) == 1
    llm_kwargs = llm_calls[0].kwargs
    assert (
        llm_kwargs["workflow_run_id"]
        == "classification:assessment-smoke-2:2.1:corr-smoke-classification-1"
    )
    assert llm_kwargs["node_name"] == "classification.proposal"
