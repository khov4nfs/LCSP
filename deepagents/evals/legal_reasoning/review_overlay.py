"""Versioned append-only review overlay for the immutable LCSP-400 candidate snapshot."""

from __future__ import annotations

import json
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from evals.legal_reasoning.validation import validate_dataset

OVERLAY_VERSION = "LCSP-400-REVIEW-OVERLAY-V1"
REVIEW_OVERLAY_PATH = Path(__file__).resolve().parent / "review-overlay.v1.json"


def merge_review_overlay(
    candidates: list[dict[str, Any]],
    overlay_path: str | Path,
    rubric: dict[str, Any],
    source_pins: dict[str, Any],
    *,
    allow_synthetic_reviews: bool = False,
) -> list[dict[str, Any]]:
    """Business purpose: Apply reviewer decisions without editing or duplicating the candidate snapshot.

    Business rules:
    - The overlay pins the complete candidate dataset and each reviewed record's exact base digest.
    - It stores only review state, reviewer evidence, and changed gold labels; candidate facts remain canonical.
    - Review metadata is structurally validated and never authenticates a reviewer by itself.
    - Synthetic review references require explicit test-only allowance and remain isolated from committed data.

    Execution flow:
    1. Load and validate the versioned overlay against the candidate dataset digest.
    2. Reject duplicate, unknown, stale, or candidate-status overlay rows.
    3. Merge review fields and explicit label overrides into a copy of the base rows.
    4. Validate the effective annotations against the rubric, source pins, and review rules.

    Failure cases:
    - Invalid version/digests/IDs/review fields or unresolved reviewed labels raise ValueError.

    Side effects:
    - Reads the caller-selected overlay; returns copied records and writes no files.
    """
    overlay = json.loads(Path(overlay_path).read_text(encoding="utf-8"))
    schema_path = Path(__file__).resolve().parent / "review-overlay.schema.v1.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    errors = list(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(overlay)
    )
    if errors:
        raise ValueError(f"REVIEW_OVERLAY_SCHEMA_INVALID:{errors[0].message}")
    if overlay.get("overlayVersion") != OVERLAY_VERSION:
        raise ValueError("REVIEW_OVERLAY_VERSION_INVALID")
    if overlay.get("candidateDatasetSha256") != _digest(candidates):
        raise ValueError("REVIEW_OVERLAY_CANDIDATE_SNAPSHOT_STALE")
    candidate_by_id = {row["caseId"]: row for row in candidates}
    result = deepcopy(candidates)
    effective_by_id = {row["caseId"]: row for row in result}
    seen: set[str] = set()
    for review in overlay.get("caseReviews", []):
        case_id = review.get("caseId")
        if case_id in seen:
            raise ValueError(f"REVIEW_OVERLAY_DUPLICATE_CASE:{case_id}")
        seen.add(case_id)
        base = candidate_by_id.get(case_id)
        if base is None:
            raise ValueError(f"REVIEW_OVERLAY_CASE_UNKNOWN:{case_id}")
        if review.get("candidateRecordSha256") != _digest(base):
            raise ValueError(f"REVIEW_OVERLAY_CASE_SNAPSHOT_STALE:{case_id}")
        if review.get("reviewStatus") == "CANDIDATE":
            raise ValueError(f"REVIEW_OVERLAY_CANDIDATE_STATUS_INVALID:{case_id}")
        effective = effective_by_id[case_id]
        effective["reviewStatus"] = review["reviewStatus"]
        for key in (
            "reviewers",
            "reviewerDisagreements",
            "adjudication",
            "uncertaintyReason",
            "exclusionReason",
        ):
            effective[key] = review[key]
        overrides = review.get("expectedOverrides", {})
        active_gold = (
            effective["fixedOutputDiagnostic"]["expectedJudgments"]
            if effective["evaluationTarget"] == "FIXED_CLAIM_DIAGNOSTIC"
            else effective["expected"]
        )
        for field, expectation in overrides.items():
            if field not in active_gold:
                raise ValueError(f"REVIEW_OVERLAY_EXPECTATION_UNKNOWN:{case_id}:{field}")
            active_gold[field] = expectation
        if effective["reviewStatus"] in {"REVIEWED", "ADJUDICATED"}:
            gold = (
                effective["fixedOutputDiagnostic"]["expectedJudgments"]
                if effective["evaluationTarget"] == "FIXED_CLAIM_DIAGNOSTIC"
                else effective["expected"]
            )
            for expectation in gold.values():
                if expectation is not None:
                    expectation.pop("confidence", None)
    validate_dataset(
        result,
        rubric,
        source_pins,
        allow_synthetic_reviews=allow_synthetic_reviews,
    )
    return result


def _digest(value: Any) -> str:
    """Business purpose: Compute stable overlay bindings for candidate snapshots and case records.

    Business rules:
    - Hashes cover canonical UTF-8 JSON with sorted keys and compact separators.
    - A digest identifies bytes for reproducibility and does not certify legal correctness or review authenticity.

    Execution flow:
    1. Serialize the selected JSON value canonically.
    2. Return its SHA-256 digest.

    Failure cases:
    - Non-JSON-serializable values raise rather than receive an unstable digest.

    Side effects:
    - None: pure local serialization and hashing.
    """
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(encoded.encode("utf-8")).hexdigest()
