"""Regression coverage for the offline CRA policy benchmark."""

import json

import pytest

from evals.cli import main
from evals.policy_baseline import (
    ARTIFACT,
    FIXTURES,
    SCOPE_PATH,
    PolicySet,
    evaluate_policy,
)


def test_each_policy_replays_all_four_verdicts():
    """Bind each classification and its evidence pointers to the unchanged fixture bytes."""
    policy_set = PolicySet.model_validate_json(
        (FIXTURES / "policies.json").read_bytes()
    )
    expected = json.loads((FIXTURES / "expected.json").read_bytes())
    for policy in policy_set.policies:
        observed = set()
        field_path = f"{ARTIFACT}#/{policy.field}"
        for snapshot, labels in expected.items():
            artifact = json.loads((FIXTURES / snapshot / ARTIFACT).read_bytes())
            result = evaluate_policy(policy, artifact)
            assert result == evaluate_policy(policy, artifact)
            assert result["verdict"] == labels[policy.id]
            assert result["evidencePaths"] == (
                [SCOPE_PATH, field_path]
                if result["verdict"] in {"PASS", "FAIL"}
                else [SCOPE_PATH]
            )
            assert result["missingEvidence"] == (
                [field_path] if result["verdict"] == "UNKNOWN" else []
            )
            observed.add(result["verdict"])
        assert observed == {"PASS", "FAIL", "UNKNOWN", "NOT_APPLICABLE"}


def test_unknown_marker_is_not_a_manufacturer_name():
    """An explicit evidence gap must not match the permissive name format."""
    policy = PolicySet.model_validate_json(
        (FIXTURES / "policies.json").read_bytes()
    ).policies[0]
    result = evaluate_policy(
        policy, {"scope": "COVERED_MANUFACTURER", policy.field: "Unknown"}
    )
    assert result["verdict"] == "UNKNOWN"
    assert result["missingEvidence"] == [f"{ARTIFACT}#/{policy.field}"]


@pytest.mark.parametrize("scope", [None, {}, "UNVERIFIED"])
def test_unverified_scope_cannot_fail_a_policy(scope):
    """Keep a declared omission undecided until the manufacturer scope is established."""
    policy = PolicySet.model_validate_json(
        (FIXTURES / "policies.json").read_bytes()
    ).policies[0]
    result = evaluate_policy(policy, {"scope": scope, policy.field: "NOT_PROVIDED"})
    assert result == {
        "verdict": "UNKNOWN",
        "applicability": "UNKNOWN",
        "missingEvidence": [SCOPE_PATH],
        "evidencePaths": [],
    }


def test_cli_compares_verified_root_trials_on_the_same_snapshot(tmp_path, monkeypatch):
    """Exercise the real scripted graph and its manifest/trace binding without provider access."""
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "false")
    output = tmp_path / "report"
    assert main(["policy-baseline", "--output-dir", str(output)]) == 0
    report = json.loads((output / "policy-report.json").read_bytes())
    root_manifest = json.loads(
        (output / "root-scripted" / "manifest.json").read_bytes()
    )
    assert report["rootManifestSha256"] == root_manifest["manifestSha256"]
    assert report["referenceStatus"] == "SEEDED_UNREVIEWED"
    assert len(report["rows"]) == 12
    assert len({row["treeSha256"] for row in report["rows"]}) == 4
    assert sum(row["rules"] for row in report["coverageByType"].values()) == 3
    assert sum(row["excluded"] for row in report["coverageByType"].values()) == 2
    assert all(row["root"]["graphExecuted"] for row in report["rows"])
    assert all((output / row["root"]["trace"]).is_file() for row in report["rows"])
    assert report["metrics"]["baseline"]["FAIL"]["precision"] == 1
    assert report["metrics"]["root"]["providerCalls"] == 0
    with pytest.raises(FileExistsError):
        main(["policy-baseline", "--output-dir", str(output)])
