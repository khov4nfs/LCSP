"""Offline CI & regression tests for LCSP SWE-bench / tau-bench style benchmark.

Covers all 12 mandatory regression tests from PR #622 review, plus real
run_assessment_root() execution in SCRIPTED, HITL two-stage, FAULT_RECOVERY,
and fake-provider LIVE modes with zero paid API calls.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import httpx
import pytest
from langchain_core.messages import AIMessage

from evals.benchmark_runner import (
    _build_scripted_model_for_case,
    build_benchmark_manifest,
    load_benchmark_cases,
    load_manual_reviews,
    run_benchmark,
)
from evals.benchmark_schema import ManualReviewRecord, RunConfig, StageExpectation, TrialOutcome
from evals.cli import main as cli_main
from evals.scorer import (
    compute_case_pass_pow_k,
    grade_trial,
    score_manual_reviews,
    validate_run_artifacts_for_scoring,
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
    assert all(c.repo_pin.snapshot_kind == "SYNTHETIC_FIXTURE" for c in cases)
    assert all(c.repo_pin.untrusted_code_execution_allowed is False for c in cases)


def test_pass_pow_k_exact_combinatorics():
    assert compute_case_pass_pow_k(5, 3, 3) == pytest.approx(0.1)
    assert compute_case_pass_pow_k(5, 4, 3) == pytest.approx(0.4)
    assert compute_case_pass_pow_k(5, 2, 3) == 0.0
    assert compute_case_pass_pow_k(2, 2, 3) is None


def test_regression_missing_verdict_inverted_verdict_and_no_graph_execution():
    exp = StageExpectation(
        stage="INITIAL",
        expected_lifecycle_state="COMPLETE",
        expected_verdict="APPLICABLE_COMPLIANT",
        required_evidence_refs=("ev-1",),
        expected_hitl_state="NONE",
        expected_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
    )
    ev_records = {"ev-1": {"repositoryId": "repo-01-consent-app"}}

    # 1. SCRIPTED without verdict -> FAIL
    no_verdict = grade_trial(
        run_id="r1", case_id="C1", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="UNRESOLVED",
        observed_evidence_refs=("ev-1",), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False, observed_evidence_records=ev_records,
        expected_repo_id="repo-01-consent-app", graph_executed=True,
    )
    assert no_verdict.passed is False

    # 2. Inverted verdict vs gold -> FAIL
    inverted = grade_trial(
        run_id="r1", case_id="C1", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_NON_COMPLIANT",
        observed_evidence_refs=("ev-1",), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False, observed_evidence_records=ev_records,
        expected_repo_id="repo-01-consent-app", graph_executed=True,
    )
    assert inverted.passed is False

    # 5. Graph not executed -> cannot PASS SCRIPTED execution
    no_graph = grade_trial(
        run_id="r1", case_id="C1", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=("ev-1",), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False, observed_evidence_records=ev_records,
        expected_repo_id="repo-01-consent-app", graph_executed=False,
    )
    assert no_graph.passed is False


def test_regression_evidence_missing_or_wrong_snapshot_fails():
    exp = StageExpectation(
        stage="INITIAL",
        expected_lifecycle_state="COMPLETE",
        expected_verdict="APPLICABLE_COMPLIANT",
        required_evidence_refs=("ev-1",),
        expected_hitl_state="NONE",
        expected_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
    )

    # 3. Non-existent evidence ID -> FAIL
    missing_ev = grade_trial(
        run_id="r1", case_id="C1", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=("ev-1",), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False, observed_evidence_records={},
        expected_repo_id="repo-01-consent-app", graph_executed=True,
    )
    assert missing_ev.passed is False and missing_ev.evidence_match is False

    # 4. Matching evidence ID but wrong repository snapshot -> FAIL
    wrong_snap = grade_trial(
        run_id="r1", case_id="C1", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=("ev-1",), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False,
        observed_evidence_records={"ev-1": {"repositoryId": "foreign-repo-999"}},
        expected_repo_id="repo-01-consent-app", graph_executed=True,
    )
    assert wrong_snap.passed is False and wrong_snap.evidence_match is False


def test_regression_fault_not_injected_cannot_pass_recovery():
    exp = StageExpectation(
        stage="FAULT_RECOVERY",
        expected_lifecycle_state="COMPLETE",
        expected_verdict="APPLICABLE_COMPLIANT",
        required_evidence_refs=("ev-1",),
        expected_hitl_state="NONE",
        expected_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
    )
    # 7. Fault not actually injected -> cannot count as recovery PASS
    no_fault = grade_trial(
        run_id="r1", case_id="C20", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=True,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=("ev-1",), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False,
        observed_evidence_records={"ev-1": {"repositoryId": "repo-08-breach-sla"}},
        expected_repo_id="repo-08-breach-sla", graph_executed=True,
        injected_fault_observed=False, recovery_observed=False,
    )
    assert no_fault.passed is False


def test_regression_fixture_content_change_changes_manifest_hash(tmp_path):
    # 8. Modifying a source file inside a fixture repo changes manifestSha256
    cases = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01"])
    config = RunConfig(mode="OFFLINE_FIXTURE", split="DEV", trials_per_case=1, k_values=(1,))
    m_before = build_benchmark_manifest(run_id="m-test", cases=cases, config=config)

    # Copy fixture repo to tmp_path, mutate file, and verify hash changes
    repo_copy = tmp_path / "repo-01"
    repo_copy.mkdir()
    src = Path(__file__).resolve().parent.parent / cases[0].repo_pin.fixture_dir / "src" / "consent.py"
    (repo_copy / "consent.py").write_text(src.read_text(encoding="utf-8") + "\n# mutated\n", encoding="utf-8")
    mutated_case = cases[0].model_copy(
        update={"repo_pin": cases[0].repo_pin.model_copy(update={"fixture_dir": str(repo_copy)})}
    )
    m_after = build_benchmark_manifest(run_id="m-test", cases=[mutated_case], config=config)
    assert m_before["manifestSha256"] != m_after["manifestSha256"]


def test_regression_mixed_runs_rejected_and_overwrite_forbidden(tmp_path):
    cases = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01"])
    config = RunConfig(mode="OFFLINE_FIXTURE", split="DEV", trials_per_case=1, k_values=(1,))
    run_benchmark(cases=cases, config=config, output_dir=tmp_path, run_id="immutable-run")

    # 12. Re-running same run_id does NOT overwrite existing evidence
    with pytest.raises(FileExistsError, match="RUN_ID_ALREADY_EXISTS"):
        run_benchmark(cases=cases, config=config, output_dir=tmp_path, run_id="immutable-run")

    # 9. Mixing trials from different runs is rejected by scorer
    manifest = json.loads((tmp_path / "immutable-run" / "manifest.json").read_text(encoding="utf-8"))
    trial_line = (tmp_path / "immutable-run" / "trials.jsonl").read_text(encoding="utf-8").splitlines()[0]
    t1 = TrialOutcome.model_validate_json(trial_line)
    t_foreign = t1.model_copy(update={"run_id": "other-run", "trial_index": 1})
    with pytest.raises(ValueError, match="SCORING_CROSS_RUN_TRIAL_REJECTED"):
        validate_run_artifacts_for_scoring(manifest, [t1, t_foreign])


def test_regression_live_preflight_and_fake_provider_execution(tmp_path, monkeypatch):
    def deny_network(_client, request, **_kwargs):
        raise AssertionError(f"Preflight/fake-provider test must never dispatch HTTP: {request.url}")

    monkeypatch.setattr(httpx.Client, "send", deny_network)
    cases = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01"])

    # 11. LIVE without allow_live or unconfigured provider fails at preflight
    with pytest.raises(PermissionError, match="LIVE_MODE_REQUIRES_EXPLICIT_ALLOW_LIVE"):
        run_benchmark(
            cases=cases,
            config=RunConfig(mode="LIVE", split="DEV", trials_per_case=1, k_values=(1,), allow_live=False),
            output_dir=tmp_path,
        )
    with pytest.raises(RuntimeError, match="LIVE_PREFLIGHT_MISSING_PROVIDER_CONFIG"):
        run_benchmark(
            cases=cases,
            config=RunConfig(
                mode="LIVE", split="DEV", trials_per_case=1, k_values=(1,),
                allow_live=True, model_route="nonexistent-route-for-preflight",
            ),
            output_dir=tmp_path,
        )
    assert not (tmp_path / "nonexistent-route-for-preflight").exists()

    # Fake-provider LIVE adapter executes real run_assessment_root() with physical_attempts > 0
    report = run_benchmark(
        cases=cases,
        config=RunConfig(mode="LIVE", split="DEV", trials_per_case=1, k_values=(1,), allow_live=True, model_route="fake-live"),
        output_dir=tmp_path,
        run_id="live-fake-1",
        live_model_factory=lambda case, _cfg: _build_scripted_model_for_case(case, "src/consent.py"),
    )
    assert report["semanticReliability"]["overall"]["usage"]["physicalAttempts"] > 0
    assert report["semanticReliability"]["overall"]["passedTrials"] == 1


def test_regression_real_scripted_assessment_root_hitl_and_fault_recovery(tmp_path, monkeypatch):
    def deny_network(_client, request, **_kwargs):
        raise AssertionError(f"Offline SCRIPTED CI must never dispatch HTTP: {request.url}")

    monkeypatch.setattr(httpx.Client, "send", deny_network)

    # Real run_assessment_root() on: normal compliant (CASE-01), two-stage HITL (CASE-15), and fault recovery (CASE-20)
    cases = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01", "CASE-15", "CASE-20"])
    report = run_benchmark(
        cases=cases,
        config=RunConfig(mode="SCRIPTED", split="DEV", trials_per_case=1, k_values=(1,)),
        output_dir=tmp_path,
        run_id="scripted-real-root",
    )
    # 10. Offline/SCRIPTED reports 0 physical provider attempts
    assert report["semanticReliability"]["overall"]["usage"]["physicalAttempts"] == 0
    assert report["semanticReliability"]["overall"]["usage"]["scriptedInvocations"] > 0
    assert report["semanticReliability"]["overall"]["passedTrials"] == 3  # CASE-01 (1) + CASE-15 (2 stages)
    assert report["faultInjectionRecovery"]["passedTrials"] == 1  # CASE-20 real 503 fault + recovery

    # Verify CASE-15 shared thread_id and checkpoint across WAITING_FOR_HUMAN -> RESUME_FINAL
    trials = [
        TrialOutcome.model_validate_json(line)
        for line in (tmp_path / "scripted-real-root" / "trials.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    hitl_trials = [t for t in trials if t.case_id == "CASE-15"]
    assert len(hitl_trials) == 2
    assert hitl_trials[0].thread_id == hitl_trials[1].thread_id
    assert hitl_trials[0].checkpoint_id is not None
    assert hitl_trials[0].graph_executed and hitl_trials[1].graph_executed

    # 6. Mismatched checkpoint / stopping at WAITING_FOR_HUMAN fails RESUME_FINAL
    resume_exp = cases[1].gold_rubric.stages[1]
    bad_resume = grade_trial(
        run_id="r1", case_id="CASE-15", trial_index=0, thread_id=hitl_trials[0].thread_id,
        mode="SCRIPTED", split="DEV", expectation=resume_exp,
        is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="WAITING_FOR_HUMAN", observed_verdict="WAITING_FOR_HUMAN",
        observed_evidence_refs=("ev-case-15-1",), observed_hitl_state="OPEN",
        observed_persisted_state={"lifecycleState": "WAITING_FOR_HUMAN", "openHumanRequests": 1},
        authority_violation=False,
        observed_evidence_records={"ev-case-15-1": {"repositoryId": cases[1].repo_pin.repo_id}},
        expected_repo_id=cases[1].repo_pin.repo_id, graph_executed=True,
    )
    assert bad_resume.passed is False


def test_regression_offline_fixture_zero_physical_attempts_and_p15_binding(tmp_path):
    cases = load_benchmark_cases(CASES_PATH)
    reviews = load_manual_reviews(REVIEWS_PATH)
    # Cross-run P15 review is rejected
    with pytest.raises(ValueError, match="MANUAL_REVIEW_RUN_MISMATCH"):
        score_manual_reviews(reviews, expected_run_id="different-run")

    rc = cli_main([
        "run",
        "--cases", str(CASES_PATH),
        "--run-id", "offline-ci-check",
        "--mode", "OFFLINE_FIXTURE",
        "--trials", "5",
        "--k", "1", "3", "5",
        "--output-dir", str(tmp_path),
    ])
    assert rc == 0
    report = json.loads((tmp_path / "offline-ci-check" / "report.json").read_text(encoding="utf-8"))
    assert report["semanticReliability"]["overall"]["usage"]["physicalAttempts"] == 0
    assert report["faultInjectionRecovery"]["usage"]["physicalAttempts"] == 0
    assert report["semanticReliability"]["overall"]["passPowK"]["pass^5"]["score"] == 1.0
