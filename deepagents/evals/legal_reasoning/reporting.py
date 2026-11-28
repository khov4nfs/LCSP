"""Reproduce the LCSP-400 candidate diagnostic and synthetic scorer reports."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from hashlib import sha256
from pathlib import Path
from typing import Any

from evals.legal_reasoning.scorer import score_dataset
from evals.legal_reasoning.validation import (
    PACKAGE_ROOT,
    load_dataset,
    validate_dataset,
)

SYNTHETIC_FIXTURE_PATH = (
    PACKAGE_ROOT.parents[1]
    / "tests"
    / "fixtures"
    / "legal_reasoning"
    / "synthetic-scorer-fixture.v1.json"
)


def build_r1_reports(output_directory: str | Path | None = None) -> dict[str, Any]:
    """Business purpose: Reproduce R1 diagnostics without describing fixtures as model results.

    Business rules:
    - Candidate diagnostics summarize only the canonical candidate annotations and cannot score them.
    - The synthetic scorer report uses a physically separate, explicitly synthetic test fixture.
    - Neither report is an actual LCSP execution baseline or a claim of human-reviewed legal truth.

    Execution flow:
    1. Load and validate the canonical candidate dataset, rubric, and public source pins.
    2. Build the candidate-only inventory and its reproducible content digest.
    3. Score the isolated synthetic fixture through the production scorer interface.
    4. Write both versioned reports to the caller-selected directory and return them.

    Failure cases:
    - Invalid candidate provenance, rubric labels, fixture metadata, or report paths fail rather than
      produce a partial or misleading report.

    Side effects:
    - Reads local evaluation files and writes two JSON reports to the explicit report directory.
    """
    destination = (
        Path(output_directory) if output_directory else PACKAGE_ROOT / "reports"
    )
    records = load_dataset(PACKAGE_ROOT / "candidate-cases.v1.jsonl")
    rubric = _read_json(PACKAGE_ROOT / "rubric.v1.json")
    source_pins = _read_json(PACKAGE_ROOT / "source-pins.v1.json")
    inventory = validate_dataset(records, rubric, source_pins)
    source = source_pins["sources"][0]
    citations = sorted(
        {citation for row in records for citation in row["legalSource"]["citations"]}
    )
    candidate_bytes = json.dumps(
        records, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    candidate_report = {
        "reportVersion": "LCSP-400-CANDIDATE-ANNOTATION-DIAGNOSTICS-V1",
        "reportClassification": "CANDIDATE_ANNOTATION_DIAGNOSTICS_ONLY",
        "datasetVersion": rubric["datasetVersion"],
        "rubricVersion": rubric["rubricVersion"],
        "datasetCanonicalSha256": sha256(candidate_bytes).hexdigest(),
        "caseCount": inventory["caseCount"],
        "stageCounts": dict(sorted(Counter(row["stage"] for row in records).items())),
        "primaryDimensionCounts": dict(
            sorted(Counter(row["primaryDimension"] for row in records).items())
        ),
        "counterfactualPairCount": inventory["counterfactualPairCount"],
        "sourcePin": {
            "sourceId": source["sourceId"],
            "sourceVersion": source["sourceVersion"],
            "sourceUrl": source["sourceUrl"],
        },
        "verifiedCitationReferences": citations,
        "verifiedCitationReferenceCount": len(citations),
        "reviewStatusCounts": inventory["reviewStatusCounts"],
        "candidateAnnotationCount": inventory["reviewStatusCounts"]["CANDIDATE"],
        "humanReviewedAnnotationCount": 0,
        "provisionalAnnotationCount": 0,
        "excludedAnnotationCount": 0,
        "unresolvedDisagreementCount": 0,
        "humanReviewedSemanticEvaluation": {
            "status": "NOT_STARTED",
            "eligibleReviewedCases": 0,
        },
        "qualityMetrics": None,
        "actualExecutionBaseline": {
            "status": "NOT_RUN",
            "reason": "No compatible authorized LCSP run artifact was supplied for R1.",
        },
    }
    fixture = _read_json(SYNTHETIC_FIXTURE_PATH)
    synthetic_report = score_dataset(
        fixture["annotations"], fixture["predictions"], rubric, source_pins
    )
    synthetic_report["reportClassification"] = "SYNTHETIC_SCORER_VERIFICATION_ONLY"
    synthetic_report["fixtureWarning"] = fixture["warning"]
    synthetic_report["candidateDatasetUsed"] = False
    synthetic_report["humanReviewedSemanticEvaluation"] = {
        "status": "NOT_STARTED",
        "eligibleReviewedCases": 0,
    }
    synthetic_report["actualExecutionBaseline"] = {"status": "NOT_RUN"}
    destination.mkdir(parents=True, exist_ok=True)
    _write_json(destination / "candidate-diagnostics.v1.json", candidate_report)
    _write_json(destination / "scorer-verification.v1.json", synthetic_report)
    return {
        "candidateDiagnostics": candidate_report,
        "syntheticScorerVerification": synthetic_report,
    }


def _read_json(path: Path) -> Any:
    """Business purpose: Read a local, versioned JSON input for the R1 report builder.

    Business rules:
    - Reports use checked-in local inputs and never fetch sources or invoke a model.

    Execution flow:
    1. Read the selected UTF-8 file.
    2. Parse JSON and return its structured value.

    Failure cases:
    - Missing files or invalid JSON stop report generation before any output is written.

    Side effects:
    - None beyond read-only access to the selected file.
    """
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: dict[str, Any]) -> None:
    """Business purpose: Persist a deterministic report artifact for human review.

    Business rules:
    - Reports use stable sorted keys, UTF-8 text, and a trailing newline.
    - Output paths are limited to the report directory supplied by the caller.

    Execution flow:
    1. Serialize the report with stable JSON key ordering.
    2. Write the complete report file to the selected path.

    Failure cases:
    - Serialization or filesystem errors are surfaced and do not claim report completion.

    Side effects:
    - Writes one generated report file.
    """
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    """Business purpose: Offer a repeatable offline command for the two R1 report artifacts.

    Business rules:
    - The command reads only checked-in candidate and synthetic fixture data.
    - It cannot report live model quality or mark candidate labels as human-reviewed.

    Execution flow:
    1. Parse the destination directory.
    2. Generate candidate diagnostics and synthetic scorer verification.
    3. Print the classifications and return success.

    Failure cases:
    - Validation, input, or output errors propagate as a non-zero command failure.

    Side effects:
    - Writes two deterministic JSON reports to the requested output directory.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=PACKAGE_ROOT / "reports")
    args = parser.parse_args()
    reports = build_r1_reports(args.output_dir)
    print(
        "candidate diagnostics: "
        + reports["candidateDiagnostics"]["reportClassification"]
    )
    print(
        "synthetic scorer: "
        + reports["syntheticScorerVerification"]["reportClassification"]
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
