"""Official source and lifecycle controls; no fixture constitutes real review or LIVE evidence."""

from __future__ import annotations

import json
import subprocess
from copy import deepcopy
from hashlib import sha256

import pytest

from evals.benchmark_runner import load_benchmark_cases, run_benchmark
from evals.benchmark_schema import RunConfig, TrialOutcome
from evals.cli import main as eval_cli
from evals.legal_reasoning.official_hitl import build_official_hitl
from evals.legal_reasoning.p14_adapter import (
    _observed_output_from_trace,
    integrate_p14_artifacts,
)
from evals.legal_reasoning.p14_cohort import canonical_digest
from evals.legal_reasoning.preparation_adapter import integrate_preparation_artifacts
from evals.legal_reasoning.provision_frames import (
    build_review_frames,
    validate_review_frames,
)
from evals.legal_reasoning.validation import PACKAGE_ROOT
from evals.run_manifest import stable_hash


@pytest.fixture(scope="module")
def official_run(tmp_path_factory):
    root = tmp_path_factory.mktemp("official-vn-hitl")
    package = root / "package"
    build_official_hitl(package)
    cases = load_benchmark_cases(package / "cases.json")
    split = json.loads((package / "split.json").read_text())
    run_benchmark(
        cases=cases,
        config=RunConfig(
            mode="SCRIPTED",
            trials_per_case=1,
            k_values=(1,),
            git_commit_sha=subprocess.check_output(
                ["git", "rev-parse", "HEAD"], text=True
            ).strip(),
            case_split_manifest_sha256=split["splitDigest"],
        ),
        output_dir=root / "runs",
        run_id="official-vn-hitl-test",
    )
    return package, root / "runs" / "official-vn-hitl-test", cases


def test_official_vietnamese_request_resume_has_exact_source_output_and_fact_bindings(
    official_run,
):
    package, run, _ = official_run
    report = integrate_p14_artifacts(
        manifest_path=run / "manifest.json",
        trials_path=run / "trials.jsonl",
        p14_cases_path=package / "cases.json",
        candidate_cases_path=package / "candidates.jsonl",
        case_mapping_path=package / "map.json",
        shared_cohort_path=package / "cohort.json",
        split_manifest_path=package / "split.json",
        review_overlay_path=package / "overlay.json",
    )
    rows = {r["lifecycleStage"]: r for r in report["normalizedObservedOutputs"]}
    waiting, resumed = rows["WAITING_FOR_HUMAN"], rows["RESUME_FINAL"]
    assert waiting["hitl"]["state"] == "OPEN"
    assert waiting["assessmentDecision"] is None
    assert waiting["evaluationLabelPredictions"]["compliance"] == "UNRESOLVED"
    assert resumed["hitl"]["state"] == "RESOLVED"
    assert (
        resumed["hitl"]["resolvedRequests"][0]["requestId"]
        == waiting["hitl"]["openRequestIds"][0]
    )
    assert (
        resumed["reviewPayload"]["lifecycleHistory"][0]["traceSha256"]
        == waiting["traceSha256"]
    )
    assert all(
        p["source_kind"] == "OFFICIAL_PINNED_LAW"
        for p in waiting["reviewPayload"]["legalProvisions"]
    )
    assert report["executionCohort"]["outputAvailableCount"] == 2
    assert report["executionCohort"]["executedMissingOutputCount"] == 0
    assert report["scoringStatus"] == "NOT_SCORED"
    assert report["reviewedGoldDenominator"] == 0


@pytest.mark.parametrize(
    "mutation,code",
    [
        ("wrong_rule", "P14_HITL_REQUEST_RULE_BINDING_INVALID"),
        ("wrong_answer", "P14_HITL_ANSWER_FACT_BINDING_INVALID"),
        ("wrong_fact", "P14_HITL_ANSWER_FACT_BINDING_INVALID"),
    ],
)
def test_changed_request_answer_or_fact_is_rejected_after_digest_recomputation(
    official_run, mutation, code
):
    package, run, cases = official_run
    outcomes = [
        TrialOutcome.model_validate_json(line)
        for line in (run / "trials.jsonl").read_text().splitlines()
    ]
    outcome = next(o for o in outcomes if o.stage == "RESUME_FINAL")
    trace = json.loads((run / outcome.trace_path).read_text(encoding="utf-8"))
    payload = trace["observedOutput"]
    if mutation == "wrong_rule":
        payload["hitl"]["requests"][0]["assessmentRuleId"] = "another-rule"
    elif mutation == "wrong_answer":
        payload["hitl"]["resolvedRequests"][0]["answer"] = "unrelated answer"
    else:
        payload["hitl"]["resolvedRequests"][0]["factId"] = "unrelated-fact"
    trace["observedOutputSha256"] = canonical_digest(payload)
    mapping = json.loads((package / "map.json").read_text())
    with pytest.raises(ValueError, match=code):
        _observed_output_from_trace(
            trace,
            outcome=outcome,
            p14_case=cases[0],
            mapping_entry=mapping["caseMappings"][1],
            outcomes_by_case_stage={(o.case_id, o.stage): [o] for o in outcomes},
        )


@pytest.fixture(scope="module")
def frames(tmp_path_factory):
    return build_review_frames(tmp_path_factory.mktemp("frames") / "frames.json")


def test_provision_frames_are_diverse_provisional_and_do_not_generate_quality_labels(
    frames,
):
    assert frames["frameCount"] == 15
    assert frames["counterfactualScenarioCount"] == 30
    assert frames["actualPreparationOutputCount"] == 0
    assert len({row["requiredAction"] for row in frames["frames"]}) == 15
    assert all(
        row["reviewStatus"] == "CANDIDATE" and row["reviewers"] == []
        for row in frames["frames"]
    )
    assert "operational" in frames["businessBoundary"]


@pytest.mark.parametrize(
    "mutation,code",
    [
        ("actor", "SOURCE_REVIEW_ACTOR_FRAME_MISMATCH"),
        ("asof", "SOURCE_REVIEW_ASOF_EFFECTIVITY_MISMATCH"),
        ("effective", "SOURCE_REVIEW_ASOF_EFFECTIVITY_MISMATCH"),
        ("provision", "SOURCE_REVIEW_ORIGINAL_BYTES_MISMATCH"),
    ],
)
def test_actor_temporal_and_original_source_mismatch_fail_even_with_valid_digest(
    frames, mutation, code
):
    changed = deepcopy(frames)
    if mutation == "actor":
        changed["frames"][0]["expectedActor"] = "BÃªn triá»ƒn khai"
    elif mutation == "provision":
        changed["frames"][0]["source"]["content"] = "Modified original"
    else:
        changed["temporalFrame"][
            "asOf" if mutation == "asof" else "lawEffectiveDate"
        ] = "2025-01-01"
    changed["packageSha256"] = canonical_digest(
        {k: v for k, v in changed.items() if k != "packageSha256"}
    )
    with pytest.raises(ValueError, match=code):
        validate_review_frames(changed)


def test_absent_preparation_outputs_are_not_simulated_as_an_actual_baseline():
    report = integrate_preparation_artifacts(
        output_path=None,
        manifest_path=None,
        gold_path=None,
        approved_gold_sha256=None,
        expected_output_sha256=None,
    )
    assert report["scoringStatus"] == "NOT_SCORED"
    assert len(report["blockingReasons"]) == 3
    assert report["verifiedSemanticMetrics"] is False


def test_revised_proposals_do_not_invent_quality_labels_and_default_cli_uses_exact_package(
    tmp_path,
):
    package = PACKAGE_ROOT / "proposals.v2"
    rows = [
        json.loads(line)
        for line in (package / "candidate-cases.vn-ai.v1.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert len(rows) == 30
    for row in rows:
        assert row["reviewStatus"] == "CANDIDATE"
        assert all(
            row["expected"][key] is None
            for key in (
                "actor",
                "conditions",
                "exceptions",
                "evidenceSufficiency",
                "unsupportedConclusion",
            )
        )
        assert "operational evidence" in row["targetObligation"]["conditions"][0]
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    assert (
        eval_cli(
            [
                "run",
                "--cases",
                str(package / "p14-cases.vn-ai.v1.json"),
                "--mode",
                "SCRIPTED",
                "--split",
                "ALL",
                "--trials",
                "1",
                "--k",
                "1",
                "--run-id",
                "revised-proposals",
                "--git-commit-sha",
                commit,
                "--output-dir",
                str(tmp_path),
                "--evaluation-split-manifest",
                str(package / "evaluation-splits.vn-ai.v2.json"),
            ]
        )
        == 0
    )
    run = tmp_path / "revised-proposals"
    output = tmp_path / "report.json"
    assert (
        eval_cli(
            [
                "legal-score",
                "--manifest",
                str(run / "manifest.json"),
                "--trials",
                str(run / "trials.jsonl"),
                "--output",
                str(output),
            ]
        )
        == 0
    )
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["caseMapping"]["mappedCaseCount"] == 30
    assert report["scoringStatus"] == "NOT_SCORED"


def test_preparation_import_reuses_lcsp402_gate_and_rejects_unreviewed_or_changed_inputs(
    tmp_path,
):
    from test_reviewed_eval_gate import inputs

    _gold, gold_bytes, candidate, manifest = inputs()
    pins = json.loads(
        (PACKAGE_ROOT / "source-pins.vn-ai.v1.json").read_text(encoding="utf-8")
    )
    manifest["sourcePins"].update(
        legalCorpusDigestSha256=pins["officialCorpus"]["corpusDigestSha256"],
        legalSourceDocumentSha256=pins["sources"][0]["pdfSha256"],
    )
    manifest["manifestSha256"] = stable_hash(
        {k: v for k, v in manifest.items() if k != "manifestSha256"}
    )
    candidate["promptManifestSha256"] = manifest["manifestSha256"]
    output_bytes = json.dumps(candidate).encode()
    paths = {
        "output": tmp_path / "output.json",
        "manifest": tmp_path / "manifest.json",
        "gold": tmp_path / "gold.json",
    }
    for name, value in [
        ("output", output_bytes),
        ("manifest", json.dumps(manifest).encode()),
        ("gold", gold_bytes),
    ]:
        paths[name].write_bytes(value)
    report = integrate_preparation_artifacts(
        output_path=paths["output"],
        manifest_path=paths["manifest"],
        gold_path=paths["gold"],
        approved_gold_sha256=sha256(gold_bytes).hexdigest(),
        expected_output_sha256=sha256(output_bytes).hexdigest(),
    )
    assert "REVIEWED_EVAL_GOLD_NOT_APPROVED" in report["blockingReasons"]
    assert report["scoringStatus"] == "NOT_SCORED"
    paths["output"].write_bytes(output_bytes + b" ")
    changed = integrate_preparation_artifacts(
        output_path=paths["output"],
        manifest_path=paths["manifest"],
        gold_path=paths["gold"],
        approved_gold_sha256=sha256(gold_bytes).hexdigest(),
        expected_output_sha256=sha256(output_bytes).hexdigest(),
    )
    assert "FROZEN_PREPARATION_OUTPUT_DIGEST_MISMATCH" in changed["blockingReasons"]


def test_preparation_structural_fixture_reaches_shared_scorer_without_authenticating_review(
    tmp_path,
):
    # All runtime/review data below is a local structural fixture, never retained as real evidence.
    from test_reviewed_eval_gate import inputs

    from evals.legal_reasoning.validation import load_dataset

    gold, _, output, manifest = inputs()
    pins = json.loads(
        (PACKAGE_ROOT / "source-pins.vn-ai.v1.json").read_text(encoding="utf-8")
    )
    source = pins["sources"][0]
    from evals.policy_baseline import _load_legal_context

    context, _ = _load_legal_context()
    ref = next(iter(source["provisions"]))
    article_number = ref.removeprefix("article-")
    original = context[f"decree-{article_number}"]
    claim = output["semanticGraph"]["claims"][0]
    claim["sourceNodeIds"] = ["a" * 64]
    source_graph = {
        "legalSourceVersionId": source["sourceVersion"],
        "nodes": [
            {
                "nodeId": "b" * 64,
                "parentNodeId": None,
                "documentId": source["documentNumber"],
                "nodeType": "ARTICLE",
                "label": article_number,
                "content": original.content,
            },
            {
                "nodeId": "a" * 64,
                "parentNodeId": "b" * 64,
                "documentId": source["documentNumber"],
                "nodeType": "CLAUSE",
                "label": "1",
                "content": original.content[:80],
            },
        ],
    }
    source_graph_path = tmp_path / "source-graph.json"
    source_graph_path.write_text(json.dumps(source_graph), encoding="utf-8")
    source_version = source["sourceVersion"]
    gold["goldApprovalStatus"] = "HUMAN_APPROVED"  # simulated contract marker only
    gold["legalSourceVersionId"] = source_version
    output["semanticGraph"]["legalSourceVersionId"] = source_version
    manifest["sourcePins"].update(
        legalSourceVersionId=source_version,
        legalCorpusDigestSha256=pins["officialCorpus"]["corpusDigestSha256"],
        legalSourceDocumentSha256=source["pdfSha256"],
        sourceGraphSha256=sha256(source_graph_path.read_bytes()).hexdigest(),
    )
    manifest["instructionBundle"] = {"enRuntimeBundleDigest": "c" * 64}
    manifest["manifestSha256"] = stable_hash(
        {k: v for k, v in manifest.items() if k != "manifestSha256"}
    )
    output["promptManifestSha256"] = manifest["manifestSha256"]
    row = next(
        r
        for r in load_dataset(PACKAGE_ROOT / "candidate-cases.v1.jsonl")
        if r["evaluationTarget"] == "RULE_SET_PREPARATION_OUTPUT"
    )
    row["legalSource"] = {
        "sourceId": source["sourceId"],
        "sourceVersion": source_version,
        "sourceUrl": source["sourceUrl"],
        "provisionRefs": [ref],
        "citations": [source["provisions"][ref]["citation"]],
    }
    paths = {
        name: tmp_path / (name + ".json")
        for name in ("output", "manifest", "gold", "judgments")
    }
    for name, value in (("output", output), ("manifest", manifest), ("gold", gold)):
        paths[name].write_text(json.dumps(value), encoding="utf-8")
    output_digest = sha256(paths["output"].read_bytes()).hexdigest()
    binding = {
        "bindingKind": "RULE_SET_PREPARATION_OUTPUT",
        "candidateCaseId": row["caseId"],
        "runId": manifest["runId"],
        "manifestSha256": manifest["manifestSha256"],
        "sourceId": source["sourceId"],
        "sourceVersion": source_version,
        "provisionRefs": [ref],
        "claimId": claim["claimId"],
        "claimSha256": stable_hash(claim),
        "outputSha256": output_digest,
        "instructionBundleDigest": "c" * 64,
        "skillVersionDigest": stable_hash({"available": {}, "selected": {}}),
    }
    judgments = {
        "predictionVersion": "LCSP-400-NORMALIZED-PREDICTIONS-V1",
        "evaluationTarget": "RULE_SET_PREPARATION_OUTPUT",
        "casePredictions": [
            {
                "caseId": row["caseId"],
                "stage": "RULE_SET_PREPARATION",
                "evaluationTarget": "RULE_SET_PREPARATION_OUTPUT",
                "observationKind": "GENERATED_LCSP_OUTPUT",
                "targetBinding": binding,
                "humanJudgments": {},
                "dimensionPredictions": {},
            }
        ],
    }
    paths["judgments"].write_text(json.dumps(judgments), encoding="utf-8")
    annotations = tmp_path / "annotations.jsonl"
    annotations.write_text(json.dumps(row) + "\n", encoding="utf-8")
    args = {
        "output_path": paths["output"],
        "manifest_path": paths["manifest"],
        "gold_path": paths["gold"],
        "approved_gold_sha256": sha256(paths["gold"].read_bytes()).hexdigest(),
        "expected_output_sha256": output_digest,
        "annotations_path": annotations,
        "judgments_path": paths["judgments"],
        "rubric_path": PACKAGE_ROOT / "rubric.v1.json",
        "source_graph_path": source_graph_path,
    }
    report = integrate_preparation_artifacts(**args)
    assert report["blockingReasons"] == []
    assert report["rubricReport"]["evaluationTarget"] == "RULE_SET_PREPARATION_OUTPUT"
    assert report["scoringStatus"] == "NOT_SCORED"
    assert report["verifiedSemanticMetrics"] is False
    assert report["reviewAuthenticityStatus"] == "NOT_AUTHENTICATED_BY_TOOL"
    judgments["casePredictions"][0]["targetBinding"]["claimSha256"] = "d" * 64
    paths["judgments"].write_text(json.dumps(judgments), encoding="utf-8")
    with pytest.raises(
        ValueError, match="PREPARATION_P15_OUTPUT_CLAIM_BINDING_MISMATCH"
    ):
        integrate_preparation_artifacts(**args)

    judgments["casePredictions"][0]["targetBinding"]["claimSha256"] = stable_hash(claim)
    source_graph["nodes"][1]["parentNodeId"] = "c" * 64
    source_graph["nodes"].append(
        {
            "nodeId": "c" * 64,
            "parentNodeId": None,
            "documentId": source["documentNumber"],
            "nodeType": "ARTICLE",
            "label": "17",
            "content": context["decree-17"].content,
        }
    )
    source_graph_path.write_text(json.dumps(source_graph), encoding="utf-8")
    manifest["sourcePins"]["sourceGraphSha256"] = sha256(
        source_graph_path.read_bytes()
    ).hexdigest()
    manifest["manifestSha256"] = stable_hash(
        {k: v for k, v in manifest.items() if k != "manifestSha256"}
    )
    output["promptManifestSha256"] = manifest["manifestSha256"]
    paths["manifest"].write_text(json.dumps(manifest), encoding="utf-8")
    paths["output"].write_text(json.dumps(output), encoding="utf-8")
    judgments["casePredictions"][0]["targetBinding"]["manifestSha256"] = manifest[
        "manifestSha256"
    ]
    judgments["casePredictions"][0]["targetBinding"]["outputSha256"] = sha256(
        paths["output"].read_bytes()
    ).hexdigest()
    paths["judgments"].write_text(json.dumps(judgments), encoding="utf-8")
    args["expected_output_sha256"] = sha256(paths["output"].read_bytes()).hexdigest()
    with pytest.raises(ValueError, match="PREPARATION_P15_CLAIM_PROVISION_MISMATCH"):
        integrate_preparation_artifacts(**args)


def test_windows_fixture_pin_is_portable_without_changing_serialized_identity():
    from pathlib import PurePosixPath

    from evals.benchmark_schema import RepoSnapshotPin

    pin = RepoSnapshotPin(
        repo_id="sample", commit_sha="a" * 40, fixture_dir=r"evals\fixtures\sample"
    )
    original = pin.model_dump()
    assert PurePosixPath("/root") / pin.portable_fixture_dir == PurePosixPath(
        "/root/evals/fixtures/sample"
    )
    assert pin.model_dump() == original
    assert pin.model_dump()["fixture_dir"] == r"evals\fixtures\sample"


def test_pinned_source_and_evidence_bytes_survive_git_checkout():
    from evals.policy_baseline import CORPUS, FIXTURES

    repo = PACKAGE_ROOT.parents[2]
    paths = [
        CORPUS / "manifest.json",
        CORPUS / "ingestion-receipt.json",
        FIXTURES / "legal-context.json",
        *sorted(FIXTURES.glob("*/release-evidence.json")),
    ]
    for path in paths:
        relative = path.relative_to(repo).as_posix()
        committed = subprocess.check_output(
            ["git", "show", f"HEAD:{relative}"], cwd=repo
        )
        assert path.read_bytes() == committed, relative
