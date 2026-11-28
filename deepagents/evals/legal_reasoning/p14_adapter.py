"""Thin adapter from saved P14 artifacts to the LCSP-400 deterministic scorer."""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from evals.benchmark_runner import (
    DEEPAGENTS_ROOT,
    _hash_repo_fixture_tree,
    load_benchmark_cases,
    load_manual_reviews,
)
from evals.benchmark_schema import BenchmarkCase, ManualReviewRecord, TrialOutcome
from evals.legal_reasoning.p14_cohort import (
    cohort_digest,
    fixture_fingerprints,
    load_cohort,
)
from evals.legal_reasoning.review_overlay import (
    REVIEW_OVERLAY_PATH,
    merge_review_overlay,
)
from evals.legal_reasoning.scorer import _assessment_domain_labels, _canonical_sha256
from evals.legal_reasoning.splits import load_split_manifest, validate_split_membership
from evals.legal_reasoning.validation import PACKAGE_ROOT, load_dataset
from evals.run_manifest import stable_hash
from evals.scorer import (
    build_trial_metadata_map,
    score_manual_reviews,
    validate_run_artifacts_for_scoring,
)

MAPPING_VERSION = "LCSP-400-P14-CASE-MAP-V2"
ASSESSMENT_VERDICT_MAP = {
    "APPLICABLE_COMPLIANT": (
        "APPLICABLE", "COMPLIANT", "APPLICABLE", "SUPPORTED_COMPLIANCE"
    ),
    "APPLICABLE_NON_COMPLIANT": (
        "APPLICABLE", "NON_COMPLIANT", "APPLICABLE", "SUPPORTED_NON_COMPLIANCE"
    ),
    "NOT_APPLICABLE": (
        "NOT_APPLICABLE", None, "NOT_APPLICABLE", "NOT_APPLICABLE"
    ),
    "UNRESOLVED": ("UNRESOLVED", "UNRESOLVED", "UNRESOLVED", "UNRESOLVED"),
}


def integrate_p14_artifacts(
    *,
    manifest_path: str | Path,
    trials_path: str | Path,
    p14_cases_path: str | Path,
    candidate_cases_path: str | Path,
    case_mapping_path: str | Path,
    reviews_path: str | Path | None = None,
    dimension_reviews_path: str | Path | None = None,
    review_overlay_path: str | Path | None = None,
    rubric_path: str | Path | None = None,
    source_pins_path: str | Path | None = None,
    shared_cohort_path: str | Path | None = None,
    split_manifest_path: str | Path | None = None,
) -> dict[str, Any]:
    """Business purpose: Validate saved P14 execution artifacts and score only exact LCSP-400 mappings.

    Business rules:
    - P14 artifacts must pass the existing manifest, trial-inventory, and trace-integrity validator.
    - Candidate-to-P14 mappings are explicit and pinned to the exact case, legal source, rule, lifecycle,
      corpus, repository snapshot, and dataset fingerprints; approximate matches are forbidden.
    - Repeated P14 trials remain separate score reports, while seeded P14 reviews remain diagnostics only.
    - Only explicit Assessment Root categorical verdicts map to applicability/compliance; other dimensions
      require a separate bound human judgment and are never inferred from combined verdicts.
    - OFFLINE_FIXTURE or SCRIPTED artifacts are not represented as an actual live LCSP baseline.

    Execution flow:
    1. Load candidate/P14 cases, run manifest, trial outcomes, review records, rubric, source pins, and map.
    2. Validate P14 artifacts with the P14 scorer and verify pinned map hashes and exact mapping fields.
    3. Validate and separately summarize P14 manual-review provenance.
    4. Normalize each mapped outcome per lifecycle stage and trial, then invoke the LCSP-400 scorer by target.
    5. Return deterministic integration, coverage, provenance, and NOT_SCORED/score summaries.

    Failure cases:
    - Stale hashes, malformed mappings, duplicate reviews, foreign run/trial/output bindings, or invalid P14
      artifacts raise a validation exception before rubric metrics are produced.

    Side effects:
    - Reads explicit local evaluation artifacts only; performs no model calls and writes no files.
    """
    manifest = _read_json(Path(manifest_path))
    raw_outcomes = [
        TrialOutcome.model_validate_json(line)
        for line in Path(trials_path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    p14_cases = load_benchmark_cases(Path(p14_cases_path))
    p14_case_by_id = {case.case_id: case for case in p14_cases}
    candidate_cases = load_dataset(candidate_cases_path)
    rubric = _read_json(Path(rubric_path) if rubric_path else PACKAGE_ROOT / "rubric.v1.json")
    source_pins = _read_json(
        Path(source_pins_path) if source_pins_path else PACKAGE_ROOT / "source-pins.v1.json"
    )
    shared_cohort = load_cohort(
        shared_cohort_path or PACKAGE_ROOT / "p14-shared-cohort.v1.json"
    )
    split_manifest = load_split_manifest(
        split_manifest_path or PACKAGE_ROOT / "evaluation-splits.v1.json"
    )
    mapping = _read_json(Path(case_mapping_path))
    effective_candidate_cases = merge_review_overlay(
        candidate_cases,
        review_overlay_path or REVIEW_OVERLAY_PATH,
        rubric,
        source_pins,
    )

    expected_inventory = manifest.get("expectedTrialInventory") or []
    observed_keys = {
        (row.case_id, row.trial_index, row.stage) for row in raw_outcomes
    }
    missing_inventory = [
        row
        for row in expected_inventory
        if (row["caseId"], int(row["trialIndex"]), row["stage"]) not in observed_keys
    ]
    validate_run_artifacts_for_scoring(
        manifest,
        raw_outcomes,
        base_dir=Path(trials_path).parent,
        allow_incomplete=bool(missing_inventory),
    )
    mapping_inventory = validate_case_mapping(
        mapping,
        candidate_cases=candidate_cases,
        p14_cases=p14_cases,
        manifest=manifest,
        source_pins=source_pins,
        shared_cohort=shared_cohort,
        split_manifest=split_manifest,
    )
    split_membership = validate_split_membership(
        split_manifest,
        candidate_cases,
        shared_cohort,
        [case.model_dump() for case in p14_cases],
    )
    reviews = load_manual_reviews(Path(reviews_path) if reviews_path else None)
    _validate_unique_review_trials(reviews)
    p14_review_diagnostics = score_manual_reviews(
        reviews,
        expected_run_id=manifest["runId"],
        trial_metadata_by_key=build_trial_metadata_map(manifest, raw_outcomes),
    )
    dimension_reviews = _load_dimension_reviews(dimension_reviews_path)
    dimension_review_by_key = {
        (row["candidateCaseId"], row["p14CaseId"], row["lifecycleStage"], row["trialIndex"]): row
        for row in dimension_reviews
    }

    normalized_by_trial: dict[tuple[str, str, int], list[dict[str, Any]]] = {}
    execution_records: list[dict[str, Any]] = []
    trial_metadata = build_trial_metadata_map(manifest, raw_outcomes)
    outcomes_by_case_stage: dict[tuple[str, str], list[TrialOutcome]] = {}
    for outcome in raw_outcomes:
        outcomes_by_case_stage.setdefault((outcome.case_id, outcome.stage), []).append(outcome)
    cohort_by_id = {row["cohortCaseId"]: row for row in shared_cohort["cases"]}
    for entry in mapping["caseMappings"]:
        cohort_case = cohort_by_id[entry["cohortCaseId"]]
        p14_case = p14_case_by_id[entry["p14CaseId"]]
        matching_outcomes = outcomes_by_case_stage.get(
            (p14_case.case_id, entry["lifecycleStage"]), []
        )
        expected_target_trials = [
            row for row in expected_inventory
            if row["caseId"] == p14_case.case_id and row["stage"] == entry["lifecycleStage"]
        ]
        present_target_trials = {row.trial_index for row in matching_outcomes}
        for expected_trial in expected_target_trials:
            if int(expected_trial["trialIndex"]) not in present_target_trials:
                execution_records.append(
                    {
                        "cohortCaseId": cohort_case["cohortCaseId"],
                        "p14CaseId": p14_case.case_id,
                        "lifecycleStage": entry["lifecycleStage"],
                        "trialIndex": int(expected_trial["trialIndex"]),
                        "executionStatus": "NOT_EXECUTED",
                        "scoringStatus": "NOT_SCORED",
                    }
                )
        if not expected_target_trials:
            execution_records.append(
                {
                    "cohortCaseId": cohort_case["cohortCaseId"],
                    "p14CaseId": p14_case.case_id,
                    "lifecycleStage": entry["lifecycleStage"],
                    "executionStatus": "NOT_EXECUTED",
                    "scoringStatus": "NOT_SCORED",
                }
            )
        for outcome in matching_outcomes:
            meta = trial_metadata[(outcome.case_id, outcome.stage, outcome.trial_index)]
            trace_path = _resolve_trace(Path(trials_path).parent, outcome.trace_path)
            trace_bytes = trace_path.read_bytes()
            trace_doc = json.loads(trace_bytes.decode("utf-8"))
            if not outcome.trace_sha256 or _sha256_bytes(trace_bytes) != outcome.trace_sha256:
                raise ValueError(f"P14_TRACE_BYTE_DIGEST_MISMATCH:{outcome.case_id}:{outcome.trial_index}")
            output = _observed_output_from_trace(
                trace_doc,
                outcome=outcome,
                p14_case=p14_case,
                mapping_entry=entry,
                outcomes_by_case_stage=outcomes_by_case_stage,
            )
            if output is None:
                execution_records.append(
                    {
                        "cohortCaseId": cohort_case["cohortCaseId"],
                        "p14CaseId": outcome.case_id,
                        "lifecycleStage": outcome.stage,
                        "trialIndex": outcome.trial_index,
                        "executionStatus": "EXECUTED_MISSING_OUTPUT",
                        "traceSha256": outcome.trace_sha256,
                        "scoringStatus": "NOT_SCORED",
                    }
                )
                continue
            output_digest = _canonical_sha256(output)
            binding = _binding_for(
                manifest=manifest,
                outcome=outcome,
                entry=entry,
                p14_case=p14_case,
                output_digest=output_digest,
                trace_digest=outcome.trace_sha256 or "",
                metadata=meta,
            )
            decision = output.get("actualAssessmentDecision") or {}
            decision_body = decision.get("decision", decision) if isinstance(decision, dict) else {}
            raw_dimensions = {
                field: decision_body[field]
                for field in ("applicability", "compliance")
                if field in decision_body
            }
            normalized_applicability, normalized_compliance = _assessment_domain_labels(
                raw_dimensions
            )
            if outcome.actual_verdict == "UNRESOLVED":
                if normalized_applicability is None:
                    normalized_applicability = "UNRESOLVED"
                if normalized_compliance is None:
                    normalized_compliance = "UNRESOLVED"
            applicability = raw_dimensions.get("applicability")
            compliance = raw_dimensions.get("compliance")
            review_key = (
                cohort_case["cohortCaseId"], outcome.case_id, outcome.stage, outcome.trial_index
            )
            dimension_review = dimension_review_by_key.pop(review_key, None)
            human_judgments = (
                _validate_dimension_review(dimension_review, binding, rubric)
                if dimension_review is not None
                else {}
            )
            prediction = {
                "caseId": cohort_case["cohortCaseId"],
                "p14CaseId": outcome.case_id,
                "stage": "ASSESSMENT_ROOT",
                "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
                "observationKind": "GENERATED_LCSP_OUTPUT",
                "rawActualVerdict": outcome.actual_verdict,
                "dimensionPredictions": {
                    "applicability": applicability,
                    "compliance": compliance,
                },
                "normalizationSource": "P14_SAVED_ARTIFACTS",
                "evaluationLabelPredictions": {
                    "applicability": normalized_applicability,
                    "compliance": normalized_compliance,
                },
                "humanJudgments": human_judgments,
                "p14Binding": binding,
                "targetBinding": binding,
                "observedOutputSha256": output_digest,
                "traceSha256": outcome.trace_sha256,
                "assessmentDecision": output.get("actualAssessmentDecision"),
                "evidenceReferences": output.get("evidenceReferences", []),
                "hitl": output.get("hitl", {}),
                "reviewPayload": output,
                "lifecycleStage": outcome.stage,
                "trialIndex": outcome.trial_index,
                "executionStatus": "EXECUTED_OUTPUT_AVAILABLE",
            }
            normalized_by_trial.setdefault(
                ("ACTUAL_ASSESSMENT_OUTPUT", outcome.stage, outcome.trial_index), []
            ).append(prediction)
            execution_records.append(
                {
                    "cohortCaseId": cohort_case["cohortCaseId"],
                    "p14CaseId": outcome.case_id,
                    "lifecycleStage": outcome.stage,
                    "trialIndex": outcome.trial_index,
                    "executionStatus": "EXECUTED_OUTPUT_AVAILABLE",
                    "traceSha256": outcome.trace_sha256,
                    "observedOutputSha256": output_digest,
                    "scoringStatus": "NOT_SCORED_NO_REVIEWED_SHARED_GOLD",
                }
            )

    if dimension_review_by_key:
        raise ValueError("P14_DIMENSION_REVIEW_TARGET_NOT_FOUND")

    mapped_case_ids = {row["cohortCaseId"] for row in mapping["caseMappings"]}
    executed_case_ids = {
        row["cohortCaseId"]
        for row in execution_records
        if row["executionStatus"] != "NOT_EXECUTED"
    }
    mapping_inventory["executableCaseCount"] = len(executed_case_ids)
    mapping_inventory["mappedTrialCount"] = sum(
        1 for row in execution_records
        if row["executionStatus"] in {"EXECUTED_MISSING_OUTPUT", "EXECUTED_OUTPUT_AVAILABLE"}
    )
    mapping_inventory["mappedCaseWithoutTrialCount"] = sum(
        not any(
            row["cohortCaseId"] == case_id
            and row["executionStatus"] != "NOT_EXECUTED"
            for row in execution_records
        )
        for case_id in mapped_case_ids
    )
    mapping_inventory["notExecutedTrialCount"] = sum(
        row["executionStatus"] == "NOT_EXECUTED" for row in execution_records
    )
    mapping_inventory["notExecutedCaseCount"] = mapping_inventory["mappedCaseWithoutTrialCount"]
    mapping_inventory["executedMissingOutputCount"] = sum(
        row["executionStatus"] == "EXECUTED_MISSING_OUTPUT" for row in execution_records
    )
    mapping_inventory["outputAvailableCount"] = sum(
        row["executionStatus"] == "EXECUTED_OUTPUT_AVAILABLE" for row in execution_records
    )
    mapping_inventory["scoringEligibleCaseCount"] = 0
    mapping_inventory["expectedExecutionCount"] = sum(
        1 for row in execution_records
        if row.get("trialIndex") is not None
    )

    rubric_reports = [
        {
            "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
            "scoringStatus": "NOT_SCORED",
            "reason": "SHARED_COHORT_HAS_NO_HUMAN_REVIEWED_LEGAL_GOLD",
            "denominator": 0,
            "macroF1": None,
            "falsePositives": None,
            "falseNegatives": None,
        }
    ]

    p14_mode = raw_outcomes[0].mode if raw_outcomes else manifest.get("runConfig", {}).get("mode", "UNKNOWN")
    seeded_review_count = p14_review_diagnostics["seededUnverified"]["totalReviewed"]
    p14_expert_flagged_count = p14_review_diagnostics["expertVerified"]["totalReviewed"]
    return {
        "integrationReportVersion": "LCSP-400-P14-INTEGRATION-REPORT-V1",
        "artifactValidationStatus": "INCOMPLETE_EXECUTION" if missing_inventory else "VALIDATED",
        "artifactProvenanceStatus": "VALIDATED_P14_ARTIFACT_BYTES"
        if not missing_inventory
        else "VALIDATED_P14_ARTIFACT_BYTES_WITH_INCOMPLETE_EXECUTION",
        "verifiedArtifactReport": True,
        "verifiedSemanticMetrics": False,
        "artifactClassification": {
            "OFFLINE_FIXTURE": "P14_OFFLINE_FIXTURE_ARTIFACTS",
            "SCRIPTED": "P14_SCRIPTED_EXECUTION_ARTIFACTS",
            "LIVE": "P14_LIVE_RUN_ARTIFACTS",
        }.get(p14_mode, "P14_UNKNOWN_MODE_ARTIFACTS"),
        "pinnedInputs": {
            "caseMappingSha256": _canonical_sha256(mapping),
            "candidateDatasetSha256": mapping["pinnedInputs"]["candidateDatasetSha256"],
            "sourcePinsSha256": mapping["pinnedInputs"]["sourcePinsSha256"],
            "p14CasesDatasetSha256": mapping["pinnedInputs"]["p14CasesDatasetSha256"],
            "sharedCohortSha256": mapping["pinnedInputs"]["sharedCohortSha256"],
            "splitManifestSha256": mapping["pinnedInputs"]["splitManifestSha256"],
        },
        "runMetadata": {
            "runId": manifest.get("runId"),
            "manifestSha256": manifest.get("manifestSha256"),
            "mode": p14_mode,
            "trialCount": len(raw_outcomes),
            "p14CasesDatasetSha256": manifest.get("sourcePins", {}).get("casesDatasetSha256"),
            "repositoryCommitSha": manifest.get("gitCommitSha"),
            "modelRoute": (manifest.get("model") or {}).get("configuredModelId"),
            "instructionBundleDigest": _manifest_instruction_digest(manifest),
            "promptSha256": manifest.get("promptsSha256", {}),
            "skillFingerprints": {
                "available": manifest.get("availableSkillsSha256", {}),
                "selected": manifest.get("selectedSkillsSha256", {}),
            },
            "evaluationBudgetAndUsage": manifest.get("usage", {}),
            "sourcePins": manifest.get("sourcePins", {}),
            "splitManifestSha256": split_manifest["splitDigest"],
        },
        "caseMapping": mapping_inventory,
        "executionCohort": {
            "mappingStatus": "MAPPED" if mapped_case_ids else "NO_EXECUTABLE_MAPPING",
            "mappedCaseCount": len(mapped_case_ids),
            "executedCaseCount": len(executed_case_ids),
            "notExecutedCaseCount": mapping_inventory["notExecutedCaseCount"],
            "expectedTrialCount": mapping_inventory["expectedExecutionCount"],
            "executedTrialCount": mapping_inventory["mappedTrialCount"],
            "notExecutedTrialCount": mapping_inventory["notExecutedTrialCount"],
            "executedMissingOutputCount": mapping_inventory["executedMissingOutputCount"],
            "outputAvailableCount": mapping_inventory["outputAvailableCount"],
            "scoringEligibleCaseCount": mapping_inventory["scoringEligibleCaseCount"],
            "trialAggregationPolicy": "REPORT_EACH_TRIAL_SEPARATELY_NO_AGGREGATION",
        },
        "caseExecutionRecords": sorted(
            execution_records,
            key=lambda row: (row["cohortCaseId"], row.get("lifecycleStage", ""), row.get("trialIndex", -1)),
        ),
        "missingExpectedTrialCount": len(missing_inventory),
        "missingExpectedTrials": sorted(
            missing_inventory,
            key=lambda row: (row["caseId"], row["stage"], row["trialIndex"]),
        ),
        "normalizedObservedOutputs": [
            row
            for key in sorted(normalized_by_trial)
            for row in sorted(
                normalized_by_trial[key],
                key=lambda item: (item["caseId"], item["trialIndex"]),
            )
        ],
        "splitInventory": {
            "splitDigest": split_manifest["splitDigest"],
            "caseCounts": split_manifest["splitCaseCounts"],
            "groupCounts": split_manifest["splitGroupCounts"],
            "currentP14CaseMembership": {
                case_id: split_membership[
                    next(row["cohortCaseId"] for row in shared_cohort["cases"] if row["p14CaseId"] == case_id)
                ]
                for case_id in sorted(row.case_id for row in p14_cases)
            },
            "generalizationClaim": "NOT_SUPPORTED_BY_SMALL_SHARED_SCRIPTED_COHORT",
        },
        "mappedTrialBindings": sorted(
            (
                {
                    "candidateCaseId": prediction["caseId"],
                    "p14CaseId": prediction["p14Binding"]["p14CaseId"],
                    "evaluationStage": prediction["p14Binding"]["evaluationStage"],
                    "lifecycleStage": prediction["p14Binding"]["lifecycleStage"],
                    "trialIndex": prediction["p14Binding"]["trialIndex"],
                    "threadId": prediction["p14Binding"]["threadId"],
                    "traceSha256": prediction["p14Binding"]["traceSha256"],
                    "observedOutputSha256": prediction["p14Binding"]["observedOutputSha256"],
                }
                for rows in normalized_by_trial.values()
                for prediction in rows
            ),
            key=lambda row: (
                row["candidateCaseId"], row["lifecycleStage"], row["trialIndex"]
            ),
        ),
        "annotationReviewInventory": _review_inventory(effective_candidate_cases),
        "reviewOverlaySha256": _sha256_file(
            Path(review_overlay_path) if review_overlay_path else REVIEW_OVERLAY_PATH
        ),
        "p14ReviewDiagnostics": {
            "seededUnverifiedCount": seeded_review_count,
            "p14ExpertVerifiedFlagCount": p14_expert_flagged_count,
            "lcsp400HumanJudgmentCount": sum(
                len(row["humanJudgments"]) for row in dimension_reviews
            ),
            "reviewAuthenticity": "NOT_AUTHENTICATED_BY_TOOL",
            "usedAsLcsp400Gold": False,
            "note": "P14's binary verdict review fields do not constitute LCSP-400 dimension judgments. The separate dimension-review contract checks structure and trace binding, not reviewer authenticity.",
        },
        "rubricReportsByTargetAndTrial": rubric_reports,
        "scoringStatus": "NOT_SCORED"
        if mapping_inventory["scoringEligibleCaseCount"] == 0
        else "SCORED",
        "humanReviewedQualityMetrics": "NOT_SCORED",
        "reviewedGoldDenominator": 0,
        "scoringReason": "NO_REVIEWED_LEGAL_GOLD_FOR_EXACT_EXECUTION_COHORT",
        "scriptedExecutionVerification": "PASS"
        if p14_mode == "SCRIPTED" and mapping_inventory["outputAvailableCount"] > 0
        else "NOT_VERIFIED",
        "actualExecutionBaseline": "NOT_RUN",
    }


def validate_case_mapping(
    mapping: dict[str, Any],
    *,
    candidate_cases: list[dict[str, Any]],
    p14_cases: Sequence[BenchmarkCase],
    manifest: dict[str, Any],
    source_pins: dict[str, Any],
    shared_cohort: dict[str, Any],
    split_manifest: dict[str, Any],
) -> dict[str, Any]:
    """Business purpose: Validate exact identity reuse for the shared P14 engineering cohort.

    Business rules:
    - No GDPR-to-Vietnam or other legal crosswalk is asserted; each cohort row reuses one exact
      synthetic P14 fixture object and is excluded from legal-gold metrics.
    - Legal source/provision, proposition/rule, scenario/HITL, repository tree, lifecycle stage, and
      complete P14 case content are cross-bound by recomputed fingerprints, not keywords or titles.
    - Only synthetic P14 fixtures are allowed, and their jurisdiction marker is explicitly fixture-only.
    - The P14 manifest pins the exact split digest and case snapshot used by the run.

    Execution flow:
    1. Verify candidate, source-pin, cohort, split, and exact P14 case snapshot digests.
    2. Require a one-to-one mapping from each shared cohort ID to its exact P14 case/rule/stage tuple.
    3. Recompute legal text, proposition, scenario, repository-tree, and whole-case fingerprints.
    4. Return separate canonical-candidate and shared-execution inventories.

    Failure cases:
    - Any source, content, rule, scenario, repository, stage, split, lifecycle, or digest mismatch raises
      a stable ValueError before normalization or reporting.

    Side effects:
    - Reads the exact local P14 repository fixture trees to verify their saved manifest pins.
    """
    if not isinstance(mapping, dict) or mapping.get("mappingVersion") != MAPPING_VERSION:
        raise ValueError("P14_CASE_MAPPING_VERSION_INVALID")
    mapping_rows = mapping.get("caseMappings")
    pinned_inputs = mapping.get("pinnedInputs")
    if not isinstance(mapping_rows, list) or not isinstance(pinned_inputs, dict):
        raise TypeError("P14_CASE_MAPPING_STRUCTURE_INVALID")
    p14_case_list = list(p14_cases)
    candidate_digest = _canonical_sha256(candidate_cases)
    p14_digest = stable_hash([case.model_dump() for case in p14_case_list])
    source_digest = _canonical_sha256(source_pins)
    expected_pins = pinned_inputs
    if expected_pins.get("candidateDatasetSha256") != candidate_digest:
        raise ValueError("P14_CASE_MAPPING_CANDIDATE_SNAPSHOT_STALE")
    if expected_pins.get("p14CasesDatasetSha256") != p14_digest:
        raise ValueError("P14_CASE_MAPPING_P14_SNAPSHOT_STALE")
    if expected_pins.get("sourcePinsSha256") != source_digest:
        raise ValueError("P14_CASE_MAPPING_SOURCE_PINS_STALE")
    if manifest.get("sourcePins", {}).get("casesDatasetSha256") != p14_digest:
        raise ValueError("P14_MANIFEST_CASE_SNAPSHOT_MISMATCH")
    if expected_pins.get("sharedCohortSha256") != cohort_digest(shared_cohort):
        raise ValueError("P14_CASE_MAPPING_COHORT_SNAPSHOT_STALE")
    if expected_pins.get("splitManifestSha256") != split_manifest.get("splitDigest"):
        raise ValueError("P14_CASE_MAPPING_SPLIT_SNAPSHOT_STALE")
    if manifest.get("sourcePins", {}).get("caseSplitManifestSha256") != split_manifest.get("splitDigest"):
        raise ValueError("P14_MANIFEST_SPLIT_SNAPSHOT_MISMATCH")

    p14_by_id = {case.case_id: case for case in p14_case_list}
    cohort_by_id = {row["cohortCaseId"]: row for row in shared_cohort["cases"]}
    if set(p14_by_id) != {row["p14CaseId"] for row in shared_cohort["cases"]}:
        raise ValueError("P14_CASE_MAPPING_COHORT_CASE_INVENTORY_MISMATCH")
    seen_cohort: set[str] = set()
    seen_p14: set[str] = set()
    repo_tree_pins: dict[str, dict[str, str]] = {}
    for entry in mapping_rows:
        if not isinstance(entry, dict) or set(entry) != {
            "cohortCaseId", "p14CaseId", "evaluationStage", "lifecycleStage", "p14RuleId"
        }:
            raise ValueError("P14_CASE_MAPPING_ENTRY_INVALID")
        cohort_id = entry["cohortCaseId"]
        p14_id = entry.get("p14CaseId")
        if cohort_id in seen_cohort or p14_id in seen_p14:
            raise ValueError("P14_CASE_MAPPING_DUPLICATE_ID")
        seen_cohort.add(cohort_id)
        seen_p14.add(p14_id)
        cohort_row = cohort_by_id.get(cohort_id)
        p14_case = p14_by_id.get(p14_id)
        if cohort_row is None or p14_case is None:
            raise ValueError("P14_CASE_MAPPING_CASE_NOT_FOUND")
        if (
            entry["p14CaseId"] != cohort_row["p14CaseId"]
            or entry["evaluationStage"] != cohort_row["evaluationStage"]
            or entry["lifecycleStage"] != cohort_row["lifecycleStage"]
            or entry["p14RuleId"] != cohort_row["targetRuleId"]
            or entry["evaluationStage"] != "ASSESSMENT_ROOT"
        ):
            raise ValueError(f"P14_CASE_MAPPING_COHORT_BINDING_MISMATCH:{cohort_id}")
        lifecycle = entry.get("lifecycleStage")
        if lifecycle not in {stage.stage for stage in p14_case.gold_rubric.stages}:
            raise ValueError(f"P14_CASE_MAPPING_LIFECYCLE_STAGE_MISMATCH:{cohort_id}")
        p14_rule = next(
            (rule for rule in p14_case.rule_definitions if rule.rule_id == entry.get("p14RuleId")),
            None,
        )
        if p14_rule is None:
            raise ValueError(f"P14_CASE_MAPPING_RULE_MISMATCH:{cohort_id}")
        provision = p14_case.legal_provisions[0] if len(p14_case.legal_provisions) == 1 else None
        if (
            provision is None
            or cohort_row.get("jurisdiction") != "VN_FIXTURE_LABEL_ONLY"
            or not p14_case.corpus_pin.corpus_id.startswith("vn-")
            or provision.source_kind != "SYNTHETIC_PINNED_LAW"
            or cohort_row.get("sourceKind") != provision.source_kind
            or cohort_row.get("corpusId") != p14_case.corpus_pin.corpus_id
            or cohort_row.get("corpusVersion") != p14_case.corpus_pin.version
            or cohort_row.get("documentId") != provision.document_id
            or cohort_row.get("provisionLocator") != provision.locator
        ):
            raise ValueError(f"P14_CASE_MAPPING_LEGAL_SOURCE_CROSSBIND_MISMATCH:{cohort_id}")
        if cohort_row.get("fixtureFingerprints") != fixture_fingerprints(
            p14_case, lifecycle, p14_rule.rule_id
        ):
            raise ValueError(f"P14_CASE_MAPPING_FIXTURE_CROSSBIND_MISMATCH:{cohort_id}")
        if p14_rule.rule_id not in p14_case.rule_set_pin.rule_ids:
            raise ValueError(f"P14_CASE_MAPPING_RULESET_CROSSBIND_MISMATCH:{cohort_id}")
        repo = p14_case.repo_pin
        repo_tree_pins[repo.repo_id] = {
            "snapshotKind": repo.snapshot_kind,
            "commitSha": repo.commit_sha,
            "treeSha256": _hash_repo_fixture_tree((DEEPAGENTS_ROOT / repo.fixture_dir).resolve()),
        }
        if cohort_row.get("split") != p14_case.split or cohort_row.get("split") not in {"DEV", "HOLDOUT"}:
            raise ValueError(f"P14_CASE_MAPPING_SPLIT_MISMATCH:{cohort_id}")
    for p14_case in p14_case_list:
        repo = p14_case.repo_pin
        repo_tree_pins[repo.repo_id] = {
            "snapshotKind": repo.snapshot_kind,
            "commitSha": repo.commit_sha,
            "treeSha256": _hash_repo_fixture_tree((DEEPAGENTS_ROOT / repo.fixture_dir).resolve()),
        }
    if stable_hash(repo_tree_pins) != manifest.get("sourcePins", {}).get("repoPinsSha256"):
        raise ValueError("P14_CASE_MAPPING_REPOSITORY_TREE_SNAPSHOT_MISMATCH")

    split_members = {
        case_id: group["split"]
        for group in split_manifest["groups"]
        for case_id in group["caseIds"]
    }
    for cohort_row in shared_cohort["cases"]:
        if split_members.get(cohort_row["cohortCaseId"]) != cohort_row["split"]:
            raise ValueError(f"P14_CASE_MAPPING_SPLIT_GROUP_MISMATCH:{cohort_row['cohortCaseId']}")

    target_counts = Counter(row["evaluationTarget"] for row in candidate_cases)
    fixed_diagnostic_count = target_counts.get("FIXED_CLAIM_DIAGNOSTIC", 0)
    rsp_output_count = target_counts.get("RULE_SET_PREPARATION_OUTPUT", 0)
    assessment_output_count = target_counts.get("ACTUAL_ASSESSMENT_OUTPUT", 0)
    mapped = len(mapping_rows)
    return {
        "candidateCaseCount": len(candidate_cases),
        "p14BenchmarkCaseCount": len(p14_case_list),
        "sharedExecutableCandidateCount": len(shared_cohort["cases"]),
        "mappedCaseCount": mapped,
        "mappedSharedExecutableCaseCount": mapped,
        "mappedCandidateLegalGoldCaseCount": 0,
        "fixedOutputDiagnosticCaseCount": fixed_diagnostic_count,
        "unsupportedCaseCount": rsp_output_count + assessment_output_count,
        "excludedDiagnosticCaseCount": fixed_diagnostic_count,
        "assessmentOutputCandidateCount": assessment_output_count,
        "ruleSetPreparationCandidateCount": rsp_output_count,
        "mappingPolicy": "EXACT_SHARED_P14_FIXTURE_IDENTITY_ONLY_NO_LEGAL_CROSSWALK",
        "unmappedReasonCounts": {
            "NO_EXACT_P14_CASE_MAPPING": assessment_output_count,
            "P14_DOES_NOT_EXECUTE_RULE_SET_PREPARATION": rsp_output_count,
            "FIXED_CLAIM_DIAGNOSTIC_NOT_GENERATED_OUTPUT": fixed_diagnostic_count,
        },
    }


def _normalize_assessment_verdict(
    verdict: str,
) -> tuple[str, str | None, str, str]:
    """Business purpose: Map only the P14 Assessment Root verdict contract into rubric labels.

    Business rules:
    - Explicit composite verdicts map to the supported applicability/compliance pair.
    - The first pair is the production-domain representation; the second pair is its rubric-normalized view.
    - P14 UNRESOLVED maps to evaluation-only unresolved labels, not a production status.
    - An unknown non-empty verdict is preserved in both pairs so the scorer counts it as invalid,
      while NOT_APPLICABLE retains its explicit null production compliance value.

    Execution flow:
    1. Return documented production values and rubric labels for a recognized P14 verdict.
    2. Preserve any unrecognized verdict in all fields so scoring records invalid predictions.

    Failure cases:
    - The P14 schema requires a non-empty verdict; an absent verdict is rejected by its artifact validator.

    Side effects:
    - None: pure contract normalization.
    """
    mapped = ASSESSMENT_VERDICT_MAP.get(verdict)
    return mapped if mapped is not None else (verdict, verdict, verdict, verdict)


def _validate_unique_review_trials(reviews: Sequence[ManualReviewRecord]) -> None:
    """Business purpose: Ensure one P14 review record does not ambiguously represent a trial.

    Business rules:
    - A P14 review is uniquely bound to run, case, lifecycle stage, and trial index.
    - Duplicate records cannot be silently deduplicated or selected by file order.

    Execution flow:
    1. Build the stable P14 review key for each record.
    2. Reject a duplicate key before P14 review metrics or LCSP integration runs.

    Failure cases:
    - Duplicate keys raise ValueError with the repeated key.

    Side effects:
    - None: validates an in-memory sequence.
    """
    keys = [(row.run_id, row.case_id, row.stage, row.trial_index) for row in reviews]
    if len(keys) != len(set(keys)):
        raise ValueError("P14_MANUAL_REVIEW_DUPLICATE_TRIAL")


def _review_inventory(candidate_cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Business purpose: Report the effective legal-gold review lifecycle used for P14 scoring.

    Business rules:
    - Counts come from the validated merged annotation snapshot, never constants or P14's binary review status.
    - Candidate, provisional, uncertain, and excluded annotations remain distinct from reviewed gold.

    Execution flow:
    1. Count annotation review states after the pinned overlay has been structurally validated.
    2. Calculate structurally eligible reviewed and adjudicated records and unresolved disagreements.
    3. Return deterministic inventory without asserting reviewer authenticity.

    Failure cases:
    - The caller must provide records already accepted by the review-overlay validator.

    Side effects:
    - None: counts the supplied in-memory annotation records.
    """
    counts = Counter(row["reviewStatus"] for row in candidate_cases)
    return {
        "reviewStatusCounts": dict(sorted(counts.items())),
        "candidateAnnotationCount": counts.get("CANDIDATE", 0),
        "structurallyReviewedAnnotationCount": counts.get("REVIEWED", 0)
        + counts.get("ADJUDICATED", 0),
        "provisionalOrUncertainAnnotationCount": sum(
            counts.get(status, 0) for status in ("INDEPENDENT_REVIEW", "PROVISIONAL", "UNCERTAIN")
        ),
        "excludedAnnotationCount": counts.get("EXCLUDED", 0),
        "unresolvedDisagreementCount": sum(
            1
            for row in candidate_cases
            if row["reviewerDisagreements"] and row["reviewStatus"] != "ADJUDICATED"
        ),
        "reviewAuthenticity": "NOT_AUTHENTICATED_BY_TOOL",
    }


def _sha256_file(path: Path) -> str:
    """Business purpose: Bind an integration report to the exact review-overlay file bytes.

    Business rules:
    - The hash identifies the selected artifact and does not establish its authorship or authenticity.
    - The report never hashes a different default path than the overlay passed to the merge operation.

    Execution flow:
    1. Read the overlay bytes selected by the adapter.
    2. Return their lowercase SHA-256 digest.

    Failure cases:
    - An absent or unreadable overlay raises the underlying file error.

    Side effects:
    - Reads one local file and writes nothing.
    """
    from hashlib import sha256

    return sha256(path.read_bytes()).hexdigest()


def _load_dimension_reviews(path: str | Path | None) -> list[dict[str, Any]]:
    """Business purpose: Load only separately recorded human judgments of exact observed P14 outputs.

    Business rules:
    - P14's SEEDED_UNVERIFIED records and synthetic test review sets cannot enter the actual dimension-review path.
    - Each dimension review names one candidate case, P14 case, lifecycle stage, trial, and output binding.
    - Identity references are structurally checked later and are not treated as authentication.

    Execution flow:
    1. Return an empty list when no separate dimension-review artifact was supplied.
    2. Require the versioned HUMAN_REVIEW classification and the exact fields for each record.
    3. Reject duplicate review targets and return the original records without normalization.

    Failure cases:
    - Seeded, synthetic, malformed, or duplicate review records raise ValueError.

    Side effects:
    - Reads one explicit local JSON review artifact and writes nothing.
    """
    if path is None:
        return []
    artifact = _read_json(Path(path))
    if (
        not isinstance(artifact, dict)
        or artifact.get("reviewSetVersion") != "LCSP-400-OBSERVED-OUTPUT-REVIEWS-V1"
        or artifact.get("reviewSetKind") != "HUMAN_REVIEW"
        or not isinstance(artifact.get("reviews"), list)
    ):
        raise ValueError("P14_DIMENSION_REVIEW_SET_INVALID")
    required = {
        "candidateCaseId",
        "p14CaseId",
        "evaluationTarget",
        "evaluationStage",
        "lifecycleStage",
        "trialIndex",
        "p14Binding",
        "humanJudgments",
    }
    rows = artifact["reviews"]
    keys = []
    for row in rows:
        if not isinstance(row, dict) or set(row) != required:
            raise ValueError("P14_DIMENSION_REVIEW_ROW_INVALID")
        if (
            not isinstance(row["trialIndex"], int)
            or row["trialIndex"] < 0
            or not isinstance(row["humanJudgments"], dict)
            or not row["humanJudgments"]
        ):
            raise ValueError("P14_DIMENSION_REVIEW_ROW_INVALID")
        keys.append(
            (
                row["candidateCaseId"],
                row["p14CaseId"],
                row["lifecycleStage"],
                row["trialIndex"],
            )
        )
    if len(keys) != len(set(keys)):
        raise ValueError("P14_DIMENSION_REVIEW_DUPLICATE_TARGET")
    return rows


def _validate_dimension_review(
    review: dict[str, Any], binding: dict[str, Any], rubric: dict[str, Any]
) -> dict[str, Any]:
    """Business purpose: Admit observed-output judgments only when every reviewer is bound to that exact P14 trace.

    Business rules:
    - The review's declared P14 binding must exactly equal the normalized trial binding.
    - Every rubric dimension judgment must pass the deterministic human-review contract.
    - No P14 combined verdict can supply actor, condition, exception, or evidence labels.

    Execution flow:
    1. Check case/stage/trial binding equality and reject stale or foreign reviews.
    2. Validate every dimension name and reviewer judgment against its rubric label set.
    3. Return the validated judgment map for the deterministic scorer.

    Failure cases:
    - Binding mismatch, seeded/synthetic reviewer data, invalid labels, decisions, or timestamps raise ValueError.

    Side effects:
    - None: performs local validation only.
    """
    from evals.legal_reasoning.scorer import DIMENSIONS, _valid_human_judgment

    if review["p14Binding"] != binding:
        raise ValueError("P14_DIMENSION_REVIEW_OUTPUT_BINDING_MISMATCH")
    if (
        review["candidateCaseId"] != binding["candidateCaseId"]
        or review["p14CaseId"] != binding["p14CaseId"]
        or review["evaluationTarget"] != "ACTUAL_ASSESSMENT_OUTPUT"
        or review["evaluationStage"] != binding["evaluationStage"]
        or review["lifecycleStage"] != binding["lifecycleStage"]
        or review["trialIndex"] != binding["trialIndex"]
    ):
        raise ValueError("P14_DIMENSION_REVIEW_TARGET_MISMATCH")
    prediction_stub = {"p14Binding": binding}
    for field, judgment in review["humanJudgments"].items():
        dimension = {
            "applicability": "APPLICABILITY",
            "compliance": "COMPLIANCE",
            "actor": "ACTOR",
            "conditions": "CONDITIONS",
            "exceptions": "EXCEPTIONS",
            "evidenceSufficiency": "EVIDENCE_SUFFICIENCY",
            "unsupportedConclusion": "UNSUPPORTED_CONCLUSION",
        }.get(field)
        if dimension not in DIMENSIONS or not _valid_human_judgment(
            judgment,
            dimension=dimension,
            spec=rubric["dimensions"][dimension],
            prediction=prediction_stub,
        ):
            raise ValueError(f"P14_DIMENSION_REVIEW_INVALID:{field}")
    return review["humanJudgments"]


def _binding_for(
    *,
    manifest: dict[str, Any],
    outcome: TrialOutcome,
    entry: dict[str, Any],
    p14_case: BenchmarkCase,
    output_digest: str,
    trace_digest: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """Business purpose: Bind an observed rubric prediction to one immutable P14 output and source context.

    Business rules:
    - Every identity and digest comes from the validated run, trace, explicit mapping, or pinned P14 case.
    - Repository snapshot, legal-source, rule, model route, and instruction fingerprints remain attached.
    - Synthetic repository pins cannot qualify as genuine actual-run output review provenance.

    Execution flow:
    1. Read the exact manifest, trial, trace, P14 case, mapping, and model metadata.
    2. Assemble the scorer's closed P14 binding contract.
    3. Return the binding consumed by per-dimension human judgment validation.

    Failure cases:
    - Missing model, source, rule, trace, or repository values cause the scorer to reject the judgment binding.

    Side effects:
    - None: returns metadata without modifying artifacts.
    """
    provision = p14_case.legal_provisions[0]
    source_id = p14_case.corpus_pin.corpus_id
    source_version = p14_case.corpus_pin.version
    return {
        "runId": outcome.run_id,
        "manifestSha256": manifest["manifestSha256"],
        "candidateCaseId": entry.get("cohortCaseId", entry.get("candidateCaseId")),
        "p14CaseId": outcome.case_id,
        "evaluationStage": entry["evaluationStage"],
        "lifecycleStage": outcome.stage,
        "trialIndex": outcome.trial_index,
        "threadId": outcome.thread_id,
        "traceSha256": trace_digest,
        "observedOutputSha256": output_digest,
        "repositoryCommitSha": p14_case.repo_pin.commit_sha,
        "corpusId": p14_case.corpus_pin.corpus_id,
        "corpusVersion": p14_case.corpus_pin.version,
        "ruleSetVersionId": p14_case.rule_set_pin.rule_set_version_id,
        "modelRoute": metadata.get("modelRoute", ""),
        "instructionBundleDigest": metadata.get("instructionBundleDigest", ""),
        "legalSourceId": source_id,
        "legalSourceVersion": source_version,
        "legalProvisionRefs": f"{provision.document_id}#{provision.locator}",
        "legalCitations": provision.locator,
        "p14RuleId": entry["p14RuleId"],
    }


def _observed_output_from_trace(
    trace_doc: dict[str, Any],
    *,
    outcome: TrialOutcome,
    p14_case: BenchmarkCase,
    mapping_entry: dict[str, Any],
    outcomes_by_case_stage: dict[tuple[str, str], list[TrialOutcome]],
) -> dict[str, Any] | None:
    """Business purpose: Extract only digest-verified reviewer evidence from a saved P14 trace.

    Business rules:
    - SCRIPTED/LIVE require the runner's complete observedOutput snapshot and its canonical digest.
    - OFFLINE_FIXTURE retains its existing fixture output under a distinct non-live classification.
    - Runtime decisions, source fixtures, repository pins, lifecycle, HITL, and outcome identity must agree
      with the saved case and TrialOutcome; no conclusion is reconstructed from tool-call hints.

    Execution flow:
    1. Validate trace/run/trial/stage identity and the exact trace outcome binding.
    2. Select the mode-specific saved output and verify its digest and source/rule/repository content.
    3. Verify evidence references, HITL state, target rule, and linked lifecycle trace identities.
    4. Return the output, or None when a valid execution lacks a reviewer-usable semantic output.

    Failure cases:
    - Tampered identity, output/trace digest, binding, fixture content, or HITL data raises a validation exception.
    - A missing or semantically empty actual output returns None for explicit missing-output accounting.

    Side effects:
    - None: reads validated in-memory P14 artifacts only.
    """
    identity = {
        "runId": outcome.run_id,
        "caseId": outcome.case_id,
        "trialIndex": outcome.trial_index,
        "threadId": outcome.thread_id,
        "stage": outcome.stage,
        "mode": outcome.mode,
    }
    if any(trace_doc.get(key) != value for key, value in identity.items()):
        raise ValueError(f"P14_TRACE_IDENTITY_MISMATCH:{outcome.case_id}:{outcome.trial_index}")
    root_binding = trace_doc.get("outcomeBinding")
    if not isinstance(root_binding, dict) or any(
        root_binding.get(key) != value
        for key, value in {
            "passed": outcome.passed,
            "actualVerdict": outcome.actual_verdict,
            "lifecycleState": outcome.lifecycle_state,
        }.items()
    ):
        raise ValueError(f"P14_TRACE_OUTCOME_BINDING_MISMATCH:{outcome.case_id}:{outcome.trial_index}")

    if outcome.mode == "OFFLINE_FIXTURE":
        fixture_output = trace_doc.get("output")
        return fixture_output if isinstance(fixture_output, dict) else None
    if outcome.mode not in {"SCRIPTED", "LIVE"}:
        raise ValueError(f"P14_TRACE_MODE_UNSUPPORTED:{outcome.mode}")
    output = trace_doc.get("observedOutput")
    if not isinstance(output, dict):
        return None
    if trace_doc.get("observedOutputSha256") != _canonical_sha256(output):
        raise ValueError(f"P14_OBSERVED_OUTPUT_DIGEST_MISMATCH:{outcome.case_id}:{outcome.trial_index}")
    output_identity = {
        "runId": outcome.run_id,
        "caseId": outcome.case_id,
        "trialIndex": outcome.trial_index,
        "threadId": outcome.thread_id,
        "lifecycleStage": outcome.stage,
        "evaluationStage": "ASSESSMENT_ROOT",
        "actualVerdict": outcome.actual_verdict,
        "lifecycleState": outcome.lifecycle_state,
    }
    if any(output.get(key) != value for key, value in output_identity.items()):
        raise ValueError(f"P14_OBSERVED_OUTPUT_IDENTITY_MISMATCH:{outcome.case_id}:{outcome.trial_index}")
    nested_binding = output.get("outcomeBinding")
    if not isinstance(nested_binding, dict) or any(
        nested_binding.get(key) != value
        for key, value in {
            "runId": outcome.run_id,
            "caseId": outcome.case_id,
            "trialIndex": outcome.trial_index,
            "threadId": outcome.thread_id,
            "stage": outcome.stage,
            "actualVerdict": outcome.actual_verdict,
            "lifecycleState": outcome.lifecycle_state,
            "passed": outcome.passed,
        }.items()
    ):
        raise ValueError(f"P14_OBSERVED_OUTPUT_OUTCOME_MISMATCH:{outcome.case_id}:{outcome.trial_index}")
    if (
        output.get("ruleSetVersionId") != p14_case.rule_set_pin.rule_set_version_id
        or output.get("targetRuleIds") != list(p14_case.rule_set_pin.rule_ids)
        or _canonical_sha256(output.get("legalProvisions"))
        != _canonical_sha256([row.model_dump() for row in p14_case.legal_provisions])
        or _canonical_sha256(output.get("ruleDefinitions"))
        != _canonical_sha256([row.model_dump() for row in p14_case.rule_definitions])
        or output.get("repositorySnapshot") != p14_case.repo_pin.model_dump()
        or output.get("corpusPin") != p14_case.corpus_pin.model_dump()
        or mapping_entry.get("p14RuleId") not in output.get("targetRuleIds", [])
    ):
        raise ValueError(f"P14_OBSERVED_OUTPUT_SOURCE_OR_RULE_MISMATCH:{outcome.case_id}")
    decisions = output.get("assessmentDecisions")
    evidence = output.get("evidenceRecords")
    facts = output.get("facts")
    refs = output.get("evidenceReferences")
    hitl = output.get("hitl")
    if not isinstance(decisions, list) or not isinstance(evidence, dict) or not isinstance(facts, list):
        raise TypeError(f"P14_OBSERVED_OUTPUT_CONTENT_INVALID:{outcome.case_id}")
    known_refs = set(evidence) | {
        row.get("factId") for row in facts if isinstance(row, dict) and isinstance(row.get("factId"), str)
    }
    if not isinstance(refs, list) or any(not isinstance(ref, str) or ref not in known_refs for ref in refs):
        raise ValueError(f"P14_OBSERVED_OUTPUT_EVIDENCE_REFERENCE_INVALID:{outcome.case_id}")
    if not isinstance(hitl, dict) or hitl.get("state") not in {"NONE", "OPEN", "RESOLVED"}:
        raise ValueError(f"P14_OBSERVED_OUTPUT_HITL_INVALID:{outcome.case_id}")
    if hitl["state"] == "OPEN" and not hitl.get("openRequestIds"):
        raise ValueError(f"P14_OBSERVED_OUTPUT_HITL_OPEN_REQUEST_MISSING:{outcome.case_id}")
    if hitl["state"] == "RESOLVED" and not hitl.get("resolvedRequests"):
        raise ValueError(f"P14_OBSERVED_OUTPUT_HITL_RESOLUTION_MISSING:{outcome.case_id}")
    for decision in decisions:
        body = decision.get("decision", decision) if isinstance(decision, dict) else {}
        if body.get("assessmentRuleId") not in output["targetRuleIds"]:
            raise ValueError(f"P14_OBSERVED_OUTPUT_DECISION_RULE_INVALID:{outcome.case_id}")
    history = output.get("lifecycleHistory")
    if not isinstance(history, list):
        raise TypeError(f"P14_OBSERVED_OUTPUT_LIFECYCLE_HISTORY_INVALID:{outcome.case_id}")
    for prior in history:
        if not isinstance(prior, dict):
            raise TypeError(f"P14_OBSERVED_OUTPUT_LIFECYCLE_HISTORY_INVALID:{outcome.case_id}")
        matching = outcomes_by_case_stage.get((outcome.case_id, prior.get("stage")), [])
        if not any(
            item.trial_index == outcome.trial_index
            and item.trace_sha256 == prior.get("traceSha256")
            and item.actual_verdict == prior.get("actualVerdict")
            and item.lifecycle_state == prior.get("lifecycleState")
            for item in matching
        ):
            raise ValueError(f"P14_OBSERVED_OUTPUT_LIFECYCLE_HISTORY_MISMATCH:{outcome.case_id}")
    if output.get("runResult", {}).get("state") != "SUCCEEDED" or not decisions:
        return None
    selected = output.get("actualAssessmentDecision")
    if selected != decisions[-1]:
        raise ValueError(f"P14_OBSERVED_OUTPUT_DECISION_SNAPSHOT_MISMATCH:{outcome.case_id}")
    return output


def _sha256_bytes(value: bytes) -> str:
    """Business purpose: Recompute a trace's exact persisted-byte digest for human-review binding.

    Business rules:
    - Trace reviews bind to the file bytes written by P14, including formatting and line endings.

    Execution flow:
    1. Hash the saved bytes with SHA-256.

    Failure cases:
    - None: all byte strings have a digest.

    Side effects:
    - None: pure byte hashing.
    """
    from hashlib import sha256

    return sha256(value).hexdigest()


def _manifest_instruction_digest(manifest: dict[str, Any]) -> str | None:
    """Business purpose: Select the P14 instruction-bundle fingerprint used by output reviews.

    Business rules:
    - Prefer the immutable runtime bundle digest and retain the bundle ID as a versioned fallback.
    - Missing fingerprints remain null and are not fabricated from unrelated prompt metadata.

    Execution flow:
    1. Read the instructionBundle object from the saved manifest.
    2. Return its runtime/source digest or stable ID when available.

    Failure cases:
    - A missing bundle produces None, allowing the review binding validator to fail closed.

    Side effects:
    - None: reads in-memory manifest metadata.
    """
    bundle = manifest.get("instructionBundle") or {}
    return bundle.get("enRuntimeBundleDigest") or bundle.get("viSourceInventoryDigest") or bundle.get("id")


def _resolve_trace(base_dir: Path, trace_path: str | None) -> Path:
    """Business purpose: Resolve the exact P14 trace already validated by the P14 artifact gate.

    Business rules:
    - Relative trace paths resolve beneath the supplied run-artifact directory.
    - No fallback by filename or approximate location is permitted.

    Execution flow:
    1. Reject an absent path.
    2. Resolve absolute or run-relative path and require an existing file.

    Failure cases:
    - Missing trace path or file raises ValueError.

    Side effects:
    - None: performs read-only path resolution.
    """
    if not trace_path:
        raise ValueError("P14_TRACE_PATH_MISSING")
    candidate = Path(trace_path)
    resolved = candidate if candidate.is_absolute() else base_dir / candidate
    if not resolved.is_file():
        raise ValueError(f"P14_TRACE_PATH_NOT_FOUND:{trace_path}")
    return resolved


def _read_json(path: Path) -> Any:
    """Business purpose: Load a caller-selected local JSON evaluation artifact.

    Business rules:
    - Artifact content remains local, UTF-8 encoded, and is never fetched or executed.

    Execution flow:
    1. Read the selected file as UTF-8.
    2. Parse JSON and return its data.

    Failure cases:
    - I/O and JSON decoding failures propagate before scoring.

    Side effects:
    - Read-only access to one selected local file.
    """
    return json.loads(path.read_text(encoding="utf-8"))
