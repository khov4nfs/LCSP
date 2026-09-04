from __future__ import annotations

from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    _technical_coverage,
)


def test_unavailable_coverage_is_normalized_before_interview_dispatch() -> None:
    report = {
        "evidence_payload": {
            "evidence_graph": {
                "coverage_state": "unavailable",
                "coverage_notes": ["scanner could not establish bounded coverage"],
            }
        }
    }

    coverage_state, coverage_notes = _technical_coverage(report)

    assert coverage_state == "UNAVAILABLE"
    assert coverage_notes == ["scanner could not establish bounded coverage"]


def test_coverage_helper_accepts_camel_case_pge_contract() -> None:
    report = {
        "evidencePayload": {
            "evidence_graph": {
                "coverageState": "partial",
                "coverageNotes": ["dynamic dispatch remains unresolved"],
            }
        }
    }

    coverage_state, coverage_notes = _technical_coverage(report)

    assert coverage_state == "PARTIAL"
    assert coverage_notes == ["dynamic dispatch remains unresolved"]
