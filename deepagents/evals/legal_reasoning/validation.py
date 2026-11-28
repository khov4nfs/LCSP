"""Structural and provenance validation for LCSP-400 candidate annotations."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

PACKAGE_ROOT = Path(__file__).resolve().parent
FIELD_DIMENSIONS = {
    "applicability": "APPLICABILITY",
    "compliance": "COMPLIANCE",
    "actor": "ACTOR",
    "conditions": "CONDITIONS",
    "exceptions": "EXCEPTIONS",
    "evidenceSufficiency": "EVIDENCE_SUFFICIENCY",
    "unsupportedConclusion": "UNSUPPORTED_CONCLUSION",
}


def validate_dataset(
    records: list[dict[str, Any]],
    rubric: dict[str, Any],
    source_pins: dict[str, Any],
) -> dict[str, Any]:
    """Business purpose: Admit only structurally valid, source-pinned annotation cases.

    Business rules:
    - Agent-authored labels remain CANDIDATE until genuine human review metadata is supplied.
    - The legal source identifier, pinned version, exact citation, and provision reference must
      resolve to the checked-in public source pin; production status values are not extended.
    - Counterfactual pairs must be reciprocal and unresolved disagreements cannot be scored.

    Execution flow:
    1. Validate every row against the versioned JSON Schema and rubric label sets.
    2. Reject duplicate identifiers and invalid source/version/citation references.
    3. Check review-state metadata and reciprocal counterfactual links.
    4. Return deterministic inventory and candidate/review coverage counts.

    Failure cases:
    - Invalid schema, labels, provenance, duplicates, review metadata, or pair links raise
      ValueError with a stable validation code and row context.

    Side effects:
    - None: validates in-memory files and returns counts without changing annotations.
    """
    schema = json.loads(
        (PACKAGE_ROOT / "annotation.schema.v1.json").read_text(encoding="utf-8")
    )
    validator = Draft202012Validator(schema)
    dimensions = rubric["dimensions"]
    labels_by_dimension = {
        key: set(value["labels"]) for key, value in dimensions.items()
    }
    source_by_id = {source["sourceId"]: source for source in source_pins["sources"]}
    seen: set[str] = set()
    by_id: dict[str, dict[str, Any]] = {}
    for index, record in enumerate(records):
        errors = sorted(
            validator.iter_errors(record), key=lambda error: list(error.path)
        )
        if errors:
            path = ".".join(str(part) for part in errors[0].path)
            raise ValueError(
                f"ANNOTATION_SCHEMA_INVALID:{index}:{path}:{errors[0].message}"
            )
        case_id = record["caseId"]
        if case_id in seen:
            raise ValueError(f"ANNOTATION_DUPLICATE_CASE_ID:{case_id}")
        seen.add(case_id)
        by_id[case_id] = record
        if record["rubricVersion"] != rubric["rubricVersion"]:
            raise ValueError(f"ANNOTATION_RUBRIC_VERSION_MISMATCH:{case_id}")
        for field, expected in record["expected"].items():
            dimension = FIELD_DIMENSIONS[field]
            if (
                expected is not None
                and expected["label"] not in labels_by_dimension[dimension]
            ):
                raise ValueError(
                    f"ANNOTATION_LABEL_INVALID:{case_id}:{dimension}:{expected['label']}"
                )
            if (
                expected is not None
                and not rubric["dimensions"][dimension]["stageApplicability"][
                    record["stage"]
                ]
            ):
                raise ValueError(
                    f"ANNOTATION_DIMENSION_NOT_APPLICABLE:{case_id}:{dimension}"
                )
        primary_field = {
            "APPLICABILITY": "applicability",
            "COMPLIANCE": "compliance",
            "ACTOR": "actor",
            "CONDITIONS": "conditions",
            "EXCEPTIONS": "exceptions",
            "EVIDENCE_SUFFICIENCY": "evidenceSufficiency",
            "UNSUPPORTED_CONCLUSION": "unsupportedConclusion",
        }[record["primaryDimension"]]
        if record["expected"].get(primary_field) is None:
            raise ValueError(f"ANNOTATION_PRIMARY_EXPECTATION_MISSING:{case_id}")
        for reviewer in record["reviewers"]:
            for judgment in reviewer["dimensionJudgments"]:
                dimension = judgment["dimension"]
                field = next(
                    (
                        name
                        for name, key in FIELD_DIMENSIONS.items()
                        if key == dimension
                    ),
                    None,
                )
                if (
                    field is None
                    or field not in record["expected"]
                    or record["expected"][field] is None
                ):
                    raise ValueError(
                        f"REVIEW_JUDGMENT_DIMENSION_INVALID:{case_id}:{dimension}"
                    )
                if judgment["label"] not in labels_by_dimension[dimension]:
                    raise ValueError(
                        f"REVIEW_JUDGMENT_LABEL_INVALID:{case_id}:{dimension}:{judgment['label']}"
                    )
        source = source_by_id.get(record["legalSource"]["sourceId"])
        if source is None:
            raise ValueError(f"LEGAL_SOURCE_UNKNOWN:{case_id}")
        legal_ref = record["legalSource"]
        if legal_ref["sourceVersion"] != source["sourceVersion"]:
            raise ValueError(f"LEGAL_SOURCE_VERSION_MISMATCH:{case_id}")
        if legal_ref["sourceUrl"] != source["sourceUrl"]:
            raise ValueError(f"LEGAL_SOURCE_URL_MISMATCH:{case_id}")
        provision_ids = set(source["provisions"])
        if (
            not legal_ref["provisionRefs"]
            or not set(legal_ref["provisionRefs"]) <= provision_ids
        ):
            raise ValueError(f"LEGAL_PROVISION_REFERENCE_INVALID:{case_id}")
        allowed_citations = {
            source["provisions"][provision_id]["citation"]
            for provision_id in legal_ref["provisionRefs"]
        }
        if set(legal_ref["citations"]) != allowed_citations:
            raise ValueError(f"LEGAL_CITATION_MISMATCH:{case_id}")
        if record["adjudication"] is not None:
            for resolution in record["adjudication"]["resolvedLabels"]:
                dimension = resolution["dimension"]
                if (
                    dimension not in labels_by_dimension
                    or resolution["label"] not in labels_by_dimension[dimension]
                ):
                    raise ValueError(
                        f"ADJUDICATION_LABEL_INVALID:{case_id}:{dimension}:{resolution['label']}"
                    )
                field = next(
                    (
                        name
                        for name, key in FIELD_DIMENSIONS.items()
                        if key == dimension
                    ),
                    None,
                )
                if field is None or record["expected"].get(field) is None:
                    raise ValueError(
                        f"ADJUDICATION_DIMENSION_INVALID:{case_id}:{dimension}"
                    )
        _validate_review_record(record)

    pair_count = 0
    for record in records:
        pair = record.get("counterfactualPair")
        if pair is None:
            continue
        counterpart = by_id.get(pair["counterpartCaseId"])
        if counterpart is None:
            raise ValueError(f"COUNTERFACTUAL_COUNTERPART_MISSING:{record['caseId']}")
        reverse = counterpart.get("counterfactualPair")
        if (
            reverse is None
            or reverse["pairId"] != pair["pairId"]
            or reverse["counterpartCaseId"] != record["caseId"]
        ):
            raise ValueError(f"COUNTERFACTUAL_PAIR_NOT_RECIPROCAL:{record['caseId']}")
        if record["caseId"] < pair["counterpartCaseId"]:
            pair_count += 1

    counts = {
        status: 0
        for status in (
            "CANDIDATE",
            "INDEPENDENT_REVIEW",
            "REVIEWED",
            "ADJUDICATED",
            "PROVISIONAL",
            "UNCERTAIN",
            "EXCLUDED",
        )
    }
    for record in records:
        counts[record["reviewStatus"]] += 1
    return {
        "caseCount": len(records),
        "uniqueCaseCount": len(seen),
        "counterfactualPairCount": pair_count,
        "reviewStatusCounts": counts,
    }


def _validate_review_record(record: dict[str, Any]) -> None:
    """Business purpose: Prevent candidate labels from claiming human-reviewed authority.

    Business rules:
    - REVIEWED and ADJUDICATED require identified human reviewers and review evidence references.
    - Disagreement must be adjudicated before a record is eligible for scoring.
    - Candidate, provisional, uncertain, and excluded records never pass as reviewed gold.

    Execution flow:
    1. Check required reviewer and adjudicator metadata for the selected review state.
    2. Reject unresolved disagreements on a reviewed record.
    3. Preserve other states as non-eligible review outcomes.

    Failure cases:
    - Missing human identities/evidence or unresolved disagreement raises a stable validation error.

    Side effects:
    - None: checks metadata only and makes no legal or human-review decision.
    """
    status = record["reviewStatus"]
    reviewers = record["reviewers"]
    disagreement_rows = record["reviewerDisagreements"]
    recorded_disagreements = {row["dimension"]: row for row in disagreement_rows}
    if len(recorded_disagreements) != len(disagreement_rows):
        raise ValueError(f"DUPLICATE_REVIEWER_DISAGREEMENT:{record['caseId']}")
    if status in {"REVIEWED", "ADJUDICATED"}:
        if not reviewers or any(
            reviewer.get("reviewerType") != "HUMAN"
            or not reviewer.get("reviewerId")
            or not reviewer.get("identityVerificationRef")
            or not reviewer.get("reviewedAt")
            for reviewer in reviewers
        ):
            raise ValueError(f"REVIEWER_METADATA_REQUIRED:{record['caseId']}")
        if any(reviewer["decision"] == "UNSURE" for reviewer in reviewers):
            raise ValueError(f"UNSURE_REVIEWER_NOT_ELIGIBLE:{record['caseId']}")
        expected_dimensions = {
            FIELD_DIMENSIONS[field]: value["label"]
            for field, value in record["expected"].items()
            if value is not None
        }
        recorded_by_reviewer = {
            reviewer["reviewerId"]: {
                judgment["dimension"]: judgment["label"]
                for judgment in reviewer["dimensionJudgments"]
            }
            for reviewer in reviewers
        }
        reviewed_dimensions = set().union(
            *(set(values) for values in recorded_by_reviewer.values())
        )
        if not set(expected_dimensions) <= reviewed_dimensions:
            raise ValueError(f"REVIEW_DIMENSION_JUDGMENT_MISSING:{record['caseId']}")
        conflicting_dimensions = {
            dimension
            for dimension in reviewed_dimensions
            if len(
                {
                    values[dimension]
                    for values in recorded_by_reviewer.values()
                    if dimension in values
                }
            )
            > 1
        }
        if set(recorded_disagreements) != conflicting_dimensions and (
            conflicting_dimensions or recorded_disagreements
        ):
            raise ValueError(
                f"REVIEWER_DISAGREEMENT_RECORD_MISMATCH:{record['caseId']}"
            )
        for dimension, disagreement in recorded_disagreements.items():
            proposed = {
                row["reviewerId"]: row["label"]
                for row in disagreement["proposedLabels"]
            }
            actual = {
                reviewer_id: values[dimension]
                for reviewer_id, values in recorded_by_reviewer.items()
                if dimension in values
            }
            if set(disagreement["reviewerIds"]) != set(actual) or proposed != actual:
                raise ValueError(
                    f"REVIEWER_DISAGREEMENT_EVIDENCE_MISMATCH:{record['caseId']}:{dimension}"
                )
        if status == "REVIEWED":
            if disagreement_rows:
                raise ValueError(
                    f"UNRESOLVED_DISAGREEMENT_NOT_ELIGIBLE:{record['caseId']}"
                )
            if any(
                value.get("confidence") in {"CANDIDATE", "UNCERTAIN"}
                for value in record["expected"].values()
                if value is not None
            ):
                raise ValueError(
                    f"UNCONFIRMED_GOLD_LABEL_NOT_ELIGIBLE:{record['caseId']}"
                )
            for values in recorded_by_reviewer.values():
                if any(
                    expected_dimensions[dimension] != label
                    for dimension, label in values.items()
                ):
                    raise ValueError(f"REVIEWED_LABEL_NOT_CONFIRMED:{record['caseId']}")
    adjudication = record.get("adjudication")
    if status == "ADJUDICATED" and not adjudication:
        raise ValueError(f"ADJUDICATION_METADATA_REQUIRED:{record['caseId']}")
    if status == "EXCLUDED" and not (record.get("exclusionReason") or "").strip():
        raise ValueError(f"EXCLUSION_REASON_REQUIRED:{record['caseId']}")
    if status == "UNCERTAIN" and not (record.get("uncertaintyReason") or "").strip():
        raise ValueError(f"UNCERTAINTY_REASON_REQUIRED:{record['caseId']}")
    if adjudication is not None:
        if (
            not adjudication.get("reviewerId")
            or not adjudication.get("identityVerificationRef")
            or not adjudication.get("reviewEvidenceRef")
            or adjudication.get("reviewerType") != "HUMAN"
        ):
            raise ValueError(f"ADJUDICATION_METADATA_REQUIRED:{record['caseId']}")
        outcome = adjudication["outcome"]
        if status == "ADJUDICATED" and outcome not in {"CONFIRM", "REVISE"}:
            raise ValueError(f"ADJUDICATION_STATUS_MISMATCH:{record['caseId']}")
        if status == "EXCLUDED" and outcome != "EXCLUDE":
            raise ValueError(f"ADJUDICATION_STATUS_MISMATCH:{record['caseId']}")
        if status == "UNCERTAIN" and outcome != "REMAIN_UNCERTAIN":
            raise ValueError(f"ADJUDICATION_STATUS_MISMATCH:{record['caseId']}")
        if adjudication["reviewerId"] in {
            reviewer["reviewerId"] for reviewer in reviewers
        }:
            raise ValueError(f"ADJUDICATOR_MUST_BE_INDEPENDENT:{record['caseId']}")
        if status == "ADJUDICATED":
            if any(
                value.get("confidence") in {"CANDIDATE", "UNCERTAIN"}
                for value in record["expected"].values()
                if value is not None
            ):
                raise ValueError(
                    f"UNCONFIRMED_GOLD_LABEL_NOT_ELIGIBLE:{record['caseId']}"
                )
            resolved = {
                row["dimension"]: row["label"] for row in adjudication["resolvedLabels"]
            }
            if not set(recorded_disagreements) <= set(resolved):
                raise ValueError(
                    f"ADJUDICATION_RESOLUTION_INCOMPLETE:{record['caseId']}"
                )
            if any(
                resolved[dimension] != expected_dimensions[dimension]
                for dimension in recorded_disagreements
            ):
                raise ValueError(f"ADJUDICATION_LABEL_MISMATCH:{record['caseId']}")
    if record["reviewerDisagreements"]:
        reviewer_ids = {reviewer["reviewerId"] for reviewer in reviewers}
        if any(
            not set(row["reviewerIds"]) <= reviewer_ids for row in disagreement_rows
        ):
            raise ValueError(f"DISAGREEMENT_REVIEWERS_REQUIRED:{record['caseId']}")
        for disagreement in disagreement_rows:
            dimension = disagreement["dimension"]
            actual = {
                reviewer["reviewerId"]: judgment["label"]
                for reviewer in reviewers
                for judgment in reviewer["dimensionJudgments"]
                if judgment["dimension"] == dimension
            }
            proposed = {
                row["reviewerId"]: row["label"]
                for row in disagreement["proposedLabels"]
            }
            if proposed != actual or set(disagreement["reviewerIds"]) != set(actual):
                raise ValueError(
                    f"REVIEWER_DISAGREEMENT_EVIDENCE_MISMATCH:{record['caseId']}:{dimension}"
                )


def load_dataset(path: str | Path) -> list[dict[str, Any]]:
    """Business purpose: Read the canonical JSONL annotation dataset without changing it.

    Business rules:
    - Each non-empty line is one complete annotation case and malformed JSON is rejected.
    - File order is preserved so human review retains stable case sequencing.

    Execution flow:
    1. Read UTF-8 JSONL bytes as text.
    2. Parse each non-empty line into one object and return the ordered records.

    Failure cases:
    - Invalid UTF-8, malformed JSON, or non-object rows fail rather than being skipped.

    Side effects:
    - None: performs read-only local file access.
    """
    records = []
    for line_number, line in enumerate(
        Path(path).read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise TypeError(f"ANNOTATION_ROW_NOT_OBJECT:{line_number}")
        records.append(value)
    return records
