"""Structural and provenance validation for LCSP-400 candidate annotations."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

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
REVIEWER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$")
REVIEW_REFERENCE_PATTERN = re.compile(
    r"^(?:https://[^\s]+|urn:lcsp-review:[A-Za-z0-9._:/-]+|synthetic-fixture-only://[A-Za-z0-9._:/-]+)$"
)
SYNTHETIC_REVIEW_MARKERS = (
    "synthetic",
    "fixture",
    "seeded",
    ".invalid",
    ".test",
    "example.",
)
P14_BINDING_FIELDS = {
    "runId",
    "manifestSha256",
    "candidateCaseId",
    "p14CaseId",
    "evaluationStage",
    "lifecycleStage",
    "trialIndex",
    "threadId",
    "traceSha256",
    "observedOutputSha256",
    "repositoryCommitSha",
    "corpusId",
    "corpusVersion",
    "ruleSetVersionId",
    "modelRoute",
    "instructionBundleDigest",
    "legalSourceId",
    "legalSourceVersion",
    "legalProvisionRefs",
    "legalCitations",
    "p14RuleId",
}


def _valid_review_identity(
    reviewer_id: Any, identity_ref: Any, *, allow_synthetic: bool
) -> bool:
    """Business purpose: Check the structure of a human-review identity reference.

    Business rules:
    - Human reviewer IDs must use a stable bounded identifier format.
    - Review references must be HTTPS or an LCSP review-record URN.
    - Synthetic, fixture, seeded, example, and invalid-domain references cannot qualify in actual mode.
    - This structural check does not authenticate a person or prove the referenced record exists.

    Execution flow:
    1. Validate the reviewer ID and reference syntax.
    2. Reject known synthetic markers unless an isolated synthetic test explicitly enables them.
    3. Return whether the record is structurally admissible for downstream review checks.

    Failure cases:
    - Missing, malformed, or prohibited references return False without raising.

    Side effects:
    - None: performs local string validation only.
    """
    if not isinstance(reviewer_id, str) or not REVIEWER_ID_PATTERN.fullmatch(
        reviewer_id
    ):
        return False
    if not isinstance(identity_ref, str) or not REVIEW_REFERENCE_PATTERN.fullmatch(
        identity_ref
    ):
        return False
    return allow_synthetic or all(
        marker not in reviewer_id.casefold() and marker not in identity_ref.casefold()
        for marker in SYNTHETIC_REVIEW_MARKERS
    )


def _valid_utc_timestamp(value: Any) -> bool:
    """Business purpose: Admit review timestamps only when they identify a UTC instant.

    Business rules:
    - Review and adjudication times must be ISO-8601 timestamps with an explicit zero UTC offset.
    - Local times without an offset and malformed dates cannot establish review order.

    Execution flow:
    1. Parse the supplied string as an ISO-8601 timestamp.
    2. Require an explicit UTC offset equal to zero.
    3. Return False for parse and type errors.

    Failure cases:
    - Invalid, naive, or non-UTC timestamps return False.

    Side effects:
    - None: parses metadata without changing it.
    """
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(
            value[:-1] + "+00:00" if value.endswith("Z") else value
        )
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() == timedelta(0)


def _valid_p14_binding(binding: Any) -> bool:
    """Business purpose: Verify the minimum P14 provenance needed to bind a review to one output.

    Business rules:
    - A review target is the exact run, manifest, case, lifecycle stage, trial, thread, trace, and output digest.
    - Repository, legal-corpus, rule-set, model-route, and instruction fingerprints remain attached.

    Execution flow:
    1. Require every P14 binding field and a non-negative trial index.
    2. Validate SHA-256 manifest, trace, and output fingerprints.
    3. Return whether the binding can identify one observed output.

    Failure cases:
    - Missing fields, invalid fingerprints, or malformed values return False.

    Side effects:
    - None: checks an in-memory provenance record only.
    """
    if not isinstance(binding, dict) or set(binding) != P14_BINDING_FIELDS:
        return False
    if not isinstance(binding.get("trialIndex"), int) or binding["trialIndex"] < 0:
        return False
    for name in ("manifestSha256", "traceSha256", "observedOutputSha256"):
        value = binding.get(name)
        if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
            return False
    for name in P14_BINDING_FIELDS - {
        "trialIndex",
        "manifestSha256",
        "traceSha256",
        "observedOutputSha256",
    }:
        value = binding.get(name)
        if not isinstance(value, str) or not value.strip():
            return False
    return bool(
        re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", binding["repositoryCommitSha"])
    )


def validate_dataset(
    records: list[dict[str, Any]],
    rubric: dict[str, Any],
    source_pins: dict[str, Any],
    *,
    allow_synthetic_reviews: bool = False,
) -> dict[str, Any]:
    """Business purpose: Admit only structurally valid, source-pinned annotation cases.

    Business rules:
    - Agent-authored labels remain CANDIDATE until genuine human review metadata is supplied.
    - The legal source identifier, pinned version, exact citation, and provision reference must
      resolve to the checked-in public source pin; production status values are not extended.
    - Counterfactual pairs must be reciprocal and unresolved disagreements cannot be scored.
    - Synthetic review identities are accepted only for explicit offline fixture validation.

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
    dataset_versions = {row.get("datasetVersion") for row in records}
    schema_name = {
        "LCSP-400-LEGAL-REASONING-CANDIDATES-V1": "annotation.schema.v1.json",
        "LCSP-400-VIETNAM-AI-CANDIDATES-V1": "annotation.schema.vn-ai.v1.json",
    }.get(next(iter(dataset_versions)) if len(dataset_versions) == 1 else None)
    if schema_name is None:
        raise ValueError("ANNOTATION_DATASET_VERSION_UNSUPPORTED")
    schema = json.loads((PACKAGE_ROOT / schema_name).read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
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
        target = record["evaluationTarget"]
        fixed = record["fixedOutputDiagnostic"]
        if target == "FIXED_CLAIM_DIAGNOSTIC":
            if not record["claimUnderReview"] or not fixed or record["expected"]:
                raise ValueError(f"FIXED_DIAGNOSTIC_TARGET_INVALID:{case_id}")
        elif fixed is not None:
            raise ValueError(f"FIXED_DIAGNOSTIC_TARGET_INVALID:{case_id}")
        elif (
            target == "ACTUAL_ASSESSMENT_OUTPUT"
            and record["stage"] != "ASSESSMENT_ROOT"
        ) or (
            target == "RULE_SET_PREPARATION_OUTPUT"
            and record["stage"] != "RULE_SET_PREPARATION"
        ):
            raise ValueError(f"EVALUATION_TARGET_STAGE_MISMATCH:{case_id}")
        gold_dimensions = _expected_dimensions(record)
        if not gold_dimensions:
            raise ValueError(f"ANNOTATION_EXPECTATION_MISSING:{case_id}")
        for field, expected in gold_dimensions.items():
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
        primary_value = gold_dimensions.get(primary_field)
        if primary_value is None:
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
                    or field not in gold_dimensions
                    or gold_dimensions[field] is None
                ):
                    raise ValueError(
                        f"REVIEW_JUDGMENT_DIMENSION_INVALID:{case_id}:{dimension}"
                    )
                if judgment["label"] not in labels_by_dimension[dimension]:
                    raise ValueError(
                        f"REVIEW_JUDGMENT_LABEL_INVALID:{case_id}:{dimension}:{judgment['label']}"
                    )
        legal_references = [
            record["legalSource"],
            *record.get("relatedLegalSources", []),
        ]
        source_ids = [reference["sourceId"] for reference in legal_references]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError(f"LEGAL_SOURCE_DUPLICATE:{case_id}")
        referenced_provisions: set[str] = set()
        for legal_ref in legal_references:
            source = source_by_id.get(legal_ref["sourceId"])
            if source is None:
                raise ValueError(
                    f"LEGAL_SOURCE_UNKNOWN:{case_id}:{legal_ref['sourceId']}"
                )
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
            referenced_provisions.update(
                f"{legal_ref['sourceId']}:{provision_id}"
                for provision_id in legal_ref["provisionRefs"]
            )
        if record["datasetVersion"] == "LCSP-400-VIETNAM-AI-CANDIDATES-V1":
            target = record["targetObligation"]
            if (
                target["semanticGroupId"] != record["semanticGroupId"]
                or not set(target["provisionRefs"]) <= referenced_provisions
                or not target["targetRuleId"]
                or not target["proposition"].strip()
            ):
                raise ValueError(f"LEGAL_TARGET_BINDING_INVALID:{case_id}")
            if source_pins.get("jurisdiction") != "VIETNAM":
                raise ValueError(f"LEGAL_SOURCE_JURISDICTION_INVALID:{case_id}")
            if any(
                source.get("jurisdiction") != "VIETNAM"
                or source.get("sourceKind") != "OFFICIAL_PINNED_LAW"
                or not re.fullmatch(r"[a-f0-9]{64}", source.get("pdfSha256", ""))
                for source in (
                    source_by_id[row["sourceId"]] for row in legal_references
                )
            ):
                raise ValueError(f"LEGAL_SOURCE_AUTHORITY_INVALID:{case_id}")
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
                if field is None or gold_dimensions.get(field) is None:
                    raise ValueError(
                        f"ADJUDICATION_DIMENSION_INVALID:{case_id}:{dimension}"
                    )
        _validate_review_record(record, allow_synthetic=allow_synthetic_reviews)

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


def _validate_review_record(
    record: dict[str, Any], *, allow_synthetic: bool = False
) -> None:
    """Business purpose: Prevent candidate labels from claiming human-reviewed authority.

    Business rules:
    - Scored labels require structurally valid human identities, UTC times, complete dimension judgments, and matching final labels.
    - ADJUDICATED requires an independent adjudicator to resolve every expected dimension that reviewers changed or disputed.
    - Known synthetic references are restricted to explicitly isolated fixture validation.
    - Candidate, provisional, uncertain, and excluded records never pass as reviewed gold.

    Execution flow:
    1. Validate reviewer IDs, references, decisions, timestamps, and exact dimension coverage.
    2. Match each recorded disagreement to the reviewers' actual labels.
    3. Verify all final labels have reviewer consensus or an independent adjudication.
    4. Preserve uncertain and provisional states outside scored-gold eligibility.

    Failure cases:
    - Missing human identities/evidence or unresolved disagreement raises a stable validation error.

    Side effects:
    - None: checks metadata only and makes no legal or human-review decision.
    """
    status = record["reviewStatus"]
    reviewers = record["reviewers"]
    disagreement_rows = record["reviewerDisagreements"]
    reviewer_ids = [reviewer.get("reviewerId") for reviewer in reviewers]
    if len(set(reviewer_ids)) != len(reviewer_ids):
        raise ValueError(f"DUPLICATE_REVIEWER_ID:{record['caseId']}")
    recorded_disagreements = {row["dimension"]: row for row in disagreement_rows}
    if len(recorded_disagreements) != len(disagreement_rows):
        raise ValueError(f"DUPLICATE_REVIEWER_DISAGREEMENT:{record['caseId']}")
    gold_dimensions = _expected_dimensions(record)
    expected_dimensions = {
        FIELD_DIMENSIONS[field]: value["label"]
        for field, value in gold_dimensions.items()
        if value is not None
    }
    for reviewer in reviewers:
        if reviewer.get("reviewerType") != "HUMAN":
            raise ValueError(f"REVIEWER_TYPE_INVALID:{record['caseId']}")
        if not _valid_review_identity(
            reviewer.get("reviewerId"),
            reviewer.get("identityVerificationRef"),
            allow_synthetic=allow_synthetic,
        ):
            raise ValueError(f"REVIEWER_IDENTITY_INVALID:{record['caseId']}")
        if not _valid_utc_timestamp(reviewer.get("reviewedAt")):
            raise ValueError(f"REVIEWER_TIMESTAMP_INVALID:{record['caseId']}")
        if reviewer.get("decision") not in {"CONFIRM", "REVISE", "UNSURE"}:
            raise ValueError(f"REVIEWER_DECISION_INVALID:{record['caseId']}")
        judgments = reviewer.get("dimensionJudgments", [])
        dimensions = [row.get("dimension") for row in judgments]
        if len(set(dimensions)) != len(dimensions):
            raise ValueError(
                f"DUPLICATE_REVIEW_DIMENSION:{record['caseId']}:{reviewer['reviewerId']}"
            )
        if set(reviewer.get("dimensionsReviewed", [])) != set(dimensions):
            raise ValueError(
                f"REVIEW_DIMENSIONS_MISMATCH:{record['caseId']}:{reviewer['reviewerId']}"
            )
        revised = False
        for judgment in judgments:
            dimension = judgment["dimension"]
            if dimension not in expected_dimensions:
                raise ValueError(
                    f"REVIEW_DIMENSION_NOT_EXPECTED:{record['caseId']}:{dimension}"
                )
            if (
                reviewer["decision"] == "CONFIRM"
                and judgment["label"] != expected_dimensions[dimension]
            ):
                raise ValueError(
                    f"REVIEW_DECISION_LABEL_MISMATCH:{record['caseId']}:{dimension}"
                )
            if (
                judgment.get("priorLabel") is not None
                and judgment["priorLabel"] != judgment["label"]
            ):
                revised = True
        if reviewer["decision"] == "REVISE" and not revised:
            raise ValueError(
                f"REVIEW_REVISION_UNRECORDED:{record['caseId']}:{reviewer['reviewerId']}"
            )
    recorded_by_reviewer = {
        reviewer["reviewerId"]: {
            judgment["dimension"]: judgment["label"]
            for judgment in reviewer["dimensionJudgments"]
        }
        for reviewer in reviewers
    }
    reviewer_labels: dict[str, dict[str, str]] = {}
    for dimension in expected_dimensions:
        reviewer_labels[dimension] = {
            reviewer_id: values[dimension]
            for reviewer_id, values in recorded_by_reviewer.items()
            if dimension in values
        }
    conflicting_dimensions = {
        dimension
        for dimension, values in reviewer_labels.items()
        if len(set(values.values())) > 1
    }
    if set(recorded_disagreements) != conflicting_dimensions and (
        conflicting_dimensions or recorded_disagreements
    ):
        raise ValueError(f"REVIEWER_DISAGREEMENT_RECORD_MISMATCH:{record['caseId']}")
    for dimension, disagreement in recorded_disagreements.items():
        proposed_rows = disagreement["proposedLabels"]
        proposed = {row["reviewerId"]: row["label"] for row in proposed_rows}
        actual = reviewer_labels.get(dimension, {})
        if (
            len(proposed) != len(proposed_rows)
            or set(disagreement["reviewerIds"]) != set(actual)
            or proposed != actual
            or len(set(proposed.values())) < 2
        ):
            raise ValueError(
                f"REVIEWER_DISAGREEMENT_EVIDENCE_MISMATCH:{record['caseId']}:{dimension}"
            )
    if status in {"REVIEWED", "ADJUDICATED"}:
        if not reviewers:
            raise ValueError(f"REVIEWER_METADATA_REQUIRED:{record['caseId']}")
        if any(reviewer["decision"] == "UNSURE" for reviewer in reviewers):
            raise ValueError(f"UNSURE_REVIEWER_NOT_ELIGIBLE:{record['caseId']}")
        if any(
            value.get("confidence") in {"CANDIDATE", "UNCERTAIN"}
            for value in _expected_dimensions(record).values()
            if value is not None
        ):
            raise ValueError(f"UNCONFIRMED_GOLD_LABEL_NOT_ELIGIBLE:{record['caseId']}")
    adjudication = record.get("adjudication")
    if status == "ADJUDICATED" and not adjudication:
        raise ValueError(f"ADJUDICATION_METADATA_REQUIRED:{record['caseId']}")
    if status == "EXCLUDED" and not (record.get("exclusionReason") or "").strip():
        raise ValueError(f"EXCLUSION_REASON_REQUIRED:{record['caseId']}")
    if status == "UNCERTAIN" and not (record.get("uncertaintyReason") or "").strip():
        raise ValueError(f"UNCERTAINTY_REASON_REQUIRED:{record['caseId']}")
    if adjudication is not None:
        if (
            adjudication.get("reviewerType") != "HUMAN"
            or not _valid_review_identity(
                adjudication.get("reviewerId"),
                adjudication.get("identityVerificationRef"),
                allow_synthetic=allow_synthetic,
            )
            or not _valid_review_identity(
                adjudication.get("reviewerId"),
                adjudication.get("reviewEvidenceRef"),
                allow_synthetic=allow_synthetic,
            )
            or not _valid_utc_timestamp(adjudication.get("adjudicatedAt"))
        ):
            raise ValueError(f"ADJUDICATION_METADATA_INVALID:{record['caseId']}")
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
            resolved_rows = adjudication["resolvedLabels"]
            resolved = {row["dimension"]: row for row in resolved_rows}
            if len(resolved) != len(resolved_rows):
                raise ValueError(f"DUPLICATE_ADJUDICATION_DIMENSION:{record['caseId']}")
            for dimension, row in resolved.items():
                if row["label"] != expected_dimensions.get(dimension):
                    raise ValueError(
                        f"ADJUDICATION_LABEL_MISMATCH:{record['caseId']}:{dimension}"
                    )
            unresolved = set()
            for dimension, final_label in expected_dimensions.items():
                labels = reviewer_labels.get(dimension, {})
                decisions = {
                    reviewer["decision"]
                    for reviewer in reviewers
                    if dimension in recorded_by_reviewer[reviewer["reviewerId"]]
                }
                if (
                    not labels
                    or any(label != final_label for label in labels.values())
                    or decisions != {"CONFIRM"}
                ):
                    unresolved.add(dimension)
            if not unresolved <= set(resolved):
                raise ValueError(
                    f"ADJUDICATION_RESOLUTION_INCOMPLETE:{record['caseId']}"
                )
            if set(resolved) - set(expected_dimensions):
                raise ValueError(f"ADJUDICATION_DIMENSION_INVALID:{record['caseId']}")
            if adjudication["outcome"] == "REVISE" and not any(
                row.get("priorLabel") is not None and row["priorLabel"] != row["label"]
                for row in resolved_rows
            ):
                raise ValueError(f"ADJUDICATION_REVISION_UNRECORDED:{record['caseId']}")
        elif status == "REVIEWED":
            if disagreement_rows:
                raise ValueError(
                    f"UNRESOLVED_DISAGREEMENT_NOT_ELIGIBLE:{record['caseId']}"
                )
            for dimension, final_label in expected_dimensions.items():
                values = reviewer_labels.get(dimension, {})
                decisions = {
                    reviewer["decision"]
                    for reviewer in reviewers
                    if dimension in recorded_by_reviewer[reviewer["reviewerId"]]
                }
                if (
                    not values
                    or any(label != final_label for label in values.values())
                    or decisions != {"CONFIRM"}
                ):
                    raise ValueError(
                        f"REVIEWED_LABEL_NOT_CONFIRMED:{record['caseId']}:{dimension}"
                    )


def _expected_dimensions(record: dict[str, Any]) -> dict[str, Any]:
    """Business purpose: Select the gold labels for the case's declared evaluation target.

    Business rules:
    - Actual generated-output targets use legal scenario outcomes in `expected`.
    - A fixed negative-control claim uses only its separately labelled diagnostic judgments.
    - The two gold sources are never merged or substituted for one another.

    Execution flow:
    1. Inspect the exact evaluationTarget.
    2. Return fixed-output judgments only for FIXED_CLAIM_DIAGNOSTIC.
    3. Return scenario legal expectations for other supported targets.

    Failure cases:
    - Missing or malformed target metadata returns an empty mapping for caller rejection.

    Side effects:
    - None: selects a view of the annotation without changing it.
    """
    target = record.get("evaluationTarget")
    if target == "FIXED_CLAIM_DIAGNOSTIC":
        fixed = record.get("fixedOutputDiagnostic")
        return fixed.get("expectedJudgments", {}) if isinstance(fixed, dict) else {}
    expected = record.get("expected")
    return expected if isinstance(expected, dict) else {}


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
