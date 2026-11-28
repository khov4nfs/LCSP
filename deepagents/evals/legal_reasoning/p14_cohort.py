"""Exact identity pins for LCSP-400 P14 SCRIPTED integration cohorts."""

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
    - Synthetic engineering fixtures and official law cases retain distinct source classifications.
    - Official provisions must be unique by document/locator and match their exact content digests.
    - The selected rule and all provisions must exist in the same immutable P14 case object.

    Execution flow:
    1. Resolve one selected rule, legal provisions, and lifecycle stage from the case.
    2. Verify every provision's text bytes and source classification.
    3. Fingerprint the selected source set, proposition, scenario, repository tree, and whole-case object.

    Failure cases:
    - Raises ValueError when the rule/stage is unknown, the content digest is invalid, or the pinned repository fixture is missing.

    Side effects:
    - Reads checked-in P14 repository fixture files to fingerprint their bytes; performs no writes.
    """
    rule = next(
        (item for item in case.rule_definitions if item.rule_id == rule_id), None
    )
    provisions = list(case.legal_provisions)
    if rule is None or not provisions:
        raise ValueError("P14_COHORT_RULE_OR_PROVISION_REQUIRED")
    if stage not in {item.stage for item in case.gold_rubric.stages}:
        raise ValueError("P14_COHORT_LIFECYCLE_STAGE_INVALID")
    if len(provisions) == 1 and provisions[0].source_kind == "SYNTHETIC_PINNED_LAW":
        provision = provisions[0]
        content_digest = sha256(provision.content.encode("utf-8")).hexdigest()
        if content_digest != provision.content_sha256:
            raise ValueError("P14_COHORT_PROVISION_CONTENT_DIGEST_MISMATCH")
        legal_source_digest = stable_hash(
            {
                "corpusPin": case.corpus_pin.model_dump(),
                "provision": provision.model_dump(),
            }
        )
    else:
        if any(
            provision.source_kind != "OFFICIAL_PINNED_LAW" for provision in provisions
        ):
            raise ValueError("P14_COHORT_MIXED_LEGAL_SOURCE_KINDS")
        identities = [(item.document_id, item.locator) for item in provisions]
        if len(identities) != len(set(identities)):
            raise ValueError("P14_COHORT_DUPLICATE_OFFICIAL_PROVISION")
        content_digests = []
        for provision in provisions:
            digest = sha256(provision.content.encode("utf-8")).hexdigest()
            if digest != provision.content_sha256:
                raise ValueError("P14_COHORT_PROVISION_CONTENT_DIGEST_MISMATCH")
            content_digests.append(digest)
        content_digest = stable_hash(content_digests)
        legal_source_digest = stable_hash(
            {
                "corpusPin": case.corpus_pin.model_dump(),
                "provisions": [item.model_dump() for item in provisions],
            }
        )
    repo_root = (DEEPAGENTS_ROOT / case.repo_pin.fixture_dir).resolve()
    tree_digest = _hash_repo_fixture_tree(repo_root)
    return {
        "legalSourceSha256": legal_source_digest,
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
    """Business purpose: Load a versioned P14 cohort with explicit source classification.

    Business rules:
    - Synthetic smoke cohorts and official Vietnamese source cohorts use distinct versioned classifications.
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
    accepted_kinds = {
        COHORT_VERSION: {"SYNTHETIC_P14_FIXTURE_ENGINEERING_ONLY"},
        "LCSP-400-P14-SHARED-COHORT-V2": {"OFFICIAL_VN_SOURCE_PINNED_P14_CASES"},
    }
    if (
        not isinstance(cohort, dict)
        or cohort.get("cohortKind")
        not in accepted_kinds.get(cohort.get("cohortVersion"), set())
        or cohort.get("cohortSha256") != cohort_digest(cohort)
        or not isinstance(cohort.get("cases"), list)
        or not cohort["cases"]
    ):
        raise ValueError("P14_COHORT_INVALID")
    ids = [row.get("cohortCaseId") for row in cohort["cases"] if isinstance(row, dict)]
    if len(ids) != len(cohort["cases"]) or len(ids) != len(set(ids)):
        raise ValueError("P14_COHORT_CASE_ID_INVALID")
    if cohort.get("cohortVersion") == "LCSP-400-P14-SHARED-COHORT-V2":
        allowed_fields = {
            "cohortCaseId",
            "candidateCaseId",
            "p14CaseId",
            "evaluationStage",
            "lifecycleStage",
            "targetRuleId",
            "splitGroupId",
            "split",
            "sourceKind",
            "jurisdiction",
            "corpusId",
            "corpusVersion",
            "corpusDigestSha256",
            "fixtureFingerprints",
        }
        if any(
            not isinstance(row, dict)
            or set(row) != allowed_fields
            or row.get("sourceKind") != "OFFICIAL_PINNED_LAW"
            or row.get("jurisdiction") != "VIETNAM"
            for row in cohort["cases"]
        ):
            raise ValueError("P14_OFFICIAL_COHORT_ROW_INVALID")
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
