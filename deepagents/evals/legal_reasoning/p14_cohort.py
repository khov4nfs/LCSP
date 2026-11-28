"""Exact identity pins for a small P14 SCRIPTED integration cohort."""

from __future__ import annotations

import argparse
import json
from hashlib import sha256
from pathlib import Path
from typing import Any

from evals.benchmark_runner import DEEPAGENTS_ROOT, _hash_repo_fixture_tree
from evals.benchmark_schema import BenchmarkCase
from evals.run_manifest import stable_hash

COHORT_VERSION = "LCSP-400-P14-SHARED-COHORT-V1"


def canonical_digest(value: Any) -> str:
    """Business purpose: Identify a canonical cohort record without formatting variance.

    Business rules:
    - The digest covers sorted-key UTF-8 JSON content, not file whitespace.
    - The fingerprint is an integrity identifier and does not establish legal validity.

    Execution flow:
    1. Serialize the supplied JSON-compatible object canonically.
    2. Return its lowercase SHA-256 digest.

    Failure cases:
    - Non-JSON-compatible values fail during serialization.

    Side effects:
    - None: performs an in-memory hash calculation.
    """
    return sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()


def fixture_fingerprints(
    case: BenchmarkCase, stage: str, rule_id: str
) -> dict[str, str]:
    """Business purpose: Pin the exact legal fixture, proposition, scenario, repository, and case reused by the cohort.

    Business rules:
    - This function verifies fixture identity only; synthetic fixture text is never treated as legal authority.
    - The selected rule and provision must exist in the same immutable P14 case object.

    Execution flow:
    1. Resolve one selected rule, legal provision, and lifecycle stage from the case.
    2. Verify provision text bytes match its declared content digest.
    3. Fingerprint each distinct source, proposition, scenario, repository tree, and whole-case object.

    Failure cases:
    - Raises ValueError when the rule/stage is unknown, the content digest is invalid, or the pinned repository fixture is missing.

    Side effects:
    - Reads checked-in P14 repository fixture files to fingerprint their bytes; performs no writes.
    """
    rule = next(
        (item for item in case.rule_definitions if item.rule_id == rule_id), None
    )
    provision = case.legal_provisions[0] if len(case.legal_provisions) == 1 else None
    if rule is None or provision is None:
        raise ValueError("P14_COHORT_RULE_OR_SINGLE_PROVISION_REQUIRED")
    if stage not in {item.stage for item in case.gold_rubric.stages}:
        raise ValueError("P14_COHORT_LIFECYCLE_STAGE_INVALID")
    content_digest = sha256(provision.content.encode("utf-8")).hexdigest()
    if content_digest != provision.content_sha256:
        raise ValueError("P14_COHORT_PROVISION_CONTENT_DIGEST_MISMATCH")
    repo_root = (DEEPAGENTS_ROOT / case.repo_pin.fixture_dir).resolve()
    tree_digest = _hash_repo_fixture_tree(repo_root)
    return {
        "legalSourceSha256": stable_hash(
            {
                "corpusPin": case.corpus_pin.model_dump(),
                "provision": provision.model_dump(),
            }
        ),
        "provisionContentSha256": content_digest,
        "targetPropositionSha256": sha256(
            rule.requirement_proposition.encode("utf-8")
        ).hexdigest(),
        "targetRuleSha256": stable_hash(rule.model_dump()),
        "scenarioSha256": stable_hash(
            {
                "caseId": case.case_id,
                "title": case.title,
                "taskCategory": case.task_category,
                "lifecycleStage": stage,
                "hitlAnswers": [row.model_dump() for row in case.hitl_answers],
                "ruleSetPin": case.rule_set_pin.model_dump(),
            }
        ),
        "repositorySnapshotSha256": stable_hash(
            {"repoPin": case.repo_pin.model_dump(), "fixtureTreeSha256": tree_digest}
        ),
        "p14CaseSha256": stable_hash(case.model_dump()),
    }


def cohort_digest(cohort: dict[str, Any]) -> str:
    """Business purpose: Hash the complete shared cohort definition while excluding its digest field.

    Business rules:
    - The version, classification, cases, and split references are covered by the digest.
    - A digest does not turn candidate fixture data into reviewed legal gold.

    Execution flow:
    1. Copy the artifact without its self-referential digest field.
    2. Return the canonical SHA-256 fingerprint.

    Failure cases:
    - Non-dictionary input raises TypeError.

    Side effects:
    - None: computes an in-memory digest.
    """
    if not isinstance(cohort, dict):
        raise TypeError("P14_COHORT_OBJECT_REQUIRED")
    return canonical_digest(
        {key: value for key, value in cohort.items() if key != "cohortSha256"}
    )


def load_cohort(path: str | Path) -> dict[str, Any]:
    """Business purpose: Load a versioned, integrity-checked engineering-only P14 cohort.

    Business rules:
    - Only explicitly synthetic SCRIPTED integration cohorts are accepted here.
    - Every row has a unique stable cohort ID and a fixed DEV/HOLDOUT assignment.

    Execution flow:
    1. Read UTF-8 JSON and check its version, purpose, digest, row shape, and unique IDs.
    2. Return the immutable parsed artifact for exact P14 mapping validation.

    Failure cases:
    - Invalid version, classification, digest, or duplicate IDs raises ValueError.

    Side effects:
    - Reads the selected local evaluation artifact only.
    """
    cohort = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        not isinstance(cohort, dict)
        or cohort.get("cohortVersion") != COHORT_VERSION
        or cohort.get("cohortKind") != "SYNTHETIC_P14_FIXTURE_ENGINEERING_ONLY"
        or cohort.get("cohortSha256") != cohort_digest(cohort)
        or not isinstance(cohort.get("cases"), list)
        or not cohort["cases"]
    ):
        raise ValueError("P14_COHORT_INVALID")
    ids = [row.get("cohortCaseId") for row in cohort["cases"] if isinstance(row, dict)]
    if len(ids) != len(cohort["cases"]) or len(ids) != len(set(ids)):
        raise ValueError("P14_COHORT_CASE_ID_INVALID")
    return cohort


def prepare_case_subset(
    source_cases: str | Path, cohort_path: str | Path, output: str | Path
) -> None:
    """Business purpose: Generate a runner input subset from exact checked-in P14 case records.

    Business rules:
    - No trace, outcome, legal text, rule, or scenario is authored by this command.
    - Each selected P14 case must match the cohort's pinned exact case and content fingerprints.

    Execution flow:
    1. Load the canonical P14 cases and the pinned cohort.
    2. Select only cohort case IDs, verify all recorded fixture fingerprints, and preserve source case objects.
    3. Write the resulting valid P14 case document for the existing benchmark runner.

    Failure cases:
    - Raises ValueError before writing when the case selection is unknown, stale, changed, or incomplete.

    Side effects:
    - Writes one derived case-subset JSON file; it contains only exact source case records.
    """
    from evals.benchmark_runner import load_benchmark_cases

    cohort = load_cohort(cohort_path)
    source_path = Path(source_cases)
    source_raw = json.loads(source_path.read_text(encoding="utf-8"))
    source_rows = source_raw["cases"] if isinstance(source_raw, dict) else source_raw
    source_by_id = {
        case.case_id: case for case in load_benchmark_cases(source_path, split="ALL")
    }
    selected = []
    for row in cohort["cases"]:
        case = source_by_id.get(row["p14CaseId"])
        if (
            case is None
            or fixture_fingerprints(case, row["lifecycleStage"], row["targetRuleId"])
            != row["fixtureFingerprints"]
        ):
            raise ValueError(f"P14_COHORT_CASE_STALE:{row.get('cohortCaseId')}")
        if case.split != row["split"]:
            raise ValueError(f"P14_COHORT_CASE_SPLIT_MISMATCH:{case.case_id}")
        selected.append(
            next(item for item in source_rows if item["case_id"] == case.case_id)
        )
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            {
                "schemaVersion": source_raw.get(
                    "schemaVersion", "LCSP_BENCHMARK_CASES_V1"
                ),
                "cases": selected,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    """Business purpose: Expose deterministic generation of the shared P14 runner input subset.

    Business rules:
    - The command only derives case input from the checked-in source and pinned cohort.
    - It never runs a model, creates a trace, or generates a review label.

    Execution flow:
    1. Parse source case, cohort, and output paths.
    2. Call the exact-fingerprint subset builder.

    Failure cases:
    - Invalid inputs propagate a nonzero command failure.

    Side effects:
    - Writes the requested derived subset file.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-cases", required=True, type=Path)
    parser.add_argument("--cohort", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    prepare_case_subset(args.source_cases, args.cohort, args.output)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "cohortCases": len(load_cohort(args.cohort)["cases"]),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
