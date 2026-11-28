"""Build an official-source HITL vertical slice without executing a model or authoring gold."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

from evals.benchmark_schema import BenchmarkCase
from evals.legal_reasoning.p14_cohort import (
    canonical_digest,
    cohort_digest,
    fixture_fingerprints,
)
from evals.legal_reasoning.splits import build_split_manifest
from evals.legal_reasoning.validation import PACKAGE_ROOT, load_dataset
from evals.run_manifest import stable_hash


def build_official_hitl(output_dir: Path) -> dict:
    """Business purpose: Freeze a Vietnamese-law request/resume scenario for the real P14 runner.

    Business rules:
    - Reuse exact official Article 17 marking and Article 11 source pins and the frozen evidence gap.
    - The answer is simulated documentary evidence, never human legal review or actual gold.
    - Development, deployment, production and operational evidence remain relevant in one scope.
    - Waiting and resumed observations have distinct candidate IDs, bindings and labels.

    Execution flow:
    1. Copy the pinned marking case and attach an explicit verification request/answer and two stages.
    2. Freeze separate provisional expectations for the unresolved and resolved observations.
    3. Recompute cohort, split, map and candidate digests and save the small vertical slice.

    Failure cases:
    - Missing base assets or invalid case contracts stop generation before execution.

    Side effects:
    - Reads public evaluation assets and writes only the supplied evaluation directory.
    """
    read = lambda name: json.loads((PACKAGE_ROOT / name).read_text(encoding="utf-8"))
    cases = read("p14-cases.vn-ai.v1.json")["cases"]
    raw = copy.deepcopy(
        next(c for c in cases if c["case_id"] == "workbench-VN-AI-MEDIA-MARK")
    )
    raw["case_id"] = "vn-official-mark-verification-hitl"
    raw["title"] = "Verify an audiovisual output mark before concluding compliance"
    raw["task_category"] = "official_vn_mark_verification"
    raw["rule_definitions"][0]["applicability_conditions"] = [
        "Assess the admitted Vietnamese source as a whole. Retain relevant development, deployment, production and operational evidence; apply each obligation's actor, trigger, exception and temporal limits."
    ]
    raw["rule_set_pin"]["digest_sha256"] = stable_hash(raw["rule_definitions"])
    raw["hitl_answers"] = [
        {
            "request_key": "machine_readable_mark_verification",
            "question_pattern": "machine_readable_mark_verification",
            "answer": "SCRIPTED fixture response: the responsible provider's output verifier confirms a machine-readable AI-generation mark on the assessed audiovisual output. This is simulated evidence, not a human review.",
            "control_type": "FREE_TEXT",
            "resolves_fact": True,
        }
    ]
    template = raw["gold_rubric"]["stages"][0]
    raw["gold_rubric"]["stages"] = [
        {
            **template,
            "stage": "WAITING_FOR_HUMAN",
            "expected_lifecycle_state": "WAITING_FOR_HUMAN",
            "expected_verdict": "WAITING_FOR_HUMAN",
            "expected_hitl_state": "OPEN",
            "expected_persisted_state": {"openHumanRequests": 1},
        },
        {
            **template,
            "stage": "RESUME_FINAL",
            "expected_lifecycle_state": "COMPLETE",
            "expected_verdict": "APPLICABLE_COMPLIANT",
            "expected_hitl_state": "RESOLVED",
            "expected_persisted_state": {"openHumanRequests": 0},
        },
    ]
    case = BenchmarkCase.model_validate(raw)
    base = next(
        r
        for r in load_dataset(PACKAGE_ROOT / "candidate-cases.vn-ai.v1.jsonl")
        if r["caseId"] == "vn-ai-workbench-vn-ai-media-mark"
    )
    cohort_template = read("p14-shared-cohort.vn-ai.v2.json")
    source_pins = read("source-pins.vn-ai.v1.json")
    candidates, cohort_rows, maps = [], [], []
    for stage, compliance, evidence in [
        ("WAITING_FOR_HUMAN", "INSUFFICIENT_EVIDENCE", "MISSING"),
        ("RESUME_FINAL", "SUPPORTED_COMPLIANCE", "SUFFICIENT"),
    ]:
        row = copy.deepcopy(base)
        row["caseId"] = f"vn-official-mark-{stage.lower().replace(chr(95), chr(45))}"
        row["primaryDimension"] = "COMPLIANCE"
        row["caseDescription"] = (
            f"Article 17(1)-(4) and Law Article 11(2): {stage}; source-bound SCRIPTED evidence-gap lifecycle control."
        )
        row["annotationRationale"] = (
            "Provisional source-based proposal: marking duty belongs to provider; repository evidence does not verify the mark until the explicit simulated verification answer. No actual output supplies gold."
        )
        row["targetObligation"]["conditions"] = list(
            case.rule_definitions[0].applicability_conditions
        )
        for key in ("actor", "conditions", "exceptions", "unsupportedConclusion"):
            row["expected"][key] = None  # No invented human quality judgment.
        for key, label in [
            ("applicability", "APPLICABLE"),
            ("compliance", compliance),
            ("evidenceSufficiency", evidence),
        ]:
            row["expected"][key] = {
                "label": label,
                "confidence": "CANDIDATE",
                "details": [row["annotationRationale"]],
            }
        row["executionBinding"].update(
            p14CaseId=case.case_id,
            lifecycleStage=stage,
            fixtureFingerprints=fixture_fingerprints(case, stage, "VN-AI-MEDIA-MARK"),
        )
        cohort_id = "p14-" + row["caseId"]
        fingerprints = row["executionBinding"]["fixtureFingerprints"]
        cohort_row = copy.deepcopy(
            next(
                c
                for c in cohort_template["cases"]
                if c["p14CaseId"] == "workbench-VN-AI-MEDIA-MARK"
            )
        )
        cohort_row.update(
            cohortCaseId=cohort_id,
            candidateCaseId=row["caseId"],
            p14CaseId=case.case_id,
            lifecycleStage=stage,
            fixtureFingerprints=fingerprints,
        )
        candidates.append(row)
        cohort_rows.append(cohort_row)
        maps.append(
            {
                "cohortCaseId": cohort_id,
                "candidateCaseId": row["caseId"],
                "p14CaseId": case.case_id,
                "evaluationStage": "ASSESSMENT_ROOT",
                "lifecycleStage": stage,
                "p14RuleId": "VN-AI-MEDIA-MARK",
            }
        )
    cohort = {**cohort_template, "cases": cohort_rows}
    cohort["cohortSha256"] = cohort_digest(cohort)
    split = build_split_manifest(candidates, cohort)
    mapping = {
        "mappingVersion": "LCSP-400-P14-CASE-MAP-V3",
        "pinnedInputs": {
            "candidateDatasetSha256": canonical_digest(candidates),
            "p14CasesDatasetSha256": stable_hash([case.model_dump()]),
            "sourcePinsSha256": canonical_digest(source_pins),
            "sharedCohortSha256": cohort_digest(cohort),
            "splitManifestSha256": split["splitDigest"],
        },
        "caseMappings": maps,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    assets = {
        "cases.json": {"cases": [case.model_dump()]},
        "cohort.json": cohort,
        "map.json": mapping,
        "split.json": split,
        "overlay.json": {
            "overlayVersion": "LCSP-400-REVIEW-OVERLAY-V1",
            "candidateDatasetSha256": canonical_digest(candidates),
            "caseReviews": [],
        },
    }
    for name, value in assets.items():
        (output_dir / name).write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    (output_dir / "candidates.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in candidates),
        encoding="utf-8",
    )
    return {
        "p14Cases": 1,
        "candidateObservations": 2,
        "sourceKind": "OFFICIAL_PINNED_LAW",
        "reviewStatus": "CANDIDATE",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    print(json.dumps(build_official_hitl(parser.parse_args().output_dir)))
