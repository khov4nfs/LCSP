from copy import deepcopy

from orchestration.technical_coverage_policy import attach_partial_coverage_policy


def report():
    return {"evidence_graph": {"coverage_state": "LIMITED", "snapshot_id": "snapshot",
                              "commit_sha": "commit", "coverage_notes": ["external configuration unobserved"],
                              "nodes": []},
            "technical_findings": [{"rule_id": "observed-finding"}]}


def test_bounded_partial_report_permits_interview_with_auditable_limitations():
    payload = report()
    original = deepcopy(payload)
    result = attach_partial_coverage_policy(payload)
    policy = result["partialCoveragePolicyDecision"]
    assert policy["permittedForInterview"] is True
    assert policy["limitations"] == payload["evidence_graph"]["coverage_notes"]
    assert policy["policyVersion"] and policy["policyDecisionRef"]
    assert payload == original
    assert attach_partial_coverage_policy(result) == result


def test_no_evidence_or_limitations_or_provenance_denies_invocation():
    for key in ("snapshot_id", "commit_sha", "coverage_notes"):
        payload = report()
        payload["evidence_graph"].pop(key)
        assert attach_partial_coverage_policy(payload)["partialCoveragePolicyDecision"]["permittedForInterview"] is False
    payload = report()
    payload["technical_findings"] = []
    assert attach_partial_coverage_policy(payload)["partialCoveragePolicyDecision"]["permittedForInterview"] is False


def test_prior_policy_denial_and_unavailable_are_not_overridden():
    payload = report()
    payload["partialCoveragePolicyDecision"] = {"permittedForInterview": False}
    assert attach_partial_coverage_policy(payload) == payload
    payload = report()
    payload["evidence_graph"]["coverage_state"] = "UNAVAILABLE"
    assert "partialCoveragePolicyDecision" not in attach_partial_coverage_policy(payload)
