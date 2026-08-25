from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from tools.common.capabilities.assessment.claims.ai_usage_flow.ai_usage_flow_boundary import AIUsageFlowBoundary
from tools.common.capabilities.assessment.claims.ai_usage_flow.ai_usage_flow_graph import AIUsageFlowGraph
from tools.common.capabilities.assessment.claims.ai_usage_flow.ai_usage_flow_rule_engine import (
    AIUsageFlowRuleEngine,
    PrivacyAssertionError,
)
from tools.common.capabilities.assessment.claims.ai_usage_flow.confidence_calculator import (
    CLAIM_CATEGORY_BASE,
    calculate_claim_confidence,
)
from tools.common.capabilities.platform.callback_schemas import AIUsageFlowCallbackPayload
from tools.common.capabilities.platform.config import WorkerConfig


def _config() -> WorkerConfig:
    return WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )


def _technical_profile(**overrides: object) -> dict:
    profile = {
        "id": "tp-1",
        "technical_profile_id": "tp-1",
        "assessment_id": "assessment-1",
        "organization_id": "org-1",
        "evidence_report_id": "ter-1",
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
    profile.update(overrides)
    return profile


def _evidence_report(*, findings: list[dict] | None = None) -> dict:
    return {
        "id": "ter-1",
        "status": "accepted",
        "assessment_id": "assessment-1",
        "organization_id": "org-1",
        "evidence_payload": {
            "ai_usage_signals": findings
            if findings is not None
            else [
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


def _wizard_profile(**answers: object) -> dict:
    return {
        "id": "wizard-1",
        "answers": {
            "businessProcess": "loan_approval",
            "aiPurpose": "credit_scoring_decision_support",
            "humanReview": "present",
            "affectedSubjects": ["loan_applicant"],
            "dataTypes": ["personal_data"],
            **answers,
        },
    }


@pytest.mark.p0
def test_t01_model_invocation_finding_creates_validated_claim_with_formula() -> None:
    flow = AIUsageFlowRuleEngine(provider_version="test-worker").generate(
        technical_profile=_technical_profile(),
        evidence_report=_evidence_report(),
        wizard_profile=None,
    )

    claim = next(
        claim for claim in flow.claims if claim.claim_category == "MODEL_INVOCATION"
    )
    expected_confidence, expected_breakdown = calculate_claim_confidence(
        "MODEL_INVOCATION",
        required_evidence_present=True,
        optional_signal_count=1,
        material_coverage_limitations=0,
        has_wizard_conflict=False,
        missing_required_evidence_class=False,
    )

    assert claim.lifecycle_state == "VALIDATED"
    assert claim.evidence_refs == ["finding-invocation"]
    assert claim.confidence == expected_confidence
    assert claim.confidence_breakdown == expected_breakdown


@pytest.mark.p0
def test_t02_provider_only_signal_does_not_create_material_invocation() -> None:
    flow = AIUsageFlowRuleEngine().generate(
        technical_profile=_technical_profile(
            ai_detected="possible",
            model_invocation_count=0,
            evidence_refs=["finding-provider"],
        ),
        evidence_report=_evidence_report(
            findings=[
                {
                    "id": "finding-provider",
                    "signal_type": "AI_PROVIDER_USAGE",
                    "rule_id": "lcsp.openai-client",
                    "evidence_ref": "finding-provider",
                }
            ]
        ),
        wizard_profile=None,
    )

    provider_claim = next(
        claim for claim in flow.claims if claim.claim_category == "MODEL_PROVIDER_USAGE"
    )

    assert provider_claim.lifecycle_state == "DETECTED"
    assert all(claim.claim_category != "MODEL_INVOCATION" for claim in flow.claims)
    assert "PROVIDER_ONLY_SIGNAL" in flow.uncertainty_reasons


@pytest.mark.p0
def test_t03_missing_wizard_profile_sets_technical_only_not_blocked() -> None:
    flow = AIUsageFlowRuleEngine().generate(
        technical_profile=_technical_profile(),
        evidence_report=_evidence_report(),
        wizard_profile=None,
    )

    assert flow.verification_source == "TECHNICAL_ONLY"
    assert flow.status != "BLOCKED"


@pytest.mark.p0
def test_t04_wizard_no_ai_conflicts_with_confirmed_invocation() -> None:
    flow = AIUsageFlowRuleEngine().generate(
        technical_profile=_technical_profile(ai_detected="confirmed"),
        evidence_report=_evidence_report(),
        wizard_profile=_wizard_profile(aiUse=False),
    )

    conflicts = [
        conflict["conflict_type"] for conflict in flow.conflict_candidates
    ]
    claim = next(
        claim for claim in flow.claims if claim.claim_category == "MODEL_INVOCATION"
    )

    assert "WIZARD_NO_AI_BUT_INVOCATION_EXISTS" in conflicts
    assert claim.lifecycle_state == "CONFLICTED"


@pytest.mark.p0
def test_t05_synthetic_output_without_labeling_marks_absent() -> None:
    flow = AIUsageFlowRuleEngine().generate(
        technical_profile=_technical_profile(output_categories=["image"]),
        evidence_report=_evidence_report(
            findings=[
                {
                    "id": "finding-output",
                    "signal_type": "AI_OUTPUT_SIGNAL",
                    "output_category": "image",
                    "path_resolved": True,
                    "evidence_ref": "finding-output",
                }
            ]
        ),
        wizard_profile=None,
    )

    claim = next(
        claim for claim in flow.claims if claim.claim_category == "CONTENT_LABELING"
    )

    assert claim.claim_value == {"contentLabelingStatus": "ABSENT"}
    assert flow.summary["contentLabelingStatus"] == "ABSENT"


@pytest.mark.p0
def test_t06_raw_source_content_blocks_generation() -> None:
    with pytest.raises(PrivacyAssertionError):
        AIUsageFlowRuleEngine().generate(
            technical_profile=_technical_profile(),
            evidence_report=_evidence_report(
                findings=[
                    {
                        "id": "finding-source",
                        "signal_type": "AI_MODEL_INVOCATION",
                        "message": "def call_model():\n    return client.chat()",
                        "evidence_ref": "finding-source",
                    }
                ]
            ),
            wizard_profile=None,
        )


@pytest.mark.p0
def test_t07_confidence_uses_exact_base_score_table_not_llm() -> None:
    assert CLAIM_CATEGORY_BASE["MODEL_INVOCATION"] == 0.70
    confidence, breakdown = calculate_claim_confidence(
        "MODEL_INVOCATION",
        required_evidence_present=True,
        optional_signal_count=1,
        material_coverage_limitations=1,
        has_wizard_conflict=True,
        missing_required_evidence_class=False,
    )

    assert confidence == 0.5
    assert breakdown == {
        "base": 0.70,
        "D": 0.10,
        "O": 0.05,
        "C": 0.15,
        "K": 0.20,
        "M": 0.0,
    }


@pytest.mark.p0
def test_t08_missing_technical_profile_blocks_generation() -> None:
    flow = AIUsageFlowRuleEngine().generate(
        technical_profile=None,
        evidence_report=_evidence_report(),
        wizard_profile=None,
    )

    assert flow.status == "BLOCKED"
    assert "MISSING_TECHNICAL_PROFILE" in flow.uncertainty_reasons


@pytest.mark.p0
def test_t09_material_claim_missing_evidence_refs_is_rejected() -> None:
    flow = AIUsageFlowRuleEngine().generate(
        technical_profile=_technical_profile(evidence_refs=[]),
        evidence_report=_evidence_report(
            findings=[
                {
                    "id": "finding-no-ref",
                    "signal_type": "AI_MODEL_INVOCATION",
                    "rule_id": "lcsp.model-call",
                }
            ]
        ),
        wizard_profile=None,
    )

    claim = next(
        claim for claim in flow.claims if claim.claim_category == "MODEL_INVOCATION"
    )
    assert claim.lifecycle_state == "REJECTED"
    assert "MISSING_EVIDENCE_REF" in claim.uncertainty_reasons


@pytest.mark.p0
def test_t10_coverage_limitations_are_preserved() -> None:
    flow = AIUsageFlowRuleEngine().generate(
        technical_profile=_technical_profile(
            coverage_limitations=["dynamic output-to-action path"]
        ),
        evidence_report=_evidence_report(),
        wizard_profile=None,
    )

    assert flow.coverage_limitations == ["dynamic output-to-action path"]
    assert "dynamic output-to-action path" in flow.uncertainty_reasons


@pytest.mark.p0
def test_consumer_fetches_inputs_and_posts_callback() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_profile.return_value = _technical_profile()
    api_client.get_accepted_technical_evidence_report.return_value = _evidence_report()
    api_client.get_wizard_profile_for_assessment.return_value = None
    boundary = AIUsageFlowBoundary(_config(), api_client=api_client)

    boundary.handle(
        {
            "technicalProfileId": "tp-1",
            "assessmentId": "assessment-1",
            "evidenceReportId": "ter-1",
        },
        correlationId="corr-1",
    )

    api_client.get_accepted_technical_profile.assert_called_once_with("tp-1")
    api_client.get_accepted_technical_evidence_report.assert_called_once_with("ter-1")
    api_client.get_wizard_profile_for_assessment.assert_called_once_with("assessment-1")
    api_client.post_ai_usage_flow_callback.assert_called_once()
    payload = api_client.post_ai_usage_flow_callback.call_args.args[0]
    assert isinstance(payload, AIUsageFlowCallbackPayload)
    assert payload.technical_profile_id == "tp-1"
    assert payload.privacy_flags["containsSourceCode"] is False


@pytest.mark.p0
def test_rule_engine_makes_no_network_or_llm_calls() -> None:
    with patch("httpx.post") as http_post, patch("httpx.get") as http_get:
        AIUsageFlowRuleEngine().generate(
            technical_profile=_technical_profile(),
            evidence_report=_evidence_report(),
            wizard_profile=None,
        )

    http_post.assert_not_called()
    http_get.assert_not_called()


@pytest.mark.p0
def test_consumer_accepts_summary_proposal_that_matches_wizard_authority() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_profile.return_value = _technical_profile()
    api_client.get_accepted_technical_evidence_report.return_value = _evidence_report()
    api_client.get_wizard_profile_for_assessment.return_value = _wizard_profile(
        businessProcess="loan_approval",
        aiPurpose="credit_scoring_decision_support",
        affectedSubjects=["loan_applicant"],
        humanReview="present",
    )
    agent = MagicMock()
    agent.invoke.return_value = {"structured_response": {
        "summary_updates": {
            "businessProcess": "loan_approval",
            "aiPurpose": "credit_scoring_decision_support",
            "affectedSubjects": ["loan_applicant"],
            "humanReview": "present",
        }
    }}
    boundary = AIUsageFlowBoundary(_config(), api_client=api_client)

    with patch("tools.common.capabilities.assessment.claims.ai_usage_flow.ai_usage_flow_proposer.create_agent", return_value=agent): boundary.handle(
        {
            "technicalProfileId": "tp-1",
            "assessmentId": "assessment-1",
            "evidenceReportId": "ter-1",
        },
        correlationId="corr-2",
    )

    payload = api_client.post_ai_usage_flow_callback.call_args.args[0]
    assert payload.flow_data["summary"]["businessProcess"] == "loan_approval"
    assert payload.flow_data["summary"]["aiPurpose"] == "credit_scoring_decision_support"
    assert agent.invoke.call_args.kwargs["config"]["metadata"]["workflow_run_id"] == "ai-usage-flow:tp-1:corr-2"
    assert agent.invoke.call_args.kwargs["config"]["metadata"]["node_name"] == "ai_usage_flow.summary_proposal"


@pytest.mark.p0
def test_consumer_rejects_summary_proposal_that_conflicts_with_wizard_authority() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_profile.return_value = _technical_profile()
    api_client.get_accepted_technical_evidence_report.return_value = _evidence_report()
    api_client.get_wizard_profile_for_assessment.return_value = _wizard_profile(
        businessProcess="loan_approval",
        aiPurpose="credit_scoring_decision_support",
        affectedSubjects=["loan_applicant"],
        humanReview="present",
    )
    agent = MagicMock()
    agent.invoke.return_value = {"structured_response": {
        "summary_updates": {"businessProcess": "fraud_detection"}
    }}
    boundary = AIUsageFlowBoundary(_config(), api_client=api_client)

    with patch("tools.common.capabilities.assessment.claims.ai_usage_flow.ai_usage_flow_proposer.create_agent", return_value=agent): boundary.handle(
        {
            "technicalProfileId": "tp-1",
            "assessmentId": "assessment-1",
            "evidenceReportId": "ter-1",
        },
        correlationId="corr-3",
    )

    payload = api_client.post_ai_usage_flow_callback.call_args.args[0]
    assert payload.flow_data["summary"]["businessProcess"] == "loan_approval"


@pytest.mark.p0
def test_consumer_routes_summary_proposal_through_agentic_tool_resolver() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_profile.return_value = _technical_profile(
        organization_id="org-1"
    )
    api_client.get_accepted_technical_evidence_report.return_value = _evidence_report()
    api_client.get_wizard_profile_for_assessment.return_value = _wizard_profile(
        businessProcess="loan_approval",
        aiPurpose="credit_scoring_decision_support",
        affectedSubjects=["loan_applicant"],
        humanReview="present",
    )
    agent = MagicMock()
    agent.invoke.return_value = {"structured_response": {
        "summary_updates": {
            "businessProcess": "loan_approval",
            "aiPurpose": "credit_scoring_decision_support",
        }
    }}

    resolver = MagicMock()
    resolver.as_langchain_tools.return_value = [MagicMock(name="get_scan_coverage")]
    resolver.max_tool_calls = 4

    boundary = AIUsageFlowBoundary(
        _config(),
        api_client=api_client,
        agentic_tool_resolver=resolver,
    )

    with patch("tools.common.capabilities.assessment.claims.ai_usage_flow.ai_usage_flow_proposer.create_agent", return_value=agent): boundary.handle(
        {
            "technicalProfileId": "tp-1",
            "assessmentId": "assessment-1",
            "evidenceReportId": "ter-1",
        },
        correlationId="corr-tools",
    )

    resolver.as_langchain_tools.assert_called_once()
    context = resolver.as_langchain_tools.call_args.kwargs["context"]
    assert context.organization_id == "org-1"
    assert context.artifact_versions == {"technicalEvidenceReportId": "ter-1"}
    payload = api_client.post_ai_usage_flow_callback.call_args.args[0]
    assert payload.flow_data["summary"]["businessProcess"] == "loan_approval"


@pytest.mark.p0
def test_graph_derives_workflow_context_and_callback_payload() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_profile.return_value = _technical_profile()
    api_client.get_accepted_technical_evidence_report.return_value = _evidence_report()
    api_client.get_wizard_profile_for_assessment.return_value = None
    graph = AIUsageFlowGraph(api_client=api_client, rule_engine=AIUsageFlowRuleEngine())

    result = graph.run(
        message={
            "technicalProfileId": "tp-1",
            "assessmentId": "assessment-1",
            "evidenceReportId": "ter-1",
        },
        correlationId="corr-graph",
    )

    assert result.workflow_run_id == "ai-usage-flow:tp-1:corr-graph"
    assert result.callback_payload.technical_profile_id == "tp-1"
    assert result.flow.technical_profile_id == "tp-1"
    assert result.state.graph_name == "ai_usage_flow"
    assert result.state.node_results[0].node_name == "ai_usage_flow.rule_engine"
