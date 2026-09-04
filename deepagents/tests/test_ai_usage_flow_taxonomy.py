from __future__ import annotations

from tools.common.capabilities.assessment.claims.ai_usage_flow.ai_usage_flow_rule_engine import AIUsageFlowRuleEngine


CANONICAL_CLAIM_TYPES = {
    "MODEL_PROVIDER_USAGE",
    "MODEL_INVOCATION",
    "AI_GENERATED_OUTPUT",
    "DOWNSTREAM_ACTION",
    "AUTOMATED_DECISION",
    "HUMAN_REVIEW",
    "PROMPT_STORAGE",
    "PERSONAL_DATA_INPUT",
    "TRAINING_ACTIVITY",
    "RAG_USAGE",
    "DOCUMENT_GENERATION",
    "CONTENT_LABELING",
    "HUMAN_OVERSIGHT_CONTROL",
    "AI_INTERACTION_DISCLOSURE",
    "INCIDENT_HANDLING",
}


def _technical_profile() -> dict:
    return {
        "id": "tp-taxonomy",
        "technical_profile_id": "tp-taxonomy",
        "assessment_id": "assessment-taxonomy",
        "evidence_report_id": "ter-taxonomy",
        "status": "accepted",
        "ai_detected": "confirmed",
        "providers": ["openai"],
        "frameworks": [],
        "input_categories": ["personal_data"],
        "output_categories": ["image", "document"],
        "coverage_limitations": [],
        "evidence_refs": ["provider-ref"],
        "privacy_flags": {
            "containsSourceCode": False,
            "secretsRedacted": True,
        },
    }


def _finding(finding_type: str, suffix: str) -> dict:
    return {
        "finding_id": f"finding-{suffix}",
        "finding_type": finding_type,
        "file_path": "app/service.py",
        "line_number": 10,
        "has_dynamic_call": False,
    }


def _evidence_report(*, dynamic: bool = False) -> dict:
    technical_findings = [
        _finding("AI_OUTPUT_SIGNAL", "output"),
        _finding("STATUS_UPDATE_SIGNAL", "status"),
        _finding("AUTOMATED_DECISION_SIGNAL", "auto"),
        _finding("HUMAN_REVIEW_SIGNAL", "review"),
        _finding("SYSTEM_PROMPT_DETECTED", "prompt"),
        _finding("SENSITIVE_DATA_SIGNAL", "sensitive"),
        _finding("TRAINING_ACTIVITY_SIGNAL", "training"),
        _finding("RAG_USAGE_SIGNAL", "rag"),
        _finding("DOCUMENT_GENERATION_SIGNAL", "document"),
        _finding("CONTENT_LABELING_SIGNAL", "label"),
        _finding("HUMAN_OVERSIGHT_CONTROL_SIGNAL", "oversight"),
        _finding("AI_INTERACTION_DISCLOSURE_SIGNAL", "disclosure"),
        _finding("INCIDENT_HANDLING_SIGNAL", "incident"),
    ]
    if dynamic:
        technical_findings.append(_finding("UNSUPPORTED_DYNAMIC_FLOW", "dynamic"))

    return {
        "id": "ter-taxonomy",
        "status": "accepted",
        "privacy_flags": {
            "containsSourceCode": False,
            "secretsRedacted": True,
        },
        "evidence_payload": {
            # Keep a Semgrep branch populated to prove technical_findings are
            # merged instead of being ignored when ai_usage_signals is non-empty.
            "ai_usage_signals": [
                {
                    "id": "finding-provider",
                    "signal_type": "AI_PROVIDER_USAGE",
                    "evidence_ref": "provider-ref",
                },
                {
                    "id": "finding-invocation",
                    "signal_type": "AI_MODEL_INVOCATION",
                    "evidence_ref": "invocation-ref",
                },
            ],
            "technical_findings": technical_findings,
            "coverage_notes": [],
        },
    }


def test_rule_engine_consumes_semgrep_and_technical_findings_for_full_taxonomy() -> None:
    flow = AIUsageFlowRuleEngine().generate(
        technical_profile=_technical_profile(),
        evidence_report=_evidence_report(),
        confirmed_customer_context=None,
    )

    categories = {claim.claim_category for claim in flow.claims}
    assert categories == CANONICAL_CLAIM_TYPES
    assert flow.summary["downstreamAction"] == "AUTOMATED_DECISION"
    assert flow.summary["humanReview"] == "PRESENT"
    assert flow.summary["automationLevel"] == "FULLY_AUTOMATED"
    assert flow.summary["contentLabelingStatus"] == "PRESENT"
    assert flow.summary["interventionControlPresent"] == "PRESENT"
    assert flow.summary["aiInteractionDisclosurePresent"] == "PRESENT"
    assert flow.summary["incidentHandlingPresent"] == "PRESENT"


def test_automated_decision_abstains_when_dynamic_path_is_unresolved() -> None:
    flow = AIUsageFlowRuleEngine().generate(
        technical_profile=_technical_profile(),
        evidence_report=_evidence_report(dynamic=True),
        confirmed_customer_context=None,
    )

    automated = next(
        claim for claim in flow.claims if claim.claim_category == "AUTOMATED_DECISION"
    )
    assert automated.lifecycle_state == "ABSTAINED"
    assert "UNRESOLVED_OUTPUT_ACTION_PATH" in automated.uncertainty_reasons
    assert flow.status == "UNCLEAR"
