"""Regression coverage for the offline Vietnamese policy benchmark."""

import json

import pytest
from pydantic import ValidationError

from evals import policy_baseline
from evals.cli import main
from evals.policy_baseline import (
    ARTIFACT,
    FIXTURES,
    SCOPE_PATH,
    PolicySet,
    _evidence_criteria,
    _load_legal_context,
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
        {"status": "VERIFIED_PRESENT", "value": "Unknown"},
        {"status": "VERIFIED_PRESENT", "value": "Not provided"},
        {"status": "VERIFIED_PRESENT", "version": "Unknown"},
        {"status": "VERIFIED_PRESENT", "version": "Not provided"},
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
            "assessedOn": "2027-10-01",
            "firstOperatedOn": "2026-06-01",
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


@pytest.mark.parametrize(
    ("sector", "assessed_on", "expected"),
    [
        ("FINANCE", "2027-08-31", "NOT_APPLICABLE"),
        ("FINANCE", "2027-09-01", "FAIL"),
        ("OTHER", "2027-02-28", "NOT_APPLICABLE"),
        ("OTHER", "2027-03-01", "FAIL"),
        (None, "2027-10-01", "UNKNOWN"),
        ("OTHER", "2027-09-31", "UNKNOWN"),
        ("OTHER", "2025-11-30", "UNKNOWN"),
    ],
)
def test_legacy_transition_uses_verified_chronology(sector, assessed_on, expected):
    """A recorded absence is decisive only once the relevant transition has elapsed."""
    policy = PolicySet.model_validate_json(
        (FIXTURES / "policies.json").read_bytes()
    ).policies[0]
    result = evaluate_policy(
        policy,
        {
            "scope": "IN_SCOPE",
            "isProvider": True,
            "mediumOrHighRisk": True,
            "assessedOn": assessed_on,
            "firstOperatedOn": "2025-12-01",
            "sector": sector,
            policy.field: {"status": "EXPLICITLY_ABSENT"},
        },
    )
    assert result["verdict"] == expected


@pytest.mark.parametrize(
    ("override", "error", "message"),
    [
        ({"text": "Unverified replacement"}, ValidationError, "Extra inputs"),
        ({"locator": "art-2"}, ValueError, "POLICY_SOURCE_LOCATOR_DRIFT"),
    ],
)
def test_legal_context_rejects_fixture_edits_against_unchanged_pdf(
    tmp_path,
    monkeypatch,
    override,
    error,
    message,
):
    """An editable fixture cannot replace text or retarget an official article identity."""
    selectors = {
        "law-1": {
            "document": "134-2025-QH15",
            "locator": "art-1",
            "pageStart": 1,
            "pageEnd": 1,
            **override,
        }
    }
    (tmp_path / "legal-context.json").write_text(json.dumps(selectors))
    monkeypatch.setattr(policy_baseline, "FIXTURES", tmp_path)
    with pytest.raises(error, match=message):
        _load_legal_context()


def test_legal_context_rejects_ambiguous_article_in_verified_extraction(
    tmp_path, monkeypatch
):
    """The real decree repeats Article 3 locators in an appendix."""
    selectors = {
        "decree-3": {
            "document": "142-2026-ND-CP",
            "locator": "art-3",
            "pageStart": 2,
            "pageEnd": 3,
        }
    }
    (tmp_path / "legal-context.json").write_text(json.dumps(selectors))
    monkeypatch.setattr(policy_baseline, "FIXTURES", tmp_path)
    with pytest.raises(ValueError, match=r"POLICY_SOURCE_LOCATOR_AMBIGUOUS:.*::dup-"):
        _load_legal_context()


def test_article_continuation_requires_matching_locator_hierarchy_and_pages():
    """Split chunks remain eligible only when they reconstruct one source locator."""
    selector = policy_baseline.ArticleSelector(
        document="142-2026-ND-CP",
        locator="art-17",
        pageStart=14,
        pageEnd=15,
    )
    base = "art-17::cl-5::pt-a"
    hierarchy = {
        "articleNumber": "17",
        "clauseNumber": "5",
        "pointLabel": "a",
        "partOf": base,
    }
    parts = [
        {
            "locator": f"{base}::part-{part}",
            "hierarchy": hierarchy,
            "pageStart": page,
            "pageEnd": page,
        }
        for part, page in ((1, 14), (2, 15))
    ]
    policy_baseline._validate_article_chunks(parts, selector)
    for mutation, error in (
        ({"locator": f"{base}::part-3"}, "CONTINUATION_DRIFT"),
        ({"hierarchy": {**hierarchy, "clauseNumber": "6"}}, "HIERARCHY_DRIFT"),
        ({"pageStart": 16, "pageEnd": 16}, "PAGE_DRIFT"),
        ({"locator": f"{base}::part-2::dup-2"}, "LOCATOR_AMBIGUOUS"),
    ):
        with pytest.raises(ValueError, match=f"POLICY_SOURCE_{error}"):
            policy_baseline._validate_article_chunks(
                [parts[0], {**parts[1], **mutation}], selector
            )


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
    assert len(report["rows"]) == len(manifest["expectedTrialInventory"]) == 32
    assert sum(row["rules"] for row in report["coverageByType"].values()) == 4
    assert sum(row["excluded"] for row in report["coverageByType"].values()) == 5
    assert all(
        source["ingestionArtifactSha256"]
        for source in report["legalSource"]["documents"].values()
    )
    open_marking_case = next(
        case
        for case in cases
        if case["case_id"] == "capture-VN-AI-OPEN-MARK-ENABLEMENT"
    )
    article = open_marking_case["legal_provisions"][0]
    assert (article["document_id"], article["locator"]) == ("142-2026-ND-CP", "Điều 17")
    assert "5. Trường hợp hệ thống trí tuệ nhân tạo" in article["content"]
    assert "mở hoặc cung cấp miễn phí" in article["content"]
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
