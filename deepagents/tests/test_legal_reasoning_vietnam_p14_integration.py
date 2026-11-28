"""Vietnam-only legal source binding and real P14 SCRIPTED integration regressions."""

from __future__ import annotations

import json
import subprocess
from copy import deepcopy
from functools import lru_cache
from pathlib import Path

import pytest

from evals import policy_baseline
from evals.benchmark_runner import load_benchmark_cases
from evals.cli import main as p14_cli_main
from evals.legal_reasoning.p14_adapter import (
    integrate_p14_artifacts,
    validate_case_mapping,
)
from evals.legal_reasoning.p14_cohort import canonical_digest, load_cohort
from evals.legal_reasoning.splits import load_split_manifest
from evals.legal_reasoning.validation import (
    PACKAGE_ROOT,
    load_dataset,
    validate_dataset,
)

DEEPAGENTS = Path(__file__).resolve().parents[1]
CANDIDATES = PACKAGE_ROOT / "candidate-cases.vn-ai.v1.jsonl"
P14_CASES = PACKAGE_ROOT / "p14-cases.vn-ai.v1.json"
CASE_MAP = PACKAGE_ROOT / "p14-case-map.vn-ai.v3.json"
COHORT = PACKAGE_ROOT / "p14-shared-cohort.vn-ai.v2.json"
SPLITS = PACKAGE_ROOT / "evaluation-splits.vn-ai.v2.json"
SOURCE_PINS = PACKAGE_ROOT / "source-pins.vn-ai.v1.json"
RUBRIC = PACKAGE_ROOT / "rubric.vn-ai.v1.json"
OVERLAY = PACKAGE_ROOT / "review-overlay.vn-ai.v1.json"


@pytest.fixture(scope="module")
def scripted_vn_run(tmp_path_factory):
    """Run the real P14 SCRIPTED runner over the exact, nonempty official-source cohort."""
    root = tmp_path_factory.mktemp("lcsp400-vn-scripted")
    output = root / "runs"
    run_id = "lcsp400-vn-ai-scripted-test"
    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=DEEPAGENTS, text=True
    ).strip()
    assert (
        p14_cli_main(
            [
                "run",
                "--cases",
                str(P14_CASES),
                "--mode",
                "SCRIPTED",
                "--split",
                "ALL",
                "--trials",
                "1",
                "--k",
                "1",
                "--run-id",
                run_id,
                "--git-commit-sha",
                commit,
                "--output-dir",
                str(output),
                "--evaluation-split-manifest",
                str(SPLITS),
            ]
        )
        == 0
    )
    return output / run_id


def _run_args(run: Path, **overrides):
    return {
        "manifest_path": run / "manifest.json",
        "trials_path": run / "trials.jsonl",
        "p14_cases_path": P14_CASES,
        "candidate_cases_path": CANDIDATES,
        "case_mapping_path": CASE_MAP,
        "reviews_path": None,
        "dimension_reviews_path": None,
        "review_overlay_path": OVERLAY,
        "rubric_path": RUBRIC,
        "source_pins_path": SOURCE_PINS,
        "shared_cohort_path": COHORT,
        "split_manifest_path": SPLITS,
        **overrides,
    }


def test_active_dataset_is_vietnamese_provisional_and_schema_valid():
    rows = load_dataset(CANDIDATES)
    rubric = json.loads(RUBRIC.read_text(encoding="utf-8"))
    pins = json.loads(SOURCE_PINS.read_text(encoding="utf-8"))
    inventory = validate_dataset(rows, rubric, pins)
    cohort = load_cohort(COHORT)
    mapping = json.loads(CASE_MAP.read_text(encoding="utf-8"))

    assert len(rows) == 30
    assert inventory["reviewStatusCounts"]["CANDIDATE"] == 30
    assert inventory["reviewStatusCounts"]["REVIEWED"] == 0
    assert all(row["stage"] == "ASSESSMENT_ROOT" for row in rows)
    assert all(row["evaluationTarget"] == "ACTUAL_ASSESSMENT_OUTPUT" for row in rows)
    assert all(row["reviewers"] == [] for row in rows)
    assert all("GDPR" not in row["legalSource"]["sourceId"] for row in rows)
    assert {row["sourceKind"] for row in pins["sources"]} == {"OFFICIAL_PINNED_LAW"}
    assert {row["jurisdiction"] for row in pins["sources"]} == {"VIETNAM"}
    assert len(cohort["cases"]) == 30
    assert mapping["mappingVersion"] == "LCSP-400-P14-CASE-MAP-V3"
    assert len(mapping["caseMappings"]) == 30


def test_official_mapping_cross_binds_candidate_rule_source_facts_and_split(
    scripted_vn_run, monkeypatch
):
    run = scripted_vn_run
    manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8"))
    candidates = load_dataset(CANDIDATES)
    cases = load_benchmark_cases(P14_CASES, split="ALL")
    mapping = json.loads(CASE_MAP.read_text(encoding="utf-8"))
    pins = json.loads(SOURCE_PINS.read_text(encoding="utf-8"))
    cohort = load_cohort(COHORT)
    split = load_split_manifest(SPLITS)

    verified_loader = lru_cache(maxsize=1)(policy_baseline._load_legal_context)
    monkeypatch.setattr(policy_baseline, "_load_legal_context", verified_loader)
    inventory = validate_case_mapping(
        mapping,
        candidate_cases=candidates,
        p14_cases=cases,
        manifest=manifest,
        source_pins=pins,
        shared_cohort=cohort,
        split_manifest=split,
    )
    assert inventory["mappedCaseCount"] == 30
    assert inventory["mappedCandidateLegalGoldCaseCount"] == 0
    assert inventory["officialProvisionCount"] == 11

    wrong_case = deepcopy(mapping)
    wrong_case["caseMappings"][0]["p14CaseId"] = wrong_case["caseMappings"][1][
        "p14CaseId"
    ]
    with pytest.raises(ValueError, match="P14_VN_TARGET_BINDING_MISMATCH"):
        validate_case_mapping(
            wrong_case,
            candidate_cases=candidates,
            p14_cases=cases,
            manifest=manifest,
            source_pins=pins,
            shared_cohort=cohort,
            split_manifest=split,
        )

    wrong_candidate = deepcopy(candidates)
    wrong_candidate[0]["executionBinding"]["p14CaseId"] = wrong_candidate[1][
        "executionBinding"
    ]["p14CaseId"]
    wrong_binding = deepcopy(mapping)
    wrong_binding["pinnedInputs"]["candidateDatasetSha256"] = canonical_digest(
        wrong_candidate
    )
    with pytest.raises(ValueError, match="P14_VN_TARGET_BINDING_MISMATCH"):
        validate_case_mapping(
            wrong_binding,
            candidate_cases=wrong_candidate,
            p14_cases=cases,
            manifest=manifest,
            source_pins=pins,
            shared_cohort=cohort,
            split_manifest=split,
        )

    foreign_pins = deepcopy(pins)
    foreign_pins["jurisdiction"] = "EUROPE"
    wrong_source = deepcopy(mapping)
    wrong_source["pinnedInputs"]["sourcePinsSha256"] = canonical_digest(foreign_pins)
    with pytest.raises(
        ValueError, match="P14_VN_OFFICIAL_SOURCE_CLASSIFICATION_INVALID"
    ):
        validate_case_mapping(
            wrong_source,
            candidate_cases=candidates,
            p14_cases=cases,
            manifest=manifest,
            source_pins=foreign_pins,
            shared_cohort=cohort,
            split_manifest=split,
        )


def test_nonempty_scripted_artifacts_integrate_and_empty_or_partial_mapping_stays_unscored(
    scripted_vn_run, tmp_path
):
    args = _run_args(scripted_vn_run)
    report = integrate_p14_artifacts(**args)
    assert report["artifactValidationStatus"] == "VALIDATED"
    assert report["artifactClassification"] == "P14_SCRIPTED_EXECUTION_ARTIFACTS"
    assert report["actualExecutionStatus"] == "SCRIPTED_EXECUTED"
    assert report["actualExecutionBaseline"] == "NOT_RUN"
    assert report["caseMapping"]["candidateCaseCount"] == 30
    assert report["caseMapping"]["mappedCaseCount"] == 30
    assert report["executionCohort"]["executedCaseCount"] == 30
    assert report["executionCohort"]["executedTrialCount"] == 30
    assert report["executionCohort"]["outputAvailableCount"] == 30
    assert report["executionCohort"]["executedMissingOutputCount"] == 0
    assert report["reviewedGoldDenominator"] == 0
    assert report["scoringStatus"] == "NOT_SCORED"
    assert report["humanReviewedQualityMetrics"] == "NOT_SCORED"
    assert len(report["normalizedObservedOutputs"]) == 30
    assert all(
        row["p14Binding"]["traceSha256"] for row in report["normalizedObservedOutputs"]
    )

    empty = deepcopy(json.loads(CASE_MAP.read_text(encoding="utf-8")))
    empty["caseMappings"] = []
    empty_path = tmp_path / "empty-map.json"
    empty_path.write_text(json.dumps(empty), encoding="utf-8")
    empty_report = integrate_p14_artifacts(
        **_run_args(scripted_vn_run, case_mapping_path=empty_path)
    )
    assert empty_report["caseMapping"]["mappedCaseCount"] == 0
    assert empty_report["executionCohort"]["executedCaseCount"] == 0
    assert empty_report["scoringStatus"] == "NOT_SCORED"
    assert empty_report["rubricReportsByTargetAndTrial"] == []

    partial = deepcopy(json.loads(CASE_MAP.read_text(encoding="utf-8")))
    partial["caseMappings"] = partial["caseMappings"][:1]
    partial_path = tmp_path / "partial-map.json"
    partial_path.write_text(json.dumps(partial), encoding="utf-8")
    partial_report = integrate_p14_artifacts(
        **_run_args(scripted_vn_run, case_mapping_path=partial_path)
    )
    assert partial_report["caseMapping"]["mappedCaseCount"] == 1
    assert partial_report["executionCohort"]["executedCaseCount"] == 1
    assert partial_report["executionCohort"]["executedTrialCount"] == 1
    assert partial_report["scoringStatus"] == "NOT_SCORED"


def test_bound_review_fixture_reaches_score_dataset_without_claiming_human_quality(
    scripted_vn_run, tmp_path
):
    """Exercise score routing with temporary simulated reviews, never as human evidence."""
    baseline = integrate_p14_artifacts(**_run_args(scripted_vn_run))
    candidates = load_dataset(CANDIDATES)
    candidate = candidates[0]
    dimensions = {
        "applicability": "APPLICABILITY",
        "compliance": "COMPLIANCE",
        "actor": "ACTOR",
        "conditions": "CONDITIONS",
        "exceptions": "EXCEPTIONS",
        "evidenceSufficiency": "EVIDENCE_SUFFICIENCY",
        "unsupportedConclusion": "UNSUPPORTED_CONCLUSION",
    }
    gold_judgments = [
        {
            "dimension": dimensions[field],
            "label": value["label"],
            "rationale": "Temporary test fixture.",
        }
        for field, value in candidate["expected"].items()
        if value is not None
    ]
    gold_reviewer = {
        "reviewerType": "HUMAN",
        "reviewerId": "test-reviewer-gold-1",
        "identityVerificationRef": "https://reviews.acme.com/records/lcsp400-test-gold",
        "reviewedAt": "2026-11-28T10:00:00Z",
        "decision": "CONFIRM",
        "dimensionsReviewed": [row["dimension"] for row in gold_judgments],
        "dimensionJudgments": gold_judgments,
    }
    candidate_overlay = {
        "overlayVersion": "LCSP-400-REVIEW-OVERLAY-V1",
        "candidateDatasetSha256": canonical_digest(candidates),
        "caseReviews": [
            {
                "caseId": candidate["caseId"],
                "candidateRecordSha256": canonical_digest(candidate),
                "reviewStatus": "REVIEWED",
                "reviewers": [gold_reviewer],
                "reviewerDisagreements": [],
                "adjudication": None,
                "uncertaintyReason": None,
                "exclusionReason": None,
                "expectedOverrides": {},
            }
        ],
    }
    candidate_overlay_path = tmp_path / "test-only-review-overlay.json"
    candidate_overlay_path.write_text(json.dumps(candidate_overlay), encoding="utf-8")

    observed = next(
        row
        for row in baseline["normalizedObservedOutputs"]
        if row["caseId"] == candidate["caseId"]
    )
    binding = observed["p14Binding"]
    conditions_label = candidate["expected"]["conditions"]["label"]
    output_reviewer = {
        "reviewerType": "HUMAN",
        "reviewerId": "test-reviewer-output-1",
        "identityVerificationRef": "https://reviews.acme.com/records/lcsp400-test-output",
        "reviewedAt": "2026-11-28T10:01:00Z",
        "decision": "CONFIRM",
        "dimensionsReviewed": ["CONDITIONS"],
        "dimensionJudgments": [
            {
                "dimension": "CONDITIONS",
                "label": conditions_label,
                "rationale": "Temporary output-binding test fixture.",
            }
        ],
    }
    output_review = {
        "reviewSetVersion": "LCSP-400-OBSERVED-OUTPUT-REVIEWS-V1",
        "reviewSetKind": "HUMAN_REVIEW",
        "reviews": [
            {
                "candidateCaseId": candidate["caseId"],
                "p14CaseId": observed["p14CaseId"],
                "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
                "evaluationStage": binding["evaluationStage"],
                "lifecycleStage": binding["lifecycleStage"],
                "trialIndex": binding["trialIndex"],
                "p14Binding": binding,
                "humanJudgments": {
                    "conditions": {
                        "label": conditions_label,
                        "reviewStatus": "REVIEWED",
                        "reviewers": [output_reviewer],
                        "reviewerDisagreements": [],
                        "adjudication": None,
                        "targetBinding": binding,
                    }
                },
            }
        ],
    }
    output_review_path = tmp_path / "test-only-output-review.json"
    output_review_path.write_text(json.dumps(output_review), encoding="utf-8")

    report = integrate_p14_artifacts(
        **_run_args(
            scripted_vn_run,
            review_overlay_path=candidate_overlay_path,
            dimension_reviews_path=output_review_path,
        )
    )

    assert report["scoringStatus"] == "SCORED"
    assert report["reviewedGoldDenominator"] > 0
    assert report["reviewAuthenticityStatus"] == "NOT_AUTHENTICATED_BY_TOOL"
    assert report["actualExecutionStatus"] == "SCRIPTED_EXECUTED"
    assert report["actualExecutionBaseline"] == "NOT_RUN"
    scored = next(
        row
        for row in report["rubricReportsByTargetAndTrial"]
        if row["scoringStatus"] == "SCORED"
    )
    assert scored["reportClassification"] == "P14_VERIFIED_SCRIPTED_DIAGNOSTIC"
    assert scored["qualityClaimStatus"] == "SCRIPTED_DIAGNOSTIC_ONLY"
