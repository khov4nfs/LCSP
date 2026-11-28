"""Offline documentary policy baseline alongside the existing P14 Assessment Root harness."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from time import perf_counter
from typing import Any, Literal

from langsmith import tracing_context
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from evals.benchmark_runner import (
    DEEPAGENTS_ROOT,
    build_benchmark_manifest,
    run_benchmark,
)
from evals.benchmark_schema import (
    BenchmarkCase,
    BenchmarkSplit,
    GoldEvidenceCriterion,
    LegalProvisionFixture,
    RunConfig,
    TrialOutcome,
)
from evals.run_manifest import digest, stable_hash
from evals.scorer import export_report_json, validate_run_artifacts_for_scoring

FIXTURES = Path(__file__).parent / "fixtures" / "policy-baseline"
CORPUS = Path(__file__).parent / "corpora" / "lcsp-402-vn-cong-bao-v1"
ARTIFACT = "release-evidence.json"
SCOPE_PATH = f"{ARTIFACT}#/scope"
VERDICTS = {
    "PASS": "APPLICABLE_COMPLIANT",
    "FAIL": "APPLICABLE_NON_COMPLIANT",
    "UNKNOWN": "UNRESOLVED",
    "NOT_APPLICABLE": "NOT_APPLICABLE",
}
ROOT_VERDICTS = {verdict: label for label, verdict in VERDICTS.items()}
RUBRIC_ID = "LCSP-400-LEGAL-REASONING-RUBRIC-V1"


class Policy(BaseModel):
    """One narrow check of a field in the documentary snapshot."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^VN-AI-[A-Z-]+$")
    type: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    context: tuple[str, ...] = Field(min_length=1)
    field: str = Field(pattern=r"^[a-zA-Z]+$")
    criterion: str = Field(min_length=1)
    pass_pattern: re.Pattern[str] | None = None
    fail_pattern: re.Pattern[str] | None = None
    conditions: dict[str, bool] = Field(default_factory=dict)
    exceptions: tuple[str, ...] = ()
    limit: str = Field(min_length=1)


class VerifiedEvidence(BaseModel):
    """Transcribed documentary value supplied by the fixture author."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    status: Literal["VERIFIED_PRESENT"]
    value: str


class EvidenceGap(BaseModel):
    """Absence in an exhaustive record or evidence awaiting verification."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    status: Literal["EXPLICITLY_ABSENT", "MISSING", "UNVERIFIED"]


class ExcludedPolicy(BaseModel):
    """A source locator the benchmark tracks outside scoring."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class PolicySet(BaseModel):
    """Versioned legal excerpts and limits for the offline checks."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version: str = Field(min_length=1)
    applicability: str = Field(min_length=1)
    common_context: tuple[str, ...]
    policies: tuple[Policy, ...] = Field(min_length=1)
    excluded: tuple[ExcludedPolicy, ...]


class ReferenceCase(BaseModel):
    """Seeded verdict and independently specified evidence anchors."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    verdict: Literal["PASS", "FAIL", "UNKNOWN", "NOT_APPLICABLE"]
    evidence: list[str]
    negativeControl: bool
    expectsOpenHitl: bool = False


class ReferenceSnapshot(BaseModel):
    """One snapshot assigned to exactly one split."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    split: BenchmarkSplit
    cases: dict[str, ReferenceCase]


def _load_legal_context() -> tuple[dict[str, LegalProvisionFixture], dict[str, Any]]:
    """Business purpose: Bind the policy benchmark to checked-in Vietnamese Công báo sources.
    Business rules:
    - Every provision comes from a named P05 source and valid page range.
    Execution flow:
    1. Load the manifest and selected article extracts.
    2. Verify each relevant PDF against its P05 SHA-256.
    3. Return provision fixtures and a receipt pinning both PDFs and extracts.
    Failure cases:
    - Reject unknown documents, unreadable sources, mismatched PDF bytes or invalid page ranges.
    Side effects:
    - Reads local legal artifacts without contacting any service.
    """
    manifest = (CORPUS / "manifest.json").read_bytes()
    extracts = (FIXTURES / "legal-context.json").read_bytes()
    official_docs = {item["number"]: item for item in json.loads(manifest)["documents"]}
    context: dict[str, LegalProvisionFixture] = {}
    sources = {}
    for key, excerpt in json.loads(extracts).items():
        number = excerpt["document"]
        document = official_docs[number]
        if number not in sources:
            # P14 receives normalized article text. The receipt pins the original PDF separately.
            path = CORPUS / document["file"]
            if (
                path.parent != CORPUS
                or path.is_symlink()
                or digest(path.read_bytes()) != document["sha256"]
            ):
                raise ValueError(f"POLICY_SOURCE_PDF_DRIFT:{number}")
            sources[number] = {
                "url": document["sourcePage"],
                "pdfSha256": document["sha256"],
            }
        first, last = excerpt["pages"]
        if not 1 <= first <= last <= document["pages"]:
            raise ValueError(f"INVALID_POLICY_SOURCE_PAGES:{key}")
        content = excerpt["text"]
        context[key] = LegalProvisionFixture(
            document_id=number,
            locator=excerpt["locator"],
            title=f"{number} · Công báo PDF trang {first}–{last}",
            content=content,
            content_sha256=digest(content),
            source_kind="OFFICIAL_PINNED_LAW",
        )
    return context, {
        "manifestSha256": digest(manifest),
        "extractsSha256": digest(extracts),
        "documents": sources,
    }


def evaluate_policy(policy: Policy, artifact: dict[str, Any]) -> dict[str, Any]:
    """Business purpose: Check one documentary criterion over a frozen release record.
    Business rules:
    - Use stipulated scope and release conditions. Require a verified transcription or explicit absence.
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
        "IN_SCOPE": "APPLICABLE",
        "OUT_OF_SCOPE": "NOT_APPLICABLE",
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

    # An explicit exclusion is sufficient even if another applicability fact is missing.
    for field, expected in policy.conditions.items():
        if type(artifact.get(field)) is bool and artifact[field] is not expected:
            result["evidencePaths"].append(f"{ARTIFACT}#/{field}")
            result.update(applicability="NOT_APPLICABLE", verdict="NOT_APPLICABLE")
            return result
    for field in policy.conditions:
        pointer = f"{ARTIFACT}#/{field}"
        if type(artifact.get(field)) is bool:
            result["evidencePaths"].append(pointer)
        else:
            result["missingEvidence"].append(pointer)
    if result["missingEvidence"]:
        result["applicability"] = "UNKNOWN"
        return result

    raw = artifact.get(policy.field)
    try:
        record = EvidenceGap.model_validate(raw)
    except ValidationError:
        record = None
    if record is not None and record.status == "EXPLICITLY_ABSENT":
        result["verdict"] = "FAIL"
        result["evidencePaths"].append(field_path)
        return result

    try:
        verified = VerifiedEvidence.model_validate(raw)
    except ValidationError:
        result["missingEvidence"] = [field_path]
        return result

    # Only fixture-certified transcriptions are eligible for content and format checks.
    value = verified.value
    if policy.pass_pattern is None:
        passed = bool(value.strip())
    else:
        passed = bool(policy.pass_pattern.fullmatch(value))
    failed = policy.fail_pattern is not None and bool(
        policy.fail_pattern.fullmatch(value)
    )
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
    reference: ReferenceCase,
    split: BenchmarkSplit,
    evidence_criteria: list[GoldEvidenceCriterion],
    legal_context: dict[str, LegalProvisionFixture],
    corpus_digest: str,
) -> BenchmarkCase:
    """Business purpose: Bind one documentary criterion to the existing P14 case contract.
    Business rules:
    - Pass the same local repository snapshot and legal scope to P14.
    - Use seeded labels solely as fixture expectations.
    Execution flow:
    1. Pin the snapshot, Vietnamese provisions and rule.
    2. Bind fixture expectations to independently declared evidence and workflow criteria.
    Failure cases:
    - Open HITL with a conclusive fixture verdict or invalid P14 input fails before runtime execution.
    Side effects:
    - Pure case construction.
    """
    # Keep the scripted category neutral so the fixture label cannot select a canned model response.
    expected = reference.verdict
    if reference.expectsOpenHitl and expected != "UNKNOWN":
        raise ValueError("CONCLUSIVE_POLICY_GOLD_WITH_OPEN_HITL")
    # An unresolved documentary fact may require an open human request from the Root.
    lifecycle = "PAUSED" if expected == "UNKNOWN" else "COMPLETE"
    if reference.expectsOpenHitl:
        lifecycle = "WAITING_FOR_HUMAN"
    requirement_id = f"LR-{policy.id}"
    # Supply each source locator explicitly and keep policy interpretation in the rule fixture.
    provisions = [
        legal_context[locator]
        for locator in dict.fromkeys(
            (policy.locator, *policy.context, *policy_set.common_context)
        )
    ]
    rules = [
        {
            "rule_id": policy.id,
            "concept": policy.type,
            "legal_requirement_id": requirement_id,
            "requirement_title": policy.id,
            "requirement_proposition": policy.criterion,
            "applicability_conditions": [policy_set.applicability],
            "exceptions": list(policy.exceptions),
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
            "task_category": "vn_ai_documentary_policy",
            "split": split,
            "is_negative_control": reference.negativeControl,
            "reviewer": "UNREVIEWED_FIXTURE",
            "reviewed_at": "UNREVIEWED",
            "locale": "vi",
            "repo_pin": {
                "repo_id": f"policy-{snapshot.name}",
                "commit_sha": tree_pin,
                "fixture_dir": str(snapshot.relative_to(DEEPAGENTS_ROOT)),
            },
            "corpus_pin": {
                "corpus_id": CORPUS.name,
                "version": policy_set.version,
                "digest_sha256": corpus_digest,
            },
            "rule_set_pin": {
                "rule_set_version_id": f"{policy.id}-v2",
                "rule_ids": [policy.id],
                "digest_sha256": stable_hash(rules),
            },
            "legal_provisions": provisions,
            "rule_definitions": rules,
            "gold_rubric": {
                "gold_revision": "vn-ai-documentary-fixtures-v1-unreviewed",
                "stages": [
                    {
                        "stage": "WAITING_FOR_HUMAN"
                        if reference.expectsOpenHitl
                        else "INITIAL",
                        "expected_lifecycle_state": lifecycle,
                        "expected_verdict": "WAITING_FOR_HUMAN"
                        if reference.expectsOpenHitl
                        else VERDICTS[expected],
                        "required_evidence_criteria": evidence_criteria,
                        "expected_hitl_state": "OPEN"
                        if reference.expectsOpenHitl
                        else "NONE",
                        "expected_persisted_state": {
                            "openHumanRequests": int(reference.expectsOpenHitl)
                        },
                    }
                ],
            },
        }
    )


def _evidence_criteria(source: str, fields: list[str]) -> list[GoldEvidenceCriterion]:
    """Business purpose: Require P14 to cite the fixture lines supporting each seeded reference.
    Business rules:
    - Evidence anchors are independently declared in the case inventory.
    - Source lines support documentary observations while LCSP-400 human review judges sufficiency.
    Execution flow:
    1. Locate each declared field in the frozen source before generating the P14 case.
    2. Record the exact path, span and text.
    Failure cases:
    - Missing, duplicate, or ambiguous anchors invalidate the fixture.
    Side effects:
    - Pure mapping from immutable fixture bytes and declared anchor fields.
    """
    if not fields or len(fields) != len(set(fields)):
        raise ValueError("INVALID_POLICY_GOLD_ANCHORS")
    criteria = []
    for field in fields:
        # Each documentary observation occupies one top-level line in the fixture format.
        matches = [
            (number, line.strip())
            for number, line in enumerate(source.splitlines(), 1)
            if line.startswith(f"  {json.dumps(field)}:")
        ]
        if len(matches) != 1:
            raise ValueError(f"UNBOUND_POLICY_GOLD_ANCHOR:{field}")
        number, text = matches[0]
        criteria.append(
            GoldEvidenceCriterion(
                path=ARTIFACT,
                required_span=(number, number),
                required_text_substrings=(text,),
                fact_to_prove=f"Documentary observation at /{field}",
            )
        )
    return criteria


def _metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
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
    predictions = [row["baseline"]["verdict"] for row in rows]
    counts = Counter(predictions)
    metrics: dict[str, Any] = {
        "verdictCounts": dict(counts),
        "verdictMatches": sum(
            observed == row["expected"]
            for observed, row in zip(predictions, rows, strict=True)
        ),
        "negativeControls": sum(row["negativeControl"] for row in rows),
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
    """Business purpose: Evaluate Vietnamese documentary checks and verify P14 integration offline.
    Business rules:
    - Both runs use the same frozen inputs. SCRIPTED supplies smoke diagnostics only.
    Execution flow:
    1. Bind checked-in cases to snapshot and source digests.
    2. Execute both arms and validate the P14 trial inventory and traces.
    3. Report baseline metrics by split and separate P14 smoke checks.
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
    expected = TypeAdapter(dict[str, ReferenceSnapshot]).validate_json(expected_bytes)
    legal_context, source_pin = _load_legal_context()
    corpus_digest = stable_hash(source_pin)
    policy_ids = {policy.id for policy in policy_set.policies}
    if len(policy_ids) != len(policy_set.policies) or {
        item.split for item in expected.values()
    } != {"DEV", "HOLDOUT"}:
        raise ValueError("INVALID_POLICY_INVENTORY")

    cases: list[BenchmarkCase] = []
    rows: list[dict[str, Any]] = []
    snapshot_pins = {}
    for snapshot_id, reference in sorted(expected.items()):
        if (
            not re.fullmatch(r"[a-z]+", snapshot_id)
            or set(reference.cases) != policy_ids
        ):
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
        source = data.decode("utf-8")
        artifact = json.loads(source)
        if not isinstance(artifact, dict):
            raise TypeError("INVALID_POLICY_ARTIFACT")
        for policy in policy_set.policies:
            label = reference.cases[policy.id]
            case = _benchmark_case(
                policy,
                policy_set,
                snapshot,
                tree_pin,
                label,
                reference.split,
                _evidence_criteria(source, label.evidence),
                legal_context,
                corpus_digest,
            )
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
                    "split": case.split,
                    "negativeControl": case.is_negative_control,
                    "expected": label.verdict,
                    "baseline": {**baseline, "latencyMs": round(elapsed, 6)},
                }
            )

    config = RunConfig(
        mode="SCRIPTED",
        trials_per_case=1,
        k_values=(1,),
        locale="vi",
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
    stages = {case.case_id: case.gold_rubric.stages[0] for case in cases}
    for row in rows:
        trial = by_case[row["caseId"]]
        expected_stage = stages[trial.case_id]
        invalid = (
            trial.error_code or trial.authority_violation or not trial.graph_executed
        )
        root_verdict = (
            "ERROR"
            if invalid
            else ROOT_VERDICTS.get(trial.actual_verdict, trial.actual_verdict)
        )
        lifecycle_match = (
            trial.lifecycle_state == expected_stage.expected_lifecycle_state
        )
        verdict_match = bool(not invalid and trial.verdict_match)
        # Anchor matching tests citation coverage; legal sufficiency needs a human judgment.
        row["rootSmoke"] = {
            "verdict": root_verdict,
            "actualVerdict": trial.actual_verdict,
            "errorCode": trial.error_code,
            "authorityViolation": trial.authority_violation,
            "graphExecuted": trial.graph_executed,
            "latencyMs": trial.latency_ms,
            "scriptedInvocations": trial.usage.scripted_invocations,
            "trace": f"{run_id}/{trial.trace_path}",
            "verdictMatch": verdict_match,
            "evidenceAnchorsMatch": trial.evidence_match,
            "evidenceGroundedVerdictMatch": verdict_match and trial.evidence_match,
            "hitlMatch": trial.hitl_match,
            "lifecycleMatch": lifecycle_match,
            "persistedStateMatch": trial.persisted_state_match,
            "workflowMatch": bool(
                not invalid
                and trial.hitl_match
                and lifecycle_match
                and trial.persisted_state_match
            ),
        }

    types = sorted(
        {policy.type for policy in (*policy_set.policies, *policy_set.excluded)}
    )
    report = {
        "referenceStatus": "SEEDED_UNREVIEWED",
        "comparisonMode": "SCRIPTED_SMOKE_ONLY",
        "semanticAssessment": {"status": "NOT_SCORED", "rubricId": RUBRIC_ID},
        "legalSource": {
            "corpusId": CORPUS.name,
            "version": policy_set.version,
            **source_pin,
        },
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
                "verdictCounts": dict(
                    Counter(
                        row["baseline"]["verdict"]
                        for row in rows
                        if row["type"] == kind
                    )
                ),
            }
            for kind in types
        },
        "metrics": {
            split: {
                **_metrics([row for row in rows if row["split"] == split]),
                "latencyMs": round(
                    sum(
                        row["baseline"]["latencyMs"]
                        for row in rows
                        if row["split"] == split
                    ),
                    6,
                ),
                "providerCalls": 0,
                "providerCost": 0,
            }
            for split in ("DEV", "HOLDOUT")
        },
        "rootSmokeMetrics": {
            "cases": len(rows),
            "graphExecuted": sum(trial.graph_executed for trial in trials),
            "errors": sum(row["rootSmoke"]["verdict"] == "ERROR" for row in rows),
            "negativeControls": sum(row["negativeControl"] for row in rows),
            "providerCalls": sum(trial.usage.physical_attempts for trial in trials),
            "latencyMs": round(sum(trial.latency_ms for trial in trials), 6),
            **{
                check: sum(row["rootSmoke"][check] for row in rows)
                for check in (
                    "verdictMatch",
                    "evidenceAnchorsMatch",
                    "evidenceGroundedVerdictMatch",
                    "hitlMatch",
                    "lifecycleMatch",
                    "persistedStateMatch",
                    "workflowMatch",
                )
            },
        },
    }
    export_report_json(output_dir / "policy-report.json", report)
    return report
