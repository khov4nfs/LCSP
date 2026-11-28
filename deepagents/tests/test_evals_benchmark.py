"""Offline CI tests for LCSP SWE-bench / tau-bench style benchmark infrastructure.

Verifies manifest reproducibility, exact pass^k combinatorics, stage-aware
WAITING_FOR_HUMAN grading, authority-violation rejection, trial isolation,
fault-injection separation, P15 deterministic review metrics, and CLI execution
with zero paid model calls or network dispatch.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import httpx
import pytest

from evals.benchmark_runner import (
    build_benchmark_manifest,
    load_benchmark_cases,
    load_manual_reviews,
    run_benchmark,
)
from evals.benchmark_schema import ManualReviewRecord, RunConfig, StageExpectation
from evals.cli import main as cli_main
from evals.scorer import (
    build_benchmark_report,
    compute_case_pass_pow_k,
    compute_pass_pow_k_summary,
    grade_trial,
    score_manual_reviews,
)


CASES_PATH = Path(__file__).resolve().parent.parent / "evals" / "fixtures" / "benchmark" / "cases.json"
REVIEWS_PATH = Path(__file__).resolve().parent.parent / "evals" / "fixtures" / "benchmark" / "manual_reviews_p15.json"


def test_seeded_benchmark_inventory_meets_scope_and_safety():
    cases = load_benchmark_cases(CASES_PATH)
    assert 30 <= len(cases) <= 50
    repos = {c.repo_pin.repo_id for c in cases}
    assert 6 <= len(repos) <= 10
    assert any(c.split == "DEV" for c in cases)
    assert any(c.split == "HOLDOUT" for c in cases)
    assert any(c.is_negative_control for c in cases)
    assert any(c.is_fault_injection for c in cases)
    assert all(c.reviewer and c.reviewed_at for c in cases)
    assert all(c.repo_pin.untrusted_code_execution_allowed is False for c in cases)


def test_pass_pow_k_exact_combinatorics():
    # C(3, 3) / C(5, 3) = 1 / 10 = 0.1 (never (3/5)^3 = 0.216)
    assert compute_case_pass_pow_k(5, 3, 3) == pytest.approx(0.1)
    # C(4, 3) / C(5, 3) = 4 / 10 = 0.4
    assert compute_case_pass_pow_k(5, 3 + 1, 3) == pytest.approx(0.4)
    # c < k yields 0.0 when n >= k
    assert compute_case_pass_pow_k(5, 2, 3) == 0.0
    # n < k is excluded (None)
    assert compute_case_pass_pow_k(2, 2, 3) is None


def test_waiting_for_human_and_authority_violation_grading():
    waiting_exp = StageExpectation(
        stage="WAITING_FOR_HUMAN",
        expected_lifecycle_state="WAITING_FOR_HUMAN",
        expected_verdict="WAITING_FOR_HUMAN",
        required_evidence_refs=("ev-1",),
        expected_hitl_state="OPEN",
        expected_persisted_state={"lifecycleState": "WAITING_FOR_HUMAN", "openHumanRequests": 1},
    )
    resume_exp = StageExpectation(
        stage="RESUME_FINAL",
        expected_lifecycle_state="COMPLETE",
        expected_verdict="APPLICABLE_COMPLIANT",
        required_evidence_refs=("ev-1", "fact-1"),
        expected_hitl_state="RESOLVED",
        expected_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
    )

    # Stopping at WAITING_FOR_HUMAN passes the waiting stage only
    waiting_pass = grade_trial(
        run_id="r1", case_id="C1", trial_index=0, thread_id="t1", mode="OFFLINE_FIXTURE", split="DEV",
        expectation=waiting_exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="WAITING_FOR_HUMAN", observed_verdict="WAITING_FOR_HUMAN",
        observed_evidence_refs=("ev-1",), observed_hitl_state="OPEN",
        observed_persisted_state={"lifecycleState": "WAITING_FOR_HUMAN", "openHumanRequests": 1},
        authority_violation=False,
    )
    assert waiting_pass.passed is True

    # Stopping at WAITING_FOR_HUMAN MUST fail RESUME_FINAL
    waiting_on_resume = grade_trial(
        run_id="r1", case_id="C1", trial_index=0, thread_id="t1", mode="OFFLINE_FIXTURE", split="DEV",
        expectation=resume_exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="WAITING_FOR_HUMAN", observed_verdict="WAITING_FOR_HUMAN",
        observed_evidence_refs=("ev-1",), observed_hitl_state="OPEN",
        observed_persisted_state={"lifecycleState": "WAITING_FOR_HUMAN", "openHumanRequests": 1},
        authority_violation=False,
    )
    assert waiting_on_resume.passed is False

    # Authority violation fails even when all other fields match
    auth_fail = grade_trial(
        run_id="r1", case_id="C1", trial_index=0, thread_id="t1", mode="OFFLINE_FIXTURE", split="DEV",
        expectation=resume_exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=("ev-1", "fact-1"), observed_hitl_state="RESOLVED",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=True,
    )
    assert auth_fail.passed is False


def test_manifest_reproducibility_and_live_guard(tmp_path):
    cases = load_benchmark_cases(CASES_PATH, split="DEV")
    config = RunConfig(mode="OFFLINE_FIXTURE", split="DEV", trials_per_case=3, k_values=(1, 3))
    m1 = build_benchmark_manifest(run_id="repro-1", cases=cases, config=config)
    m2 = build_benchmark_manifest(run_id="repro-1", cases=cases, config=config)
    assert m1["manifestSha256"] == m2["manifestSha256"]

    live_config = RunConfig(mode="LIVE", split="DEV", trials_per_case=1, k_values=(1,), allow_live=False)
    with pytest.raises(PermissionError, match="LIVE_MODE_REQUIRES_EXPLICIT_ALLOW_LIVE"):
        run_benchmark(cases=cases, config=live_config, output_dir=tmp_path)


def test_offline_and_scripted_cli_isolation_and_outputs(tmp_path, monkeypatch):
    def deny_network(_client, request, **_kwargs):
        raise AssertionError(f"Offline CI must never dispatch HTTP: {request.url}")

    monkeypatch.setattr(httpx.Client, "send", deny_network)

    # 1. Offline fixture run with 5 trials so pass^1, pass^3, and pass^5 are all computed
    out_offline = tmp_path / "offline"
    rc = cli_main([
        "run",
        "--cases", str(CASES_PATH),
        "--reviews", str(REVIEWS_PATH),
        "--run-id", "ci-offline-5",
        "--mode", "OFFLINE_FIXTURE",
        "--trials", "5",
        "--k", "1", "3", "5",
        "--output-dir", str(out_offline),
    ])
    assert rc == 0

    run_dir = out_offline / "ci-offline-5"
    assert (run_dir / "manifest.json").is_file()
    assert (run_dir / "trials.jsonl").is_file()
    assert (run_dir / "report.json").is_file()
    assert (run_dir / "report.csv").is_file()

    report = json.loads((run_dir / "report.json").read_text(encoding="utf-8"))
    sem_k = report["semanticReliability"]["overall"]["passPowK"]
    fault_k = report["faultInjectionRecovery"]["passPowK"]
    assert sem_k["pass^1"]["score"] == 1.0
    assert sem_k["pass^3"]["score"] == 1.0
    assert sem_k["pass^5"]["score"] == 1.0
    assert fault_k["pass^1"]["eligibleUnits"] == 4
    assert report["manualSemanticReviewP15"]["totalReviewed"] == 15
    assert report["manualSemanticReviewP15"]["overallSemanticPassRate"] == 1.0

    # Verify independent thread_id per trial
    trial_lines = [json.loads(line) for line in (run_dir / "trials.jsonl").read_text(encoding="utf-8").splitlines()]
    thread_ids = {(t["case_id"], t["trial_index"]): t["thread_id"] for t in trial_lines}
    assert len(set(thread_ids.values())) == len(thread_ids)

    # Verify CSV contains expected columns
    with (run_dir / "report.csv").open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) > 0
    assert {"case_id", "stage", "pass_pow_1", "pass_pow_3", "pass_pow_5", "is_fault_injection"}.issubset(rows[0].keys())

    # 2. Scripted mode smoke run on a subset (DEV, 2 trials)
    out_scripted = tmp_path / "scripted"
    rc_scripted = cli_main([
        "run",
        "--cases", str(CASES_PATH),
        "--run-id", "ci-scripted-2",
        "--mode", "SCRIPTED",
        "--split", "DEV",
        "--trials", "2",
        "--k", "1",
        "--output-dir", str(out_scripted),
    ])
    assert rc_scripted == 0
    assert (out_scripted / "ci-scripted-2" / "report.json").is_file()
