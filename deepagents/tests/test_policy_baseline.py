"""Regression coverage for the offline Vietnamese policy benchmark."""

import json

import pytest

from evals.cli import main
from evals.policy_baseline import (
    ARTIFACT,
    FIXTURES,
    SCOPE_PATH,
    PolicySet,
    _evidence_criteria,
    evaluate_policy,
)
from evals.run_manifest import digest
from evals.scorer import verify_evidence_integrity


def test_policy_fixtures_replay_deterministically():
    """Cover the same four verdicts across distinct seeded DEV and HOLDOUT snapshots."""
    policies = PolicySet.model_validate_json(
        (FIXTURES / "policies.json").read_bytes()
    ).policies
    expected = json.loads((FIXTURES / "expected.json").read_bytes())
    for split in ("DEV", "HOLDOUT"):
        observed = set()
        for snapshot, reference in expected.items():
            if reference["split"] != split:
                continue
            artifact = json.loads((FIXTURES / snapshot / ARTIFACT).read_bytes())
            for policy in policies:
                result = evaluate_policy(policy, artifact)
                assert result == evaluate_policy(policy, artifact)
                assert result["verdict"] == reference["cases"][policy.id]["verdict"]
                assert SCOPE_PATH in result["evidencePaths"]
                assert bool(result["missingEvidence"]) == (
                    result["verdict"] == "UNKNOWN"
                )
                if result["verdict"] in {"PASS", "FAIL"}:
                    assert f"{ARTIFACT}#/{policy.field}" in result["evidencePaths"]
                observed.add(result["verdict"])
        assert observed == {"PASS", "FAIL", "UNKNOWN", "NOT_APPLICABLE"}


@pytest.mark.parametrize(
    "evidence",
    [
        "Unknown",
        "Not provided",
        "None",
        "Pending verification",
        {"status": "UNVERIFIED"},
        {"status": "MISSING"},
        {"status": "UNVERIFIED", "value": "v4"},
        {"status": "VERIFIED_PRESENT", "value": []},
        {"status": "VERIFIED_PRESENT", "value": 42},
        {"status": "EXPLICITLY_ABSENT", "value": "v4"},
    ],
)
def test_unverified_or_malformed_evidence_cannot_establish_system_version(evidence):
    """Only a structured, verified transcription or explicit negative observation is decisive."""
    policy = PolicySet.model_validate_json(
        (FIXTURES / "policies.json").read_bytes()
    ).policies[0]
    result = evaluate_policy(
        policy,
        {
            "scope": "IN_SCOPE",
            "isProvider": True,
            "mediumOrHighRisk": True,
            policy.field: evidence,
        },
    )
    assert result["verdict"] == "UNKNOWN"
    assert result["missingEvidence"] == [f"{ARTIFACT}#/{policy.field}"]


@pytest.mark.parametrize("scope", [None, {}, "UNVERIFIED"])
def test_unverified_scope_cannot_fail_a_policy(scope):
    """Keep a declared omission undecided until scope is established."""
    policy = PolicySet.model_validate_json(
        (FIXTURES / "policies.json").read_bytes()
    ).policies[0]
    result = evaluate_policy(
        policy, {"scope": scope, policy.field: {"status": "EXPLICITLY_ABSENT"}}
    )
    assert result == {
        "verdict": "UNKNOWN",
        "applicability": "UNKNOWN",
        "missingEvidence": [SCOPE_PATH],
        "evidencePaths": [],
    }


def test_citation_to_correct_repo_but_wrong_span_fails_evidence_gate():
    """A valid hash and matching path cannot substitute for the required source span."""
    snapshot = FIXTURES / "assist"
    source = (snapshot / ARTIFACT).read_text()
    criterion = _evidence_criteria(source, ["dossierSystemVersion"])[0]
    span = criterion.required_span
    assert span is not None
    evidence = {
        "evidenceType": "REPOSITORY_SOURCE",
        "repositoryId": "policy-assist",
        "commitSha": "fixture-commit",
        "path": ARTIFACT,
        "start_line": 2,
        "end_line": 2,
        "contentSha256": digest(source.splitlines()[1]),
    }
    args = {
        "required_refs": (),
        "observed_refs": ["ev"],
        "observed_evidence_records": {"ev": evidence},
        "required_criteria": [criterion],
        "decision_referenced_ids": ["ev"],
        "expected_repo_id": "policy-assist",
        "expected_commit_sha": "fixture-commit",
        "repo_fixture_root": snapshot,
    }
    assert not verify_evidence_integrity(**args)
    evidence.update(
        start_line=span[0],
        end_line=span[1],
        contentSha256=digest(source.splitlines()[span[0] - 1]),
    )
    assert verify_evidence_integrity(**args)


def test_cli_upload_inventory_includes_p14_smoke_without_semantic_claims(tmp_path):
    """Exercise trace verification with isolated case splits and official source pins."""
    output = tmp_path / "report"
    assert main(["policy-baseline", "--output-dir", str(output)]) == 0
    report = json.loads((output / "policy-report.json").read_bytes())
    manifest = json.loads((output / "root-scripted" / "manifest.json").read_bytes())
    cases = json.loads((output / "cases.json").read_bytes())["cases"]
    assert report["rootManifestSha256"] == manifest["manifestSha256"]
    assert report["referenceStatus"] == "SEEDED_UNREVIEWED"
    assert report["comparisonMode"] == "SCRIPTED_SMOKE_ONLY"
    assert report["semanticAssessment"]["status"] == "NOT_SCORED"
    assert set(report["legalSource"]["documents"]) == {
        "134-2025-QH15",
        "142-2026-ND-CP",
    }
    assert len(report["rows"]) == len(manifest["expectedTrialInventory"]) == 56
    assert sum(row["rules"] for row in report["coverageByType"].values()) == 7
    assert sum(row["excluded"] for row in report["coverageByType"].values()) == 2
    assert set(report["metrics"]) == {"DEV", "HOLDOUT"}
    dev_trees = {row["treeSha256"] for row in report["rows"] if row["split"] == "DEV"}
    holdout_trees = {
        row["treeSha256"] for row in report["rows"] if row["split"] == "HOLDOUT"
    }
    assert len(dev_trees) == len(holdout_trees) == 4
    assert dev_trees.isdisjoint(holdout_trees)
    assert all(
        case["gold_rubric"]["stages"][0]["required_evidence_criteria"] for case in cases
    )
    hitl_case = next(
        case for case in cases if case["case_id"] == "workbench-VN-AI-MEDIA-MARK"
    )
    assert hitl_case["gold_rubric"]["stages"][0]["expected_hitl_state"] == "OPEN"
    hitl_trial = next(
        row["rootSmoke"]
        for row in report["rows"]
        if row["caseId"] == hitl_case["case_id"]
    )
    assert not hitl_trial["hitlMatch"]
    assert all(row["rootSmoke"]["graphExecuted"] for row in report["rows"])
    assert all((output / row["rootSmoke"]["trace"]).is_file() for row in report["rows"])
    assert report["rootSmokeMetrics"]["providerCalls"] == 0
    assert report["rootSmokeMetrics"]["workflowMatch"] < len(cases)
    with pytest.raises(FileExistsError):
        main(["policy-baseline", "--output-dir", str(output)])
