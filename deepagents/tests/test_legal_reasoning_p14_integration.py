"""Offline integration and exact case-mapping tests for the LCSP-400 P14 adapter."""

from __future__ import annotations

import json
import shutil
import subprocess
from copy import deepcopy
from hashlib import sha256
from pathlib import Path

import pytest

from evals.benchmark_runner import load_benchmark_cases, load_manual_reviews
from evals.benchmark_schema import RunConfig, TrialOutcome
from evals.cli import main as p14_cli_main
from evals.legal_reasoning.p14_adapter import (
    _load_dimension_reviews,
    _validate_dimension_review,
    _validate_unique_review_trials,
    integrate_p14_artifacts,
    validate_case_mapping,
)
from evals.legal_reasoning.p14_cohort import load_cohort, prepare_case_subset
from evals.legal_reasoning.review_overlay import _digest
from evals.legal_reasoning.scorer import _canonical_sha256
from evals.legal_reasoning.splits import build_split_manifest, load_split_manifest
from evals.legal_reasoning.validation import PACKAGE_ROOT, load_dataset
from evals.scorer import validate_run_artifacts_for_scoring

DEEPAGENTS = Path(__file__).resolve().parents[1]
P14_CASES_SOURCE = DEEPAGENTS / "evals" / "fixtures" / "benchmark" / "cases.json"
P14_REVIEWS = DEEPAGENTS / "evals" / "fixtures" / "benchmark" / "manual_reviews_p15.json"
CASE_MAP = PACKAGE_ROOT / "p14-case-map.v2.json"
COHORT = PACKAGE_ROOT / "p14-shared-cohort.v1.json"
SPLITS = PACKAGE_ROOT / "evaluation-splits.v1.json"


def test_run_config_accepts_only_full_git_object_ids():
    expected = "a" * 40
    assert RunConfig(mode="SCRIPTED", git_commit_sha=expected).git_commit_sha == expected
    with pytest.raises(ValueError, match="INVALID_GIT_COMMIT_SHA"):
        RunConfig(mode="SCRIPTED", git_commit_sha="abcdef1")


@pytest.fixture(scope="module")
def saved_p14_run(tmp_path_factory):
    """Generate genuine P14 SCRIPTED traces from the exact shared cohort through the real runner."""
    tmp_path = tmp_path_factory.mktemp("lcsp400-p14-scripted")
    cases_path = tmp_path / "p14-cases.json"
    prepare_case_subset(P14_CASES_SOURCE, COHORT, cases_path)
    run_id = "lcsp400-p14-scripted-test"
    output_dir = tmp_path / "p14-runs"
    git_commit_sha = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=DEEPAGENTS, text=True
    ).strip()
    assert p14_cli_main(
        [
            "run",
            "--cases",
            str(cases_path),
            "--mode",
            "SCRIPTED",
            "--split",
            "ALL",
            "--trials",
            "2",
            "--k",
            "1",
            "--run-id",
            run_id,
            "--git-commit-sha",
            git_commit_sha,
            "--output-dir",
            str(output_dir),
            "--evaluation-split-manifest",
            str(SPLITS),
        ]
    ) == 0
    return output_dir / run_id


def _inputs(saved_p14_run):
    p14_cases_path = saved_p14_run.parent.parent / "p14-cases.json"
    return (
        json.loads((saved_p14_run / "manifest.json").read_text(encoding="utf-8")),
        load_dataset(PACKAGE_ROOT / "candidate-cases.v1.jsonl"),
        load_benchmark_cases(p14_cases_path),
        json.loads(CASE_MAP.read_text(encoding="utf-8")),
        json.loads((PACKAGE_ROOT / "source-pins.v1.json").read_text(encoding="utf-8")),
    )


def _integration_args(saved_p14_run, **overrides):
    p14_cases_path = overrides.pop(
        "p14_cases_path", saved_p14_run.parent.parent / "p14-cases.json"
    )
    return {
        "manifest_path": saved_p14_run / "manifest.json",
        "trials_path": saved_p14_run / "trials.jsonl",
        "p14_cases_path": p14_cases_path,
        "candidate_cases_path": PACKAGE_ROOT / "candidate-cases.v1.jsonl",
        "case_mapping_path": CASE_MAP,
        **overrides,
    }


def _test_review_overlay(path: Path, records: list[dict]) -> Path:
    """Create an explicitly test-only review-state simulation for NOT_SCORED gate tests."""
    record = records[0]
    field_to_dimension = {
        "applicability": "APPLICABILITY",
        "compliance": "COMPLIANCE",
        "actor": "ACTOR",
        "conditions": "CONDITIONS",
        "exceptions": "EXCEPTIONS",
        "evidenceSufficiency": "EVIDENCE_SUFFICIENCY",
        "unsupportedConclusion": "UNSUPPORTED_CONCLUSION",
    }
    judgments = [
        {
            "dimension": field_to_dimension[field],
            "label": value["label"],
            "rationale": "Synthetic review lifecycle test; not human review evidence.",
        }
        for field, value in record["expected"].items()
        if value is not None
    ]
    reviewer = {
        "reviewerType": "HUMAN",
        "reviewerId": "test-reviewer-1",
        "identityVerificationRef": "https://reviews.acme.com/records/r3-review-lifecycle-test-only",
        "reviewedAt": "2026-11-28T10:00:00Z",
        "decision": "CONFIRM",
        "dimensionsReviewed": [row["dimension"] for row in judgments],
        "dimensionJudgments": judgments,
    }
    overlay = {
        "overlayVersion": "LCSP-400-REVIEW-OVERLAY-V1",
        "candidateDatasetSha256": _digest(records),
        "caseReviews": [
            {
                "caseId": record["caseId"],
                "candidateRecordSha256": _digest(record),
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
    path.write_text(json.dumps(overlay, ensure_ascii=False), encoding="utf-8")
    return path


def _copy_run_with_trace_mutation(saved_p14_run: Path, tmp_path: Path, case_id: str, stage: str, mutate):
    """Copy one real P14 run and mutate one saved trace while keeping its trial index explicit."""
    copied = tmp_path / "copied-run"
    shutil.copytree(saved_p14_run, copied)
    trial_path = copied / "trials.jsonl"
    trial_rows = [json.loads(line) for line in trial_path.read_text(encoding="utf-8").splitlines() if line]
    target = next(row for row in trial_rows if row["case_id"] == case_id and row["stage"] == stage)
    trace_path = copied / target["trace_path"]
    trace = json.loads(trace_path.read_text(encoding="utf-8"))
    mutate(trace)
    trace_bytes = (json.dumps(trace, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    trace_path.write_bytes(trace_bytes)
    target["trace_sha256"] = sha256(trace_bytes).hexdigest()
    trial_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in trial_rows),
        encoding="utf-8",
    )
    return copied


def test_saved_p14_offline_run_validates_and_remains_not_scored(saved_p14_run):
    p14_cases_path = saved_p14_run.parent.parent / "p14-cases.json"
    args = {
        "manifest_path": saved_p14_run / "manifest.json",
        "trials_path": saved_p14_run / "trials.jsonl",
        "p14_cases_path": p14_cases_path,
        "candidate_cases_path": PACKAGE_ROOT / "candidate-cases.v1.jsonl",
        "case_mapping_path": CASE_MAP,
    }
    first = integrate_p14_artifacts(**args)
    second = integrate_p14_artifacts(**args)

    assert first == second
    assert first["artifactValidationStatus"] == "VALIDATED"
    assert first["artifactProvenanceStatus"] == "VALIDATED_P14_ARTIFACT_BYTES"
    assert first["verifiedArtifactReport"] is True
    assert first["verifiedSemanticMetrics"] is False
    assert first["artifactClassification"] == "P14_SCRIPTED_EXECUTION_ARTIFACTS"
    assert first["runMetadata"]["repositoryCommitSha"] == json.loads(
        (saved_p14_run / "manifest.json").read_text(encoding="utf-8")
    )["gitCommitSha"]
    assert first["caseMapping"]["candidateCaseCount"] == 30
    assert first["caseMapping"]["p14BenchmarkCaseCount"] == 3
    assert first["caseMapping"]["sharedExecutableCandidateCount"] == 3
    assert first["caseMapping"]["mappedCaseCount"] == 3
    assert first["caseMapping"]["mappedCandidateLegalGoldCaseCount"] == 0
    assert first["caseMapping"]["executableCaseCount"] == 3
    assert first["caseMapping"]["mappedTrialCount"] == 6
    assert first["caseMapping"]["outputAvailableCount"] == 6
    assert first["caseMapping"]["fixedOutputDiagnosticCaseCount"] == 5
    assert first["caseMapping"]["unsupportedCaseCount"] == 25
    assert len(first["mappedTrialBindings"]) == 6
    assert first["scriptedExecutionVerification"] == "PASS"
    assert first["runMetadata"]["mode"] == "SCRIPTED"
    assert first["runMetadata"]["splitManifestSha256"] == load_split_manifest(SPLITS)["splitDigest"]
    assert first["humanReviewedQualityMetrics"] == "NOT_SCORED"
    assert first["reviewedGoldDenominator"] == 0
    assert len(first["normalizedObservedOutputs"]) == 6
    hitl_predictions = [row for row in first["normalizedObservedOutputs"] if row["p14CaseId"] == "CASE-02"]
    assert {row["trialIndex"] for row in hitl_predictions} == {0, 1}
    assert all(row["hitl"]["state"] == "RESOLVED" for row in hitl_predictions)
    assert all(row["reviewPayload"]["assessmentDecisions"] for row in hitl_predictions)
    assert all(row["reviewPayload"]["targetRuleIds"] == ["ER-DEMO-02"] for row in hitl_predictions)
    assert all(row["reviewPayload"]["hitl"]["resolvedRequests"] for row in hitl_predictions)
    assert all(row["reviewPayload"]["lifecycleHistory"] for row in hitl_predictions)
    assert first["pinnedInputs"]["caseMappingSha256"]
    assert first["p14ReviewDiagnostics"]["seededUnverifiedCount"] == 0
    assert first["p14ReviewDiagnostics"]["p14ExpertVerifiedFlagCount"] == 0
    assert first["p14ReviewDiagnostics"]["usedAsLcsp400Gold"] is False
    assert first["scoringStatus"] == "NOT_SCORED"
    assert first["humanReviewedQualityMetrics"] == "NOT_SCORED"
    assert first["actualExecutionBaseline"] == "NOT_RUN"
    assert all(row["scoringStatus"] == "NOT_SCORED" for row in first["rubricReportsByTargetAndTrial"])
    assert first["executionCohort"] == {
        "mappingStatus": "MAPPED",
        "mappedCaseCount": 3,
        "executedCaseCount": 3,
        "notExecutedCaseCount": 0,
        "expectedTrialCount": 6,
        "executedTrialCount": 6,
        "notExecutedTrialCount": 0,
        "executedMissingOutputCount": 0,
        "outputAvailableCount": 6,
        "scoringEligibleCaseCount": 0,
        "trialAggregationPolicy": "REPORT_EACH_TRIAL_SEPARATELY_NO_AGGREGATION",
    }

    stale_review_args = {**args, "reviews_path": P14_REVIEWS}
    with pytest.raises(ValueError, match="MANUAL_REVIEW_RUN_MISMATCH"):
        integrate_p14_artifacts(**stale_review_args)


def test_empty_exact_mapping_is_valid_and_stale_snapshots_fail_closed(saved_p14_run):
    manifest, candidate_cases, p14_cases, mapping, pins = _inputs(saved_p14_run)
    cohort = load_cohort(COHORT)
    split_manifest = load_split_manifest(SPLITS)
    empty_mapping = deepcopy(mapping)
    empty_mapping["caseMappings"] = []

    inventory = validate_case_mapping(
        empty_mapping,
        candidate_cases=candidate_cases,
        p14_cases=p14_cases,
        manifest=manifest,
        source_pins=pins,
        shared_cohort=cohort,
        split_manifest=split_manifest,
    )

    assert inventory["mappedCaseCount"] == 0
    assert inventory["sharedExecutableCandidateCount"] == 3
    assert inventory["mappedCandidateLegalGoldCaseCount"] == 0
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
            shared_cohort=cohort,
            split_manifest=split_manifest,
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
            shared_cohort=cohort,
            split_manifest=split_manifest,
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
            shared_cohort=cohort,
            split_manifest=split_manifest,
        )


def test_mapping_rejects_unknown_case_wrong_target_and_wrong_lifecycle_stage(saved_p14_run):
    manifest, candidate_cases, p14_cases, mapping, pins = _inputs(saved_p14_run)
    cohort = load_cohort(COHORT)
    split_manifest = load_split_manifest(SPLITS)
    entry = mapping["caseMappings"][0]

    unknown_case = deepcopy(mapping)
    unknown_case["caseMappings"] = [{**entry, "cohortCaseId": "unknown-cohort"}]
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_CASE_NOT_FOUND"):
        validate_case_mapping(
            unknown_case,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
            shared_cohort=cohort,
            split_manifest=split_manifest,
        )

    wrong_stage = deepcopy(mapping)
    wrong_stage["caseMappings"] = [{**entry, "lifecycleStage": "WAITING_FOR_HUMAN"}]
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_COHORT_BINDING_MISMATCH"):
        validate_case_mapping(
            wrong_stage,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
            shared_cohort=cohort,
            split_manifest=split_manifest,
        )

    wrong_target = deepcopy(mapping)
    wrong_target["caseMappings"] = [{**entry, "evaluationTarget": "FIXED_CLAIM_DIAGNOSTIC"}]
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_ENTRY_INVALID"):
        validate_case_mapping(
            wrong_target,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
            shared_cohort=cohort,
            split_manifest=split_manifest,
        )

    independently_pinned_but_misbound = deepcopy(mapping)
    independently_pinned_but_misbound["caseMappings"][0]["p14CaseId"] = "CASE-17"
    with pytest.raises(ValueError, match="P14_CASE_MAPPING_COHORT_BINDING_MISMATCH"):
        validate_case_mapping(
            independently_pinned_but_misbound,
            candidate_cases=candidate_cases,
            p14_cases=p14_cases,
            manifest=manifest,
            source_pins=pins,
            shared_cohort=cohort,
            split_manifest=split_manifest,
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


def test_p14_artifact_and_review_trial_identity_integrity(saved_p14_run):
    manifest = json.loads((saved_p14_run / "manifest.json").read_text(encoding="utf-8"))
    outcomes = [
        TrialOutcome.model_validate_json(line)
        for line in (saved_p14_run / "trials.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    with pytest.raises(ValueError, match="SCORING_DUPLICATE_TRIAL_REJECTED"):
        validate_run_artifacts_for_scoring(
            manifest, [outcomes[0], *outcomes], base_dir=saved_p14_run
        )
    with pytest.raises(ValueError, match="SCORING_INCOMPLETE_TRIAL_INVENTORY"):
        validate_run_artifacts_for_scoring(
            manifest, outcomes[:-1], base_dir=saved_p14_run
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


def test_p14_workflow_uses_review_overlay_without_mutating_candidate_snapshot(
    tmp_path, saved_p14_run
):
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
        manifest_path=saved_p14_run / "manifest.json",
        trials_path=saved_p14_run / "trials.jsonl",
        p14_cases_path=saved_p14_run.parent.parent / "p14-cases.json",
        candidate_cases_path=candidate_path,
        case_mapping_path=CASE_MAP,
        review_overlay_path=overlay_path,
    )

    assert report["annotationReviewInventory"]["reviewStatusCounts"]["REVIEWED"] == 1
    assert report["annotationReviewInventory"]["candidateAnnotationCount"] == 29
    assert report["annotationReviewInventory"]["reviewAuthenticity"] == "NOT_AUTHENTICATED_BY_TOOL"
    assert report["reviewOverlaySha256"]
    assert all(row["reviewStatus"] == "CANDIDATE" for row in load_dataset(candidate_path))


def test_missing_observed_output_is_counted_as_executed_missing_output(tmp_path, saved_p14_run):
    copied = _copy_run_with_trace_mutation(
        saved_p14_run,
        tmp_path,
        "CASE-01",
        "INITIAL",
        lambda trace: trace.pop("observedOutput"),
    )
    trial_rows = [
        json.loads(line)
        for line in (copied / "trials.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    target = next(row for row in trial_rows if row["case_id"] == "CASE-01" and row["stage"] == "INITIAL")
    trace_path = copied / target["trace_path"]
    trace = json.loads(trace_path.read_text(encoding="utf-8"))
    trace.pop("observedOutputSha256", None)
    trace_bytes = (json.dumps(trace, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    trace_path.write_bytes(trace_bytes)
    target["trace_sha256"] = sha256(trace_bytes).hexdigest()
    (copied / "trials.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in trial_rows),
        encoding="utf-8",
    )
    report = integrate_p14_artifacts(
        **_integration_args(
            copied,
            p14_cases_path=saved_p14_run.parent.parent / "p14-cases.json",
            manifest_path=copied / "manifest.json",
            trials_path=copied / "trials.jsonl",
        )
    )

    missing = [row for row in report["caseExecutionRecords"] if row["executionStatus"] == "EXECUTED_MISSING_OUTPUT"]
    assert report["caseMapping"]["executedMissingOutputCount"] == 1
    assert len(missing) == 1
    assert missing[0]["scoringStatus"] == "NOT_SCORED"
    assert report["scoringStatus"] == "NOT_SCORED"


def test_observed_output_digest_and_outcome_binding_tampering_fail_closed(tmp_path, saved_p14_run):
    changed_digest = _copy_run_with_trace_mutation(
        saved_p14_run,
        tmp_path / "digest",
        "CASE-01",
        "INITIAL",
        lambda trace: trace.update(observedOutputSha256="0" * 64),
    )
    with pytest.raises(ValueError, match="P14_OBSERVED_OUTPUT_DIGEST_MISMATCH"):
        integrate_p14_artifacts(
            **_integration_args(
                changed_digest,
                p14_cases_path=saved_p14_run.parent.parent / "p14-cases.json",
                manifest_path=changed_digest / "manifest.json",
                trials_path=changed_digest / "trials.jsonl",
            )
        )

    def break_nested_outcome_binding(trace):
        output_binding = trace["observedOutput"]["outcomeBinding"]
        output_binding["passed"] = not output_binding["passed"]
        trace["observedOutputSha256"] = _canonical_sha256(trace["observedOutput"])

    changed_binding = _copy_run_with_trace_mutation(
        saved_p14_run,
        tmp_path / "binding",
        "CASE-01",
        "INITIAL",
        break_nested_outcome_binding,
    )
    with pytest.raises(ValueError, match="P14_OBSERVED_OUTPUT_OUTCOME_MISMATCH"):
        integrate_p14_artifacts(
            **_integration_args(
                changed_binding,
                p14_cases_path=saved_p14_run.parent.parent / "p14-cases.json",
                manifest_path=changed_binding / "manifest.json",
                trials_path=changed_binding / "trials.jsonl",
            )
        )

    def remove_required_review_content(trace):
        trace["observedOutput"].pop("facts")
        trace["observedOutputSha256"] = _canonical_sha256(trace["observedOutput"])

    missing_content = _copy_run_with_trace_mutation(
        saved_p14_run,
        tmp_path / "missing-content",
        "CASE-01",
        "INITIAL",
        remove_required_review_content,
    )
    with pytest.raises(TypeError, match="P14_OBSERVED_OUTPUT_CONTENT_INVALID"):
        integrate_p14_artifacts(
            **_integration_args(
                missing_content,
                p14_cases_path=saved_p14_run.parent.parent / "p14-cases.json",
                manifest_path=missing_content / "manifest.json",
                trials_path=missing_content / "trials.jsonl",
            )
        )


def test_changed_trace_bytes_and_unexecuted_trials_remain_visible(tmp_path, saved_p14_run):
    changed_trace = tmp_path / "changed-trace"
    shutil.copytree(saved_p14_run, changed_trace)
    trial_rows = [
        json.loads(line)
        for line in (changed_trace / "trials.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    trace_path = changed_trace / trial_rows[0]["trace_path"]
    trace_path.write_bytes(trace_path.read_bytes() + b" ")
    with pytest.raises(ValueError, match="SCORING_TRACE_DIGEST_MISMATCH"):
        integrate_p14_artifacts(
            **_integration_args(
                changed_trace,
                p14_cases_path=saved_p14_run.parent.parent / "p14-cases.json",
                manifest_path=changed_trace / "manifest.json",
                trials_path=changed_trace / "trials.jsonl",
            )
        )

    incomplete = tmp_path / "incomplete-run"
    shutil.copytree(saved_p14_run, incomplete)
    kept = [row for row in trial_rows if row["case_id"] != "CASE-17"]
    (incomplete / "trials.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in kept),
        encoding="utf-8",
    )
    report = integrate_p14_artifacts(
        **_integration_args(
            incomplete,
            p14_cases_path=saved_p14_run.parent.parent / "p14-cases.json",
            manifest_path=incomplete / "manifest.json",
            trials_path=incomplete / "trials.jsonl",
        )
    )

    assert report["artifactValidationStatus"] == "INCOMPLETE_EXECUTION"
    assert report["missingExpectedTrialCount"] == 2
    assert report["executionCohort"]["notExecutedCaseCount"] == 1
    assert report["executionCohort"]["notExecutedTrialCount"] == 2
    assert sum(row["executionStatus"] == "NOT_EXECUTED" for row in report["caseExecutionRecords"]) == 2
    assert report["scoringStatus"] == "NOT_SCORED"


def test_zero_and_partial_mapping_cohorts_do_not_become_missing_or_scored(tmp_path, saved_p14_run):
    _, candidates, _, mapping, _ = _inputs(saved_p14_run)
    reviewed_overlay = _test_review_overlay(tmp_path / "reviewed-overlay.json", candidates)
    empty_mapping = deepcopy(mapping)
    empty_mapping["caseMappings"] = []
    empty_mapping_path = tmp_path / "empty-map.json"
    empty_mapping_path.write_text(json.dumps(empty_mapping), encoding="utf-8")
    empty_report = integrate_p14_artifacts(
        **_integration_args(
            saved_p14_run,
            case_mapping_path=empty_mapping_path,
            review_overlay_path=reviewed_overlay,
        )
    )

    assert empty_report["annotationReviewInventory"]["reviewStatusCounts"]["REVIEWED"] == 1
    assert empty_report["caseMapping"]["mappedCaseCount"] == 0
    assert empty_report["executionCohort"]["mappingStatus"] == "NO_EXECUTABLE_MAPPING"
    assert empty_report["scoringStatus"] == "NOT_SCORED"
    assert empty_report["reviewedGoldDenominator"] == 0
    assert empty_report["humanReviewedQualityMetrics"] == "NOT_SCORED"

    partial_mapping = deepcopy(mapping)
    partial_mapping["caseMappings"] = partial_mapping["caseMappings"][:1]
    partial_mapping_path = tmp_path / "partial-map.json"
    partial_mapping_path.write_text(json.dumps(partial_mapping), encoding="utf-8")
    partial = integrate_p14_artifacts(
        **_integration_args(saved_p14_run, case_mapping_path=partial_mapping_path)
    )
    assert partial["caseMapping"]["mappedCaseCount"] == 1
    assert partial["executionCohort"]["executedCaseCount"] == 1
    assert partial["executionCohort"]["executedTrialCount"] == 2
    assert partial["executionCohort"]["scoringEligibleCaseCount"] == 0
    assert partial["scoringStatus"] == "NOT_SCORED"


def test_counterfactual_membership_cannot_leak_across_pinned_split_groups():
    candidates = [
        {
            "caseId": "pair-left",
            "legalSource": {"sourceId": "source-a", "provisionRefs": ["ARTICLE_A"]},
            "counterfactualPair": {"pairId": "pair-1", "role": "base"},
        },
        {
            "caseId": "pair-right",
            "legalSource": {"sourceId": "source-b", "provisionRefs": ["ARTICLE_B"]},
            "counterfactualPair": {"pairId": "pair-1", "role": "counterfactual"},
        },
    ]
    cohort = {"cases": [], "cohortSha256": "test-only-cohort"}
    split = build_split_manifest(candidates, cohort)

    assert len(split["groups"]) == 1
    assert split["groups"][0]["caseIds"] == ["pair-left", "pair-right"]
    assert split["splitDigest"] == build_split_manifest(candidates, cohort)["splitDigest"]
    changed = deepcopy(candidates)
    changed[1]["counterfactualPair"]["pairId"] = "different-pair"
    assert build_split_manifest(changed, cohort)["splitDigest"] != split["splitDigest"]
