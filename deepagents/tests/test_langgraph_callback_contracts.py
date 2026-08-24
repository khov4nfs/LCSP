from __future__ import annotations

from unittest.mock import MagicMock

from tools.classification.classification.classification_boundary import ClassificationBoundary
from tools.engineer_rule.intelligence.ai_usage_flow_graph import AIUsageFlowGraph
from tools.engineer_rule.intelligence.ai_usage_flow_rule_engine import AIUsageFlowRuleEngine
from tools.common.platform.callback_schemas import ClassificationCallbackPayload
from tools.common.platform.config import WorkerConfig


def _config() -> WorkerConfig:
    return WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )


def test_ai_usage_flow_graph_maps_internal_claim_to_api_callback_contract() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_profile.return_value = {
        "id": "tp-1",
        "technical_profile_id": "tp-1",
        "assessment_id": "assessment-1",
        "evidence_report_id": "ter-1",
        "status": "accepted",
        "ai_detected": "confirmed",
        "providers": ["openai"],
        "frameworks": [],
        "input_categories": [],
        "output_categories": [],
        "coverage_limitations": [],
        "evidence_refs": ["finding-1"],
    }
    api_client.get_accepted_technical_evidence_report.return_value = {
        "id": "ter-1",
        "status": "accepted",
        "evidence_payload": {
            "ai_usage_signals": [
                {
                    "id": "finding-1",
                    "signal_type": "AI_MODEL_INVOCATION",
                    "evidence_ref": "finding-1",
                }
            ]
        },
        "privacy_flags": {
            "containsSourceCode": False,
            "secretsRedacted": True,
        },
    }
    api_client.get_wizard_profile_for_assessment.return_value = None

    result = AIUsageFlowGraph(
        api_client=api_client,
        rule_engine=AIUsageFlowRuleEngine(),
    ).run(
        message={
            "technicalProfileId": "tp-1",
            "assessmentId": "assessment-1",
            "evidenceReportId": "ter-1",
        },
        correlationId="corr-1",
    )

    assert result.callback_payload.claims
    claim = result.callback_payload.claims[0]
    assert set(claim) == {
        "claim_id",
        "claim_type",
        "confidence",
        "evidence_refs",
        "uncertainty_reason",
        "description",
        "is_material",
    }
    assert isinstance(claim["confidence"], str)
    assert isinstance(claim["is_material"], bool)
    api_client.post_ai_usage_flow_callback.assert_called_once_with(
        result.callback_payload
    )
    assert result.state.node_results[-1].node_name == "ai_usage_flow.persist"


def test_classification_boundary_loads_persisted_match_and_posts_typed_callback() -> None:
    api_client = MagicMock()
    api_client.get_legal_rule_match_by_id.return_value = {
        "id": "lrm-1",
        "legal_rule_match_id": "lrm-1",
        "verified_profile_id": "vp-1",
        "assessment_id": "assessment-1",
        "schema_version": "1.0.0",
        "status": "accepted",
        "guardrail_status": "passed",
        "matches": [
            {
                "confidence": 0.92,
                "coverage_status": "COMPLETE_CITATION",
                "citation_chunk_ids": ["chunk-1"],
            }
        ],
        "citation_allowlist": ["chunk-1"],
        "verified_profile_data": {
            "claims": [{"claim_category": "MODEL_INVOCATION"}]
        },
    }

    boundary = ClassificationBoundary(_config(), api_client=api_client)
    boundary.handle(
        {"legalRuleMatchId": "lrm-1", "assessmentId": "assessment-1"},
        correlationId="corr-2",
    )

    api_client.get_legal_rule_match_by_id.assert_called_once_with("lrm-1")
    api_client.post_classification_callback.assert_called_once()
    payload = api_client.post_classification_callback.call_args.args[0]
    assert isinstance(payload, ClassificationCallbackPayload)
    assert payload.legal_rule_match_id == "lrm-1"
    assert payload.verified_profile_id == "vp-1"
    assert payload.assessment_id == "assessment-1"
    assert payload.schema_version == "1.0.0"
    assert payload.classification_data["risk_level"] == "HIGH"
    assert payload.classification_data["citation_basis"] == ["chunk-1"]
    assert payload.guardrail_status == "PASSED"


def test_classification_boundary_does_not_start_for_blocked_legal_match_event() -> None:
    api_client = MagicMock()
    boundary = ClassificationBoundary(_config(), api_client=api_client)
    boundary.graph = MagicMock()

    boundary.handle(
        {
            "legalRuleMatchId": "lrm-blocked",
            "assessmentId": "assessment-1",
            "guardrailStatus": "blocked",
        },
        correlationId="corr-blocked",
    )

    boundary.graph.run.assert_not_called()
    api_client.get_legal_rule_match_by_id.assert_not_called()
    api_client.post_classification_callback.assert_not_called()
