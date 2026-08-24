from __future__ import annotations

from tools.engineer_rule.intelligence.ai_usage_flow_rule_engine import AIUsageFlow
from tools.engineer_rule.intelligence.engineering_claim_adapter import EngineeringClaimAdapter


def _flow() -> AIUsageFlow:
    return AIUsageFlow(
        ai_usage_flow_id="flow-1",
        assessment_id="assessment-1",
        technical_profile_id="profile-1",
        technical_evidence_report_id="report-1",
        schema_version="1.0.0",
        provider_version="test",
        status="READY",
        verification_source="TECHNICAL_ONLY",
        summary={},
        claims=[],
        confidence=0.9,
        uncertainty_reasons=[],
        coverage_limitations=[],
        conflict_candidates=[],
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
    )


def test_validated_engineering_claim_is_projected_without_legal_verdict() -> None:
    profile = {
        "engineering_investigation": {
            "status": "COMPLETE",
            "claims": [
                {
                    "claim_id": "claim:1",
                    "engineering_rule_id": "eng-1",
                    "claim_type": "HUMAN_REVIEW_PRESENT",
                    "value": True,
                    "evidence_refs": ["node:review"],
                    "confidence": 0.93,
                    "limitations": [],
                }
            ],
            "limitations": [],
        }
    }
    result = EngineeringClaimAdapter().apply(flow=_flow(), technical_profile=profile)
    assert len(result.claims) == 1
    claim = result.claims[0]
    assert claim.claim_category == "ENGINEERING_EVIDENCE"
    assert claim.claim_field == "human_review_present"
    assert claim.claim_value == {
        "HUMAN_REVIEW_PRESENT": True,
        "engineeringRuleId": "eng-1",
    }
    assert claim.lifecycle_state == "VALIDATED"
    assert claim.evidence_refs == ["node:review"]
    assert result.status == "READY"


def test_partial_investigation_degrades_flow_and_low_confidence_claim_abstains() -> None:
    profile = {
        "engineering_investigation": {
            "status": "PARTIAL",
            "claims": [
                {
                    "claim_id": "claim:2",
                    "engineering_rule_id": "eng-2",
                    "claim_type": "EXTERNAL_DATA_EGRESS",
                    "value": {"present": True},
                    "evidence_refs": ["edge:egress"],
                    "confidence": 0.5,
                    "limitations": ["dynamic target unresolved"],
                }
            ],
            "limitations": ["ENGINEERING_RULE_INVESTIGATION_FAILED:rule-x:ValueError"],
        }
    }
    result = EngineeringClaimAdapter().apply(flow=_flow(), technical_profile=profile)
    assert result.status == "UNCLEAR"
    assert result.claims[0].lifecycle_state == "ABSTAINED"
    assert "ENGINEERING_INVESTIGATION_PARTIAL" in result.uncertainty_reasons
    assert any("ENGINEERING_RULE_INVESTIGATION_FAILED" in reason for reason in result.uncertainty_reasons)


def test_invalid_engineering_claim_does_not_become_material_fact() -> None:
    profile = {
        "engineering_investigation": {
            "status": "COMPLETE",
            "claims": [
                {
                    "claim_id": "claim:bad",
                    "engineering_rule_id": "eng-3",
                    "claim_type": "SENSITIVE_DATA_EGRESS",
                    "value": True,
                    "evidence_refs": [],
                    "confidence": 0.99,
                }
            ],
            "limitations": [],
        }
    }
    result = EngineeringClaimAdapter().apply(flow=_flow(), technical_profile=profile)
    assert result.claims == []
    assert result.status == "UNCLEAR"
    assert "ENGINEERING_INVESTIGATION_INVALID_CLAIMS:1" in result.uncertainty_reasons
