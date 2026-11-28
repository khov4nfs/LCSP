"""Offline documentary policy baseline alongside the existing P14 Assessment Root harness."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from time import perf_counter
from typing import Any, Literal

from langsmith import tracing_context
from pydantic import BaseModel, ConfigDict, Field

from evals.benchmark_runner import (
    DEEPAGENTS_ROOT,
    build_benchmark_manifest,
    run_benchmark,
)
from evals.benchmark_schema import BenchmarkCase, RunConfig, TrialOutcome
from evals.run_manifest import digest, stable_hash
from evals.scorer import export_report_json, validate_run_artifacts_for_scoring

FIXTURES = Path(__file__).parent / "fixtures" / "policy-baseline"
ARTIFACT = "product-information.json"
SCOPE_PATH = f"{ARTIFACT}#/scope"
VERDICTS = {
    "PASS": "APPLICABLE_COMPLIANT",
    "FAIL": "APPLICABLE_NON_COMPLIANT",
    "UNKNOWN": "UNRESOLVED",
    "NOT_APPLICABLE": "NOT_APPLICABLE",
}
ROOT_VERDICTS = {verdict: label for label, verdict in VERDICTS.items()}


class Policy(BaseModel):
    """One narrow check of a field in the documentary snapshot."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^CRA-[A-Z-]+$")
    type: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    excerpt: str = Field(min_length=1)
    field: str = Field(pattern=r"^[a-zA-Z]+$")
    criterion: str = Field(min_length=1)
    pass_pattern: re.Pattern[str]
    fail_pattern: re.Pattern[str]
    limit: str = Field(min_length=1)


class ExcludedPolicy(BaseModel):
    """A source locator the benchmark tracks outside scoring."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class PolicySet(BaseModel):
    """Versioned legal excerpts and limits for the offline checks."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    version: str = Field(min_length=1)
    applicability: str = Field(min_length=1)
    policies: tuple[Policy, ...] = Field(min_length=1)
    excluded: tuple[ExcludedPolicy, ...]


def evaluate_policy(policy: Policy, artifact: dict[str, Any]) -> dict[str, Any]:
    """Business purpose: Check one documentary criterion over a frozen release record.
    Business rules:
    - Use stipulated scope and leave absent or unsupported evidence UNKNOWN.
    Execution flow:
    1. Resolve scope and compare the declared field if applicable.
    2. Return the verdict with present and missing evidence pointers.
    Failure cases:
    - Overlapping pass and fail patterns for an observed value invalidate the policy.
    Side effects:
    - Pure evaluation of supplied data.
    """
    scope = artifact.get("scope")
    applicability = {
        "COVERED_MANUFACTURER": "APPLICABLE",
        "NON_COMMERCIAL_FOSS": "NOT_APPLICABLE",
    }.get(scope if isinstance(scope, str) else "", "UNKNOWN")
    field_path = f"{ARTIFACT}#/{policy.field}"
    result: dict[str, Any] = {
        "applicability": applicability,
        "verdict": "UNKNOWN",
        "evidencePaths": [],
        "missingEvidence": [],
    }
    if applicability == "UNKNOWN":
        result["missingEvidence"] = [SCOPE_PATH]
        return result

    result["evidencePaths"] = [SCOPE_PATH]
    if applicability == "NOT_APPLICABLE":
        result["verdict"] = "NOT_APPLICABLE"
        return result

    # Only explicit contradictions can fail a check, even when the snapshot is incomplete.
    value = artifact.get(policy.field)
    recorded = isinstance(value, str) and value.casefold() not in {
        "unknown",
        "unverified",
    }
    passed = recorded and bool(policy.pass_pattern.fullmatch(value))
    failed = recorded and bool(policy.fail_pattern.fullmatch(value))
    if passed and failed:
        raise ValueError(f"AMBIGUOUS_POLICY:{policy.id}")
    if passed or failed:
        result["verdict"] = "PASS" if passed else "FAIL"
        result["evidencePaths"].append(field_path)
    else:
        result["missingEvidence"] = [field_path]
    return result


def _benchmark_case(
    policy: Policy,
    policy_set: PolicySet,
    snapshot: Path,
    tree_pin: str,
    expected: str,
) -> BenchmarkCase:
    """Business purpose: Bind one documentary criterion to the existing P14 case contract.
    Business rules:
    - Pass the same local repository snapshot and legal scope to P14.
    - Use seeded labels solely as fixture expectations.
    Execution flow:
    1. Pin the snapshot, legal excerpt and rule.
    2. Attach the fixture expectation for scoring.
    Failure cases:
    - Invalid fixture verdicts or missing P14 fields fail before runtime execution.
    Side effects:
    - Pure case construction.
    """
    # Keep the scripted category neutral so the fixture label cannot select a canned model response.
    requirement_id = f"LR-{policy.id}"
    provisions = [
        {
            "document_id": "CELEX-32024R2847-OJ",
            "locator": policy.locator,
            "title": policy_set.version,
            "content": policy.excerpt,
            "content_sha256": digest(policy.excerpt),
            "source_kind": "OFFICIAL_PINNED_LAW",
        }
    ]
    rules = [
        {
            "rule_id": policy.id,
            "concept": policy.type,
            "legal_requirement_id": requirement_id,
            "requirement_title": policy.id,
            "requirement_proposition": policy.criterion,
            "applicability_conditions": [policy_set.applicability],
            "criteria": [
                {
                    "criterionId": "C-1",
                    "statement": f"{policy.criterion} {policy.limit}",
                }
            ],
        }
    ]
    return BenchmarkCase.model_validate(
        {
            "case_id": f"{snapshot.name}-{policy.id}",
            "title": policy.id,
            "task_category": "cra_documentary_policy",
            "split": "DEV",
            "reviewer": "UNREVIEWED_FIXTURE",
            "reviewed_at": "UNREVIEWED",
            "repo_pin": {
                "repo_id": f"policy-{snapshot.name}",
                "commit_sha": tree_pin,
                "fixture_dir": str(snapshot.relative_to(DEEPAGENTS_ROOT)),
            },
            "corpus_pin": {
                "corpus_id": policy_set.source,
                "version": policy_set.version,
                "digest_sha256": stable_hash(provisions),
            },
            "rule_set_pin": {
                "rule_set_version_id": f"{policy.id}-v1",
                "rule_ids": [policy.id],
                "digest_sha256": stable_hash(rules),
            },
            "legal_provisions": provisions,
            "rule_definitions": rules,
            "gold_rubric": {
                "gold_revision": "cra-documentary-fixtures-v1-unreviewed",
                "stages": [
                    {
                        "stage": "INITIAL",
                        "expected_lifecycle_state": "PAUSED"
                        if expected == "UNKNOWN"
                        else "COMPLETE",
                        "expected_verdict": VERDICTS[expected],
                        "expected_hitl_state": "NONE",
                    }
                ],
            },
        }
    )


def _metrics(
    rows: list[dict[str, Any]], column: Literal["baseline", "root"]
) -> dict[str, Any]:
    """Business purpose: Measure conclusive predictions against the fixture labels.
    Business rules:
    - Score PASS and FAIL one-vs-rest on configured cases. UNKNOWN is an abstention.
    Execution flow:
    1. Count predicted and reference labels.
    2. Report class precision, recall and conclusive coverage.
    Failure cases:
    - Undefined ratios are null. Runtime errors retain their own count.
    Side effects:
    - Pure aggregation of completed comparison rows.
    """
    predictions = [row[column]["verdict"] for row in rows]
    counts = Counter(predictions)
    metrics: dict[str, Any] = {
        "verdictCounts": dict(counts),
        "conclusive": counts["PASS"] + counts["FAIL"],
    }
    for label in ("PASS", "FAIL"):
        support = sum(row["expected"] == label for row in rows)
        tp = sum(
            observed == row["expected"] == label
            for observed, row in zip(predictions, rows, strict=True)
        )
        metrics[label] = {
            "tp": tp,
            "fp": counts[label] - tp,
            "fn": support - tp,
            "precision": tp / counts[label] if counts[label] else None,
            "recall": tp / support if support else None,
        }
    return metrics


def run_policy_baseline(output_dir: Path) -> dict[str, Any]:
    """Business purpose: Compare deterministic CRA evidence checks and the offline LCSP Root graph.
    Business rules:
    - Both arms use the same frozen fixtures. P14 runs in SCRIPTED mode with a local model substitute.
    Execution flow:
    1. Bind checked-in cases to snapshot and source digests.
    2. Execute both arms and validate the P14 trial inventory and traces.
    3. Report per-rule disagreements, coverage, performance and errors.
    Failure cases:
    - Invalid inventory, a changed pin, or an existing output directory aborts the run.
    Side effects:
    - Reads packaged fixtures and writes only local benchmark artifacts.
    """
    policies_path = FIXTURES / "policies.json"
    expected_path = FIXTURES / "expected.json"
    policies_bytes = policies_path.read_bytes()
    expected_bytes = expected_path.read_bytes()
    policy_set = PolicySet.model_validate_json(policies_bytes)
    expected = json.loads(expected_bytes)
    policy_ids = {policy.id for policy in policy_set.policies}
    if len(policy_ids) != len(policy_set.policies) or not expected:
        raise ValueError("INVALID_POLICY_INVENTORY")

    cases: list[BenchmarkCase] = []
    rows: list[dict[str, Any]] = []
    snapshot_pins = {}
    for snapshot_id, labels in sorted(expected.items()):
        if not re.fullmatch(r"[a-z]+", snapshot_id) or set(labels) != policy_ids:
            raise ValueError("INVALID_POLICY_FIXTURE_INVENTORY")
        snapshot = FIXTURES / snapshot_id
        path = snapshot / ARTIFACT
        # P14 receives the entire fixture tree, so enforce the documentary-only input on both sides.
        if (
            snapshot.is_symlink()
            or path.is_symlink()
            or set(snapshot.iterdir()) != {path}
            or not path.is_file()
        ):
            raise ValueError("INVALID_POLICY_FIXTURE_TREE")
        data = path.read_bytes()
        tree_pin = stable_hash({ARTIFACT: digest(data)})
        snapshot_pins[f"policy-{snapshot_id}"] = {
            "snapshotKind": "SYNTHETIC_FIXTURE",
            "commitSha": tree_pin,
            "treeSha256": tree_pin,
        }
        artifact = json.loads(data)
        if not isinstance(artifact, dict):
            raise TypeError("INVALID_POLICY_ARTIFACT")
        for policy in policy_set.policies:
            label = labels[policy.id]
            case = _benchmark_case(policy, policy_set, snapshot, tree_pin, label)
            cases.append(case)
            started = perf_counter()
            baseline = evaluate_policy(policy, artifact)
            elapsed = (perf_counter() - started) * 1000
            rows.append(
                {
                    "caseId": case.case_id,
                    "snapshot": snapshot_id,
                    "treeSha256": tree_pin,
                    "ruleId": policy.id,
                    "type": policy.type,
                    "expected": label,
                    "baseline": {**baseline, "latencyMs": round(elapsed, 6)},
                }
            )

    config = RunConfig(
        mode="SCRIPTED",
        trials_per_case=1,
        k_values=(1,),
        model_route="benchmark-scripted-root",
    )
    output_dir.mkdir(parents=True, exist_ok=False)
    export_report_json(
        output_dir / "cases.json", {"cases": [case.model_dump() for case in cases]}
    )
    run_id = "root-scripted"
    manifest = build_benchmark_manifest(run_id=run_id, cases=cases, config=config)
    # The harness independently hashes the tree it serves to Root.
    if manifest["sourcePins"]["repoPinsSha256"] != stable_hash(snapshot_pins):
        raise ValueError("POLICY_P14_INPUT_DRIFT")
    # Traces stay in the benchmark output even on machines with LangSmith tracing configured.
    with tracing_context(enabled=False):
        run_benchmark(cases=cases, config=config, output_dir=output_dir, run_id=run_id)
    root_dir = output_dir / run_id
    recorded_manifest = json.loads((root_dir / "manifest.json").read_bytes())
    if (
        recorded_manifest != manifest
        or build_benchmark_manifest(run_id=run_id, cases=cases, config=config)
        != manifest
    ):
        raise ValueError("POLICY_P14_INPUT_DRIFT")

    trials = [
        TrialOutcome.model_validate_json(line)
        for line in (root_dir / "trials.jsonl").read_text().splitlines()
    ]
    validate_run_artifacts_for_scoring(manifest, trials, base_dir=root_dir)
    by_case = {trial.case_id: trial for trial in trials}
    for row in rows:
        trial = by_case[row["caseId"]]
        invalid = (
            trial.error_code or trial.authority_violation or not trial.graph_executed
        )
        root_verdict = (
            "ERROR"
            if invalid
            else ROOT_VERDICTS.get(trial.actual_verdict, trial.actual_verdict)
        )
        row["root"] = {
            "verdict": root_verdict,
            "actualVerdict": trial.actual_verdict,
            "errorCode": trial.error_code,
            "authorityViolation": trial.authority_violation,
            "graphExecuted": trial.graph_executed,
            "latencyMs": trial.latency_ms,
            "scriptedInvocations": trial.usage.scripted_invocations,
            "trace": f"{run_id}/{trial.trace_path}",
        }
        row["disagrees"] = row["baseline"]["verdict"] != root_verdict

    types = sorted(
        {policy.type for policy in (*policy_set.policies, *policy_set.excluded)}
    )
    report = {
        "referenceStatus": "SEEDED_UNREVIEWED",
        "comparisonMode": "SCRIPTED",
        "legalSource": {"url": policy_set.source, "version": policy_set.version},
        "policiesSha256": digest(policies_bytes),
        "referenceSha256": digest(expected_bytes),
        "adapterSha256": digest(Path(__file__).read_bytes()),
        "rootManifestSha256": manifest["manifestSha256"],
        "rows": rows,
        "excluded": [entry.model_dump() for entry in policy_set.excluded],
        "coverageByType": {
            kind: {
                "rules": sum(policy.type == kind for policy in policy_set.policies),
                "excluded": sum(policy.type == kind for policy in policy_set.excluded),
                "cases": sum(row["type"] == kind for row in rows),
                "verdictCounts": {
                    column: dict(
                        Counter(
                            row[column]["verdict"]
                            for row in rows
                            if row["type"] == kind
                        )
                    )
                    for column in ("baseline", "root")
                },
            }
            for kind in types
        },
        "metrics": {
            column: {
                **_metrics(rows, column),
                "latencyMs": round(sum(row[column]["latencyMs"] for row in rows), 6),
                "providerCalls": 0,
                "providerCost": 0,
            }
            for column in ("baseline", "root")
        },
    }
    export_report_json(output_dir / "policy-report.json", report)
    return report
