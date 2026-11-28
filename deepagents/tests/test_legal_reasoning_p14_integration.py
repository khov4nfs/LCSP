"""Offline integration and exact case-mapping tests for the LCSP-400 P14 adapter."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from evals.benchmark_runner import load_benchmark_cases, load_manual_reviews
from evals.benchmark_schema import TrialOutcome
from evals.scorer import validate_run_artifacts_for_scoring
from evals.legal_reasoning.p14_adapter import (
    _load_dimension_reviews,
    _validate_dimension_review,
    _validate_unique_review_trials,
    integrate_p14_artifacts,
    validate_case_mapping,
)
from evals.legal_reasoning.review_overlay import _digest
from evals.legal_reasoning.validation import PACKAGE_ROOT, load_dataset

DEEPAGENTS = Path(__file__).resolve().parents[1]
P14_CASES = DEEPAGENTS / "evals" / "fixtures" / "benchmark" / "cases.json"
P14_RUN = DEEPAGENTS / "evals" / "reports" / "pilot-v1"
P14_REVIEWS = DEEPAGENTS / "evals" / "fixtures" / "benchmark" / "manual_reviews_p15.json"
CASE_MAP = PACKAGE_ROOT / "p14-case-map.v1.json"


def _inputs():
    return (
        json.loads((P14_RUN / "manifest.json").read_text(encoding="utf-8")),
        load_dataset(PACKAGE_ROOT / "candidate-cases.v1.jsonl"),
        load_benchmark_cases(P14_CASES),
        json.loads(CASE_MAP.read_text(encoding="utf-8")),
        json.loads((PACKAGE_ROOT / "source-pins.v1.json").read_text(encoding="utf-8")),
    )


def test_saved_p14_offline_run_validates_and_remains_not_scored():
    args = {
        "manifest_path": P14_RUN / "manifest.json",
        "trials_path": P14_RUN / "trials.jsonl",
        "p14_cases_path": P14_CASES,
        "candidate_cases_path": PACKAGE_ROOT / "candidate-cases.v1.jsonl",
        "case_mapping_path": CASE_MAP,
        "reviews_path": P14_REVIEWS,
    }
    first = integrate_p14_artifacts(**args)
    second = integrate_p14_artifacts(**args)

    assert first == second
    assert first["artifactValidationStatus"] == "VALIDATED"
    assert first["artifactClassification"] == "P14_OFFLINE_OR_SCRIPTED_FIXTURE"
    assert first["caseMapping"]["candidateCaseCount"] == 30
    assert first["caseMapping"]["p14BenchmarkCaseCount"] == 36
    assert first["caseMapping"]["mappedCaseCount"] == 0
    assert first["caseMapping"]["executableCaseCount"] == 0
    assert first["caseMapping"]["fixedOutputDiagnosticCaseCount"] == 5
    assert first["caseMapping"]["unsupportedCaseCount"] == 25
    assert first["mappedTrialBindings"] == []
    assert first["pinnedInputs"]["caseMappingSha256"]
    assert first["p14ReviewDiagnostics"]["seededUnverifiedCount"] == 15
    assert first["p14ReviewDiagnostics"]["p14ExpertVerifiedFlagCount"] == 0
    assert first["p14ReviewDiagnostics"]["usedAsLcsp400Gold"] is False
    assert first["scoringStatus"] == "NOT_SCORED"
    assert first["humanReviewedQualityMetrics"] == "NOT_SCORED"
    assert first["actualExecutionBaseline"] == "NOT_RUN"
    assert all(row["scoringStatus"] == "NOT_SCORED" for row in first["rubricReportsByTargetAndTrial"])


def test_empty_exact_mapping_is_valid_and_stale_snapshots_fail_closed():
    manifest, candidate_cases, p14_cases, mapping, pins = _inputs()

    inventory = validate_case_mapping(
        mapping,
        candidate_cases=candidate_cases,
        p14_cases=p14_cases,
        manifest=manifest,
        source_pins=pins,
    )

    assert inventory["mappedCaseCount"] == 0
    assert inventory["unmappedReasonCounts"] == {
        "NO_EXACT_P14_CASE_MAPPING": 21,
        "P14_DOES_NOT_EXECUTE_RULE_SET_PREPARATION": 4,
        "FIXED_CLAIM_DIAGNOSTIC_NOT_GENERATED_OUTPUT": 5,
    }
    stale_candidate = deepcopy(mapping)
    stale_candidate["pinnedInputs"]["candidateDatasetSha256"] = "0" * 64
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_CANDIDATE_SNAPSHOT_STALE"):
        validate_case_mapping(
            stale_candidate,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
        )

    stale_p14 = deepcopy(mapping)
    stale_p14["pinnedInputs"]["p14CasesDatasetSha256"] = "0" * 64
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_P14_SNAPSHOT_STALE"):
        validate_case_mapping(
            stale_p14,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
        )

    stale_sources = deepcopy(mapping)
    stale_sources["pinnedInputs"]["sourcePinsSha256"] = "0" * 64
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_SOURCE_PINS_STALE"):
        validate_case_mapping(
            stale_sources,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
        )


def test_mapping_rejects_unknown_case_wrong_target_and_wrong_lifecycle_stage():
    manifest, candidate_cases, p14_cases, mapping, pins = _inputs()
    candidate = next(row for row in candidate_cases if row["evaluationTarget"] == "ACTUAL_ASSESSMENT_OUTPUT")
    p14_case = p14_cases[0]
    source = candidate["legalSource"]
    provision = p14_case.legal_provisions[0]
    rule = p14_case.rule_definitions[0]
    entry = {
        "candidateCaseId": candidate["caseId"],
        "p14CaseId": p14_case.case_id,
        "evaluationTarget": candidate["evaluationTarget"],
        "evaluationStage": candidate["stage"],
        "lifecycleStage": p14_case.gold_rubric.stages[0].stage,
        "p14RuleId": rule.rule_id,
        "candidateLegalSource": {
            "sourceId": source["sourceId"],
            "sourceVersion": source["sourceVersion"],
            "provisionRefs": source["provisionRefs"],
            "citations": source["citations"],
        },
        "p14DocumentId": provision.document_id,
        "p14ProvisionLocator": provision.locator,
        "p14ProvisionSha256": provision.content_sha256,
        "p14CorpusId": p14_case.corpus_pin.corpus_id,
        "p14CorpusVersion": p14_case.corpus_pin.version,
        "p14RepositorySnapshot": {
            "repoId": p14_case.repo_pin.repo_id,
            "snapshotKind": p14_case.repo_pin.snapshot_kind,
            "commitSha": p14_case.repo_pin.commit_sha,
        },
        "p14RuleSetVersionId": p14_case.rule_set_pin.rule_set_version_id,
    }

    unknown_case = deepcopy(mapping)
    unknown_case["caseMappings"] = [{**entry, "p14CaseId": "CASE-NOT-PRESENT"}]
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_CASE_NOT_FOUND"):
        validate_case_mapping(
            unknown_case,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
        )

    wrong_stage = deepcopy(mapping)
    wrong_stage["caseMappings"] = [{**entry, "lifecycleStage": "WAITING_FOR_HUMAN"}]
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_LIFECYCLE_STAGE_MISMATCH"):
        validate_case_mapping(
            wrong_stage,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
        )

    wrong_target = deepcopy(mapping)
    wrong_target["caseMappings"] = [{**entry, "evaluationTarget": "FIXED_CLAIM_DIAGNOSTIC"}]
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_EVALUATION_TARGET_MISMATCH"):
        validate_case_mapping(
            wrong_target,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
        )


def test_seeded_or_synthetic_dimension_review_sets_never_enter_actual_review_path(tmp_path):
    seeded = tmp_path / "seeded-reviews.json"
    seeded.write_text(
        json.dumps(
            {
                "reviewSetVersion": "LCSP-400-OBSERVED-OUTPUT-REVIEWS-V1",
                "reviewSetKind": "SEEDED_UNVERIFIED",
                "reviews": [],
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="P14_DIMENSION_REVIEW_SET_INVALID"):
        _load_dimension_reviews(seeded)


def test_p14_artifact_and_review_trial_identity_integrity():
    manifest = json.loads((P14_RUN / "manifest.json").read_text(encoding="utf-8"))
    outcomes = [
        TrialOutcome.model_validate_json(line)
        for line in (P14_RUN / "trials.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    with pytest.raises(ValueError, match="SCORING_DUPLICATE_TRIAL_REJECTED"):
        validate_run_artifacts_for_scoring(
            manifest, [outcomes[0], *outcomes], base_dir=P14_RUN
        )
    with pytest.raises(ValueError, match="SCORING_INCOMPLETE_TRIAL_INVENTORY"):
        validate_run_artifacts_for_scoring(
            manifest, outcomes[:-1], base_dir=P14_RUN
        )

    reviews = load_manual_reviews(P14_REVIEWS)
    with pytest.raises(ValueError, match="P14_MANUAL_REVIEW_DUPLICATE_TRIAL"):
        _validate_unique_review_trials([reviews[0], reviews[0]])


def test_output_review_cannot_be_reused_for_another_trial_or_digest():
    binding = {
        "runId": "run-a",
        "manifestSha256": "a" * 64,
        "candidateCaseId": "candidate-a",
        "p14CaseId": "CASE-01",
        "evaluationStage": "ASSESSMENT_ROOT",
        "lifecycleStage": "INITIAL",
        "trialIndex": 0,
        "threadId": "thread-0",
        "traceSha256": "b" * 64,
        "observedOutputSha256": "c" * 64,
        "repositoryCommitSha": "d" * 40,
        "corpusId": "corpus-a",
        "corpusVersion": "v1",
        "ruleSetVersionId": "rules-v1",
        "modelRoute": "route-a",
        "instructionBundleDigest": "instruction-a",
        "legalSourceId": "source-a",
        "legalSourceVersion": "source-v1",
        "legalProvisionRefs": ["provision-a"],
        "legalCitations": ["Article 1"],
        "p14RuleId": "rule-a",
    }
    for field, value in (("trialIndex", 1), ("observedOutputSha256", "e" * 64)):
        row = {
            "candidateCaseId": "candidate-a",
            "p14CaseId": "CASE-01",
            "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
            "evaluationStage": "ASSESSMENT_ROOT",
            "lifecycleStage": "INITIAL",
            "trialIndex": 0,
            "p14Binding": {**binding, field: value},
            "humanJudgments": {},
        }
        with pytest.raises(ValueError, match="P14_DIMENSION_REVIEW_OUTPUT_BINDING_MISMATCH"):
            _validate_dimension_review(row, binding, {})


def test_p14_workflow_uses_review_overlay_without_mutating_candidate_snapshot(tmp_path):
    candidate_path = PACKAGE_ROOT / "candidate-cases.v1.jsonl"
    candidate_cases = load_dataset(candidate_path)
    case = candidate_cases[0]
    expectations = {
        field: value
        for field, value in case["expected"].items()
        if value is not None
    }
    judgments = [
        {
            "dimension": {
                "applicability": "APPLICABILITY",
                "compliance": "COMPLIANCE",
                "actor": "ACTOR",
                "conditions": "CONDITIONS",
                "exceptions": "EXCEPTIONS",
                "evidenceSufficiency": "EVIDENCE_SUFFICIENCY",
                "unsupportedConclusion": "UNSUPPORTED_CONCLUSION",
            }[field],
            "label": value["label"],
            "rationale": "Independent legal-gold review for lifecycle regression fixture.",
        }
        for field, value in expectations.items()
    ]
    reviewer = {
        "reviewerType": "HUMAN",
        "reviewerId": "reviewer-p14-lifecycle-test",
        "identityVerificationRef": "https://reviews.acme.com/record/p14-lifecycle-test",
        "reviewedAt": "2026-11-28T10:00:00Z",
        "decision": "CONFIRM",
        "dimensionsReviewed": [row["dimension"] for row in judgments],
        "dimensionJudgments": judgments,
    }
    overlay = {
        "overlayVersion": "LCSP-400-REVIEW-OVERLAY-V1",
        "candidateDatasetSha256": _digest(candidate_cases),
        "caseReviews": [
            {
                "caseId": case["caseId"],
                "candidateRecordSha256": _digest(case),
                "reviewStatus": "REVIEWED",
                "reviewers": [reviewer],
                "reviewerDisagreements": [],
                "adjudication": None,
                "uncertaintyReason": None,
                "exclusionReason": None,
                "expectedOverrides": {},
            }
        ],
    }
    overlay_path = tmp_path / "review-overlay.json"
    overlay_path.write_text(json.dumps(overlay), encoding="utf-8")

    report = integrate_p14_artifacts(
        manifest_path=P14_RUN / "manifest.json",
        trials_path=P14_RUN / "trials.jsonl",
        p14_cases_path=P14_CASES,
        candidate_cases_path=candidate_path,
        case_mapping_path=CASE_MAP,
        reviews_path=P14_REVIEWS,
        review_overlay_path=overlay_path,
    )

    assert report["annotationReviewInventory"]["reviewStatusCounts"]["REVIEWED"] == 1
    assert report["annotationReviewInventory"]["candidateAnnotationCount"] == 29
    assert report["annotationReviewInventory"]["reviewAuthenticity"] == "NOT_AUTHENTICATED_BY_TOOL"
    assert report["reviewOverlaySha256"]
    assert all(row["reviewStatus"] == "CANDIDATE" for row in load_dataset(candidate_path))
