"""Thin adapter from saved P14 artifacts to the LCSP-400 deterministic scorer."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Sequence

from evals.benchmark_runner import load_benchmark_cases, load_manual_reviews
from evals.benchmark_schema import BenchmarkCase, ManualReviewRecord, TrialOutcome
from evals.run_manifest import stable_hash
from evals.scorer import (
    build_trial_metadata_map,
    score_manual_reviews,
    validate_run_artifacts_for_scoring,
)
from evals.legal_reasoning.scorer import _canonical_sha256, score_dataset
from evals.legal_reasoning.review_overlay import REVIEW_OVERLAY_PATH, merge_review_overlay
from evals.legal_reasoning.validation import PACKAGE_ROOT, load_dataset

MAPPING_VERSION = "LCSP-400-P14-CASE-MAP-V1"
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
      artifacts raise ValueError before rubric metrics are produced.

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
    mapping = _read_json(Path(case_mapping_path))
    effective_candidate_cases = merge_review_overlay(
        candidate_cases,
        review_overlay_path or REVIEW_OVERLAY_PATH,
        rubric,
        source_pins,
    )

    validate_run_artifacts_for_scoring(
        manifest, raw_outcomes, base_dir=Path(trials_path).parent
    )
    mapping_inventory = validate_case_mapping(
        mapping,
        candidate_cases=candidate_cases,
        p14_cases=p14_cases,
        manifest=manifest,
        source_pins=source_pins,
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
    trial_metadata = build_trial_metadata_map(manifest, raw_outcomes)
    outcomes_by_case_stage: dict[tuple[str, str], list[TrialOutcome]] = {}
    for outcome in raw_outcomes:
        outcomes_by_case_stage.setdefault((outcome.case_id, outcome.stage), []).append(outcome)
    candidate_by_id = {row["caseId"]: row for row in effective_candidate_cases}
    for entry in mapping["caseMappings"]:
        candidate = candidate_by_id[entry["candidateCaseId"]]
        p14_case = p14_case_by_id[entry["p14CaseId"]]
        for outcome in outcomes_by_case_stage.get(
            (p14_case.case_id, entry["lifecycleStage"]), []
        ):
            meta = trial_metadata[(outcome.case_id, outcome.stage, outcome.trial_index)]
            trace_path = _resolve_trace(Path(trials_path).parent, outcome.trace_path)
            trace_doc = json.loads(trace_path.read_text(encoding="utf-8"))
            output = trace_doc.get("output")
            if not isinstance(output, dict):
                raise ValueError(f"P14_TRACE_OUTPUT_MISSING:{outcome.case_id}:{outcome.trial_index}")
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
            applicability, compliance, normalized_applicability, normalized_compliance = _normalize_assessment_verdict(
                outcome.actual_verdict
            )
            review_key = (
                candidate["caseId"], outcome.case_id, outcome.stage, outcome.trial_index
            )
            dimension_review = dimension_review_by_key.pop(review_key, None)
            human_judgments = (
                _validate_dimension_review(dimension_review, binding, rubric)
                if dimension_review is not None
                else {}
            )
            normalized_by_trial.setdefault(
                (candidate["evaluationTarget"], outcome.stage, outcome.trial_index), []
            ).append(
                {
                    "caseId": candidate["caseId"],
                    "stage": candidate["stage"],
                    "evaluationTarget": candidate["evaluationTarget"],
                    "observationKind": "GENERATED_LCSP_OUTPUT",
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
                }
            )

    if dimension_review_by_key:
        raise ValueError("P14_DIMENSION_REVIEW_TARGET_NOT_FOUND")

    executed_candidate_ids = {
        row["caseId"] for rows in normalized_by_trial.values() for row in rows
    }
    mapping_inventory["executableCaseCount"] = len(executed_candidate_ids)
    mapping_inventory["mappedTrialCount"] = sum(
        len(rows) for rows in normalized_by_trial.values()
    )
    mapping_inventory["mappedCaseWithoutTrialCount"] = max(
        0, mapping_inventory["mappedCaseCount"] - len(executed_candidate_ids)
    )

    rubric_reports = []
    actual_targets = ("ACTUAL_ASSESSMENT_OUTPUT", "RULE_SET_PREPARATION_OUTPUT")
    trial_groups = sorted(normalized_by_trial)
    if not trial_groups:
        trial_groups = [(target, "NO_MAPPED_LIFECYCLE_STAGE", -1) for target in actual_targets]
    for target, lifecycle_stage, trial_index in trial_groups:
        rows = normalized_by_trial.get((target, lifecycle_stage, trial_index), [])
        normalized = {
            "predictionVersion": "LCSP-400-NORMALIZED-PREDICTIONS-V1",
            "evaluationTarget": target,
            "sourceKind": "P14_SAVED_ARTIFACTS",
            "syntheticOnly": False,
            "runMetadata": {
                "runId": manifest["runId"],
                "manifestSha256": manifest["manifestSha256"],
                "mode": manifest.get("runConfig", {}).get("mode"),
                "lifecycleStage": lifecycle_stage,
                "trialIndex": trial_index,
                "repositoryCommitSha": manifest.get("gitCommitSha"),
                "casesDatasetSha256": manifest.get("sourcePins", {}).get("casesDatasetSha256"),
            },
            "casePredictions": rows,
        }
        report = score_dataset(effective_candidate_cases, normalized, rubric, source_pins)
        report["p14LifecycleStage"] = lifecycle_stage
        report["trialIndex"] = trial_index
        rubric_reports.append(report)

    p14_mode = raw_outcomes[0].mode if raw_outcomes else manifest.get("runConfig", {}).get("mode", "UNKNOWN")
    seeded_review_count = p14_review_diagnostics["seededUnverified"]["totalReviewed"]
    p14_expert_flagged_count = p14_review_diagnostics["expertVerified"]["totalReviewed"]
    return {
        "integrationReportVersion": "LCSP-400-P14-INTEGRATION-REPORT-V1",
        "artifactValidationStatus": "VALIDATED",
        "artifactClassification": "P14_OFFLINE_OR_SCRIPTED_FIXTURE" if p14_mode != "LIVE" else "P14_LIVE_RUN_ARTIFACTS",
        "pinnedInputs": {
            "caseMappingSha256": _canonical_sha256(mapping),
            "candidateDatasetSha256": mapping["pinnedInputs"]["candidateDatasetSha256"],
            "sourcePinsSha256": mapping["pinnedInputs"]["sourcePinsSha256"],
            "p14CasesDatasetSha256": mapping["pinnedInputs"]["p14CasesDatasetSha256"],
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
        },
        "caseMapping": mapping_inventory,
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
        "scoringStatus": "SCORED"
        if any(row["scoringStatus"] == "SCORED" for row in rubric_reports)
        else "NOT_SCORED",
        "humanReviewedQualityMetrics": "NOT_SCORED"
        if not any(row["coverage"]["humanReviewedAnnotationCount"] for row in rubric_reports)
        else "SCORED",
        "actualExecutionBaseline": "NOT_RUN"
        if p14_mode != "LIVE" or mapping_inventory["executableCaseCount"] == 0
        else "REVIEW_GATED",
    }


def validate_case_mapping(
    mapping: dict[str, Any],
    *,
    candidate_cases: list[dict[str, Any]],
    p14_cases: Sequence[BenchmarkCase],
    manifest: dict[str, Any],
    source_pins: dict[str, Any],
) -> dict[str, Any]:
    """Business purpose: Reject stale or approximate crosswalks between LCSP and P14 cases.

    Business rules:
    - Mapping headers pin candidate annotations, LCSP legal source pins, and P14 case corpus snapshots.
    - Each mapping must name an Assessment Root case, a distinct lifecycle stage, an exact P14 rule and
      legal provision, and the pinned P14 repository/corpus/rule-set versions.
    - Fixed-claim diagnostics and Rule Set Preparation cases cannot be mapped onto P14 lifecycle stages.

    Execution flow:
    1. Verify mapping version and all content hashes against the loaded files and run manifest.
    2. Resolve IDs exactly and reject duplicates or missing case/rule/provision references.
    3. Compare stage, legal-source, repository, corpus, and rule-set fields byte-for-byte by value.
    4. Return executable and unsupported inventory without inventing a semantic crosswalk.

    Failure cases:
    - Any stale hash, unsupported stage, unknown ID, duplicate, or field mismatch raises ValueError.

    Side effects:
    - None: validates local mapping and artifact metadata only.
    """
    if not isinstance(mapping, dict) or mapping.get("mappingVersion") != MAPPING_VERSION:
        raise ValueError("P14_CASE_MAPPING_VERSION_INVALID")
    mapping_rows = mapping.get("caseMappings")
    pinned_inputs = mapping.get("pinnedInputs")
    if not isinstance(mapping_rows, list) or not isinstance(pinned_inputs, dict):
        raise ValueError("P14_CASE_MAPPING_STRUCTURE_INVALID")
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

    candidate_by_id = {row["caseId"]: row for row in candidate_cases}
    p14_by_id = {case.case_id: case for case in p14_case_list}
    seen_candidate: set[str] = set()
    seen_p14: set[str] = set()
    for entry in mapping_rows:
        if not isinstance(entry, dict):
            raise ValueError("P14_CASE_MAPPING_ENTRY_INVALID")
        candidate_id = entry.get("candidateCaseId")
        p14_id = entry.get("p14CaseId")
        if candidate_id in seen_candidate or p14_id in seen_p14:
            raise ValueError("P14_CASE_MAPPING_DUPLICATE_ID")
        seen_candidate.add(candidate_id)
        seen_p14.add(p14_id)
        candidate = candidate_by_id.get(candidate_id)
        p14_case = p14_by_id.get(p14_id)
        if candidate is None or p14_case is None:
            raise ValueError("P14_CASE_MAPPING_CASE_NOT_FOUND")
        if candidate["evaluationTarget"] != "ACTUAL_ASSESSMENT_OUTPUT" or candidate["stage"] != "ASSESSMENT_ROOT":
            raise ValueError(f"P14_CASE_MAPPING_EVALUATION_STAGE_UNSUPPORTED:{candidate_id}")
        if entry.get("evaluationStage") != candidate["stage"]:
            raise ValueError(f"P14_CASE_MAPPING_EVALUATION_STAGE_MISMATCH:{candidate_id}")
        if entry.get("evaluationTarget") != candidate["evaluationTarget"]:
            raise ValueError(f"P14_CASE_MAPPING_EVALUATION_TARGET_MISMATCH:{candidate_id}")
        lifecycle = entry.get("lifecycleStage")
        if lifecycle not in {stage.stage for stage in p14_case.gold_rubric.stages}:
            raise ValueError(f"P14_CASE_MAPPING_LIFECYCLE_STAGE_MISMATCH:{candidate_id}")
        p14_rule = next(
            (rule for rule in p14_case.rule_definitions if rule.rule_id == entry.get("p14RuleId")),
            None,
        )
        if p14_rule is None:
            raise ValueError(f"P14_CASE_MAPPING_RULE_MISMATCH:{candidate_id}")
        source = candidate["legalSource"]
        if entry.get("candidateLegalSource") != {
            "sourceId": source["sourceId"],
            "sourceVersion": source["sourceVersion"],
            "provisionRefs": source["provisionRefs"],
            "citations": source["citations"],
        }:
            raise ValueError(f"P14_CASE_MAPPING_CANDIDATE_SOURCE_MISMATCH:{candidate_id}")
        p14_provision = next(
            (provision for provision in p14_case.legal_provisions if provision.document_id == entry.get("p14DocumentId")),
            None,
        )
        if p14_provision is None or (
            entry.get("p14ProvisionLocator") != p14_provision.locator
            or entry.get("p14ProvisionSha256") != p14_provision.content_sha256
            or entry.get("p14CorpusId") != p14_case.corpus_pin.corpus_id
            or entry.get("p14CorpusVersion") != p14_case.corpus_pin.version
        ):
            raise ValueError(f"P14_CASE_MAPPING_LEGAL_PIN_MISMATCH:{candidate_id}")
        if p14_provision.source_kind != "OFFICIAL_PINNED_LAW":
            raise ValueError(f"P14_CASE_MAPPING_NON_OFFICIAL_LAW:{candidate_id}")
        repo = p14_case.repo_pin
        if (
            repo.snapshot_kind != "GIT_COMMIT"
            or len(repo.commit_sha) not in {40, 64}
            or any(char not in "0123456789abcdef" for char in repo.commit_sha.lower())
        ):
            raise ValueError(f"P14_CASE_MAPPING_REPOSITORY_SNAPSHOT_NOT_PINNED:{candidate_id}")
        if entry.get("p14RepositorySnapshot") != {
            "repoId": repo.repo_id,
            "snapshotKind": repo.snapshot_kind,
            "commitSha": repo.commit_sha,
        }:
            raise ValueError(f"P14_CASE_MAPPING_REPOSITORY_PIN_MISMATCH:{candidate_id}")
        if entry.get("p14RuleSetVersionId") != p14_case.rule_set_pin.rule_set_version_id:
            raise ValueError(f"P14_CASE_MAPPING_RULESET_PIN_MISMATCH:{candidate_id}")

    target_counts = Counter(row["evaluationTarget"] for row in candidate_cases)
    fixed_diagnostic_count = target_counts.get("FIXED_CLAIM_DIAGNOSTIC", 0)
    rsp_output_count = target_counts.get("RULE_SET_PREPARATION_OUTPUT", 0)
    assessment_output_count = target_counts.get("ACTUAL_ASSESSMENT_OUTPUT", 0)
    mapped = len(mapping_rows)
    return {
        "candidateCaseCount": len(candidate_cases),
        "p14BenchmarkCaseCount": len(p14_case_list),
        "mappedCaseCount": mapped,
        "mappedCaseDefinitionCount": mapped,
        "fixedOutputDiagnosticCaseCount": fixed_diagnostic_count,
        "unsupportedCaseCount": rsp_output_count + assessment_output_count - mapped,
        "excludedDiagnosticCaseCount": fixed_diagnostic_count,
        "assessmentOutputCandidateCount": assessment_output_count,
        "ruleSetPreparationCandidateCount": rsp_output_count,
        "mappingPolicy": "EXACT_ID_SOURCE_RULE_STAGE_AND_SNAPSHOT_ONLY",
        "unmappedReasonCounts": {
            "NO_EXACT_P14_CASE_MAPPING": assessment_output_count - mapped,
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
    pins = entry["candidateLegalSource"]
    return {
        "runId": outcome.run_id,
        "manifestSha256": manifest["manifestSha256"],
        "candidateCaseId": entry["candidateCaseId"],
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
        "legalSourceId": pins["sourceId"],
        "legalSourceVersion": pins["sourceVersion"],
        "legalProvisionRefs": ",".join(sorted(pins["provisionRefs"])),
        "legalCitations": "|".join(sorted(pins["citations"])),
        "p14RuleId": entry["p14RuleId"],
    }


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
