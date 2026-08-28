from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from langchain.messages import AIMessage

from tools.common.capabilities.assessment.claims.ai_usage_flow.ai_usage_flow_boundary import AIUsageFlowBoundary
from tools.common.capabilities.platform.config import WorkerConfig


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

    proposal_agent = MagicMock()
    proposal_agent.invoke.return_value = {
        "messages": [AIMessage(content="")],
        "structured_response": {
            "summary_updates": {
                "businessProcess": "loan_approval",
                "aiPurpose": "credit_scoring_decision_support",
                "affectedSubjects": ["loan_applicant"],
                "humanReview": "present",
            }
        },
    }

    boundary = AIUsageFlowBoundary(_config(), api_client=api_client)

    with patch(
        "tools.common.capabilities.assessment.claims.ai_usage_flow.ai_usage_flow_proposer.create_agent",
        return_value=proposal_agent,
    ):
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

    invoke_kwargs = proposal_agent.invoke.call_args.kwargs
    assert invoke_kwargs["config"]["metadata"]["workflow_run_id"] == "ai-usage-flow:tp-smoke-1:corr-smoke-ai-1"
    assert invoke_kwargs["config"]["metadata"]["node_name"] == "ai_usage_flow.summary_proposal"

    proposal_agent.invoke.assert_called_once()
    llm_kwargs = proposal_agent.invoke.call_args.kwargs["config"]
    assert (
        llm_kwargs["metadata"]["workflow_run_id"]
        == "ai-usage-flow:tp-smoke-1:corr-smoke-ai-1"
    )
    assert llm_kwargs["metadata"]["node_name"] == "ai_usage_flow.summary_proposal"
