"""Offline CI & regression tests for LCSP SWE-bench / tau-bench style benchmark.

Covers all 12 mandatory regression tests from PR #622 review plus re-review
findings: no LIVE->SCRIPTED fallback, per-case legal corpus/rules, authority &
completion gates, typed evidence provenance, complete trial inventory, trace
digest checks, fail-closed P15 review binding, HITL matching, and CLI --model-route.
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from evals.benchmark_runner import (
    _BenchmarkRuntimeClient,
    _build_scripted_model_for_case,
    _resolve_model_for_trial,
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
    # Per-case legal provisions and rule definitions are distinct and populated
    provs = {c.legal_provisions[0].content for c in cases}
    assert len(provs) == len(cases)


def test_pass_pow_k_exact_combinatorics():
    assert compute_case_pass_pow_k(5, 3, 3) == pytest.approx(0.1)
    assert compute_case_pass_pow_k(5, 4, 3) == pytest.approx(0.4)
    assert compute_case_pass_pow_k(5, 2, 3) == 0.0
    assert compute_case_pass_pow_k(2, 2, 3) is None


def test_regression_missing_verdict_inverted_verdict_and_no_graph_execution():
    cases = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01"])
    case = cases[0]
    exp = case.gold_rubric.stages[0]
    ev_records = exp_records = case.offline_fixture_output["stages"]["INITIAL"]["evidenceRecords"]
    ev_id = list(exp_records.keys())[0]

    # 1. SCRIPTED without verdict -> FAIL
    no_verdict = grade_trial(
        run_id="r1", case_id="CASE-01", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="UNRESOLVED",
        observed_evidence_refs=(ev_id,), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False, observed_evidence_records=ev_records,
        expected_repo_id=case.repo_pin.repo_id, expected_commit_sha=case.repo_pin.commit_sha,
        graph_executed=True,
    )
    assert no_verdict.passed is False

    # 2. Inverted verdict vs gold -> FAIL
    inverted = grade_trial(
        run_id="r1", case_id="CASE-01", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_NON_COMPLIANT",
        observed_evidence_refs=(ev_id,), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False, observed_evidence_records=ev_records,
        expected_repo_id=case.repo_pin.repo_id, expected_commit_sha=case.repo_pin.commit_sha,
        graph_executed=True,
    )
    assert inverted.passed is False

    # 5. Graph not executed -> cannot PASS SCRIPTED execution
    no_graph = grade_trial(
        run_id="r1", case_id="CASE-01", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=(ev_id,), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False, observed_evidence_records=ev_records,
        expected_repo_id=case.repo_pin.repo_id, expected_commit_sha=case.repo_pin.commit_sha,
        graph_executed=False,
    )
    assert no_graph.passed is False


def test_regression_typed_evidence_rejects_partial_or_wrong_snapshot():
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

    # Partial record with only repositoryId (no path/span/contentSha256) -> FAIL
    partial_ev = grade_trial(
        run_id="r1", case_id="C1", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=("ev-1",), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False,
        observed_evidence_records={"ev-1": {"evidenceType": "REPOSITORY_SOURCE", "repositoryId": "repo-01-consent-app"}},
        expected_repo_id="repo-01-consent-app", graph_executed=True,
    )
    assert partial_ev.passed is False and partial_ev.evidence_match is False


def test_regression_authority_and_completion_gates_enforced():
    from assessment_root.client import AssessmentApiError

    case = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01"])[0]
    client = _BenchmarkRuntimeClient(case, "thread-1", "assess-1")

    # Legal source text & search serve real per-case data
    prov = case.legal_provisions[0]
    assert client.legal_source_text(prov.document_id, prov.locator)["content"] == prov.content
    assert len(client.legal_source_search(case.case_id)["matches"]) == 1

    # Completion gate blocks finalization while rule is undecided
    blocked = client.request_finalization()
    assert blocked["lifecycleState"] == "ACTIVE"
    assert any(b.startswith("UNDECIDED_RULE:") for b in blocked["blockers"])
    assert client.completion_gate_tested is True

    # Authority gate rejects out-of-scope rule decision
    with pytest.raises(AssessmentApiError, match="ASSESSMENT_RULE_OUT_OF_SCOPE"):
        client.post_decision({"decision": {"assessmentRuleId": "UNPINNED-RULE-999", "references": [{"id": "x"}]}})
    assert client.authority_gate_tested is True
    assert client.authority_violations


def test_regression_live_never_falls_back_to_scripted(monkeypatch):
    case = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01"])[0]
    cfg = RunConfig(mode="LIVE", split="DEV", trials_per_case=1, k_values=(1,), allow_live=True, model_route="default")

    sentinel = object()
    monkeypatch.setattr("model_policy.resolve_agent_model", lambda route: sentinel)
    model, is_simulated = _resolve_model_for_trial(
        case=case, config=cfg, first_file="src/consent.py", is_resume=False, live_model_factory=None
    )
    assert model is sentinel
    assert is_simulated is False


def test_regression_incomplete_inventory_and_trace_tampering_rejected(tmp_path):
    cases = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01", "CASE-02"])
    config = RunConfig(mode="OFFLINE_FIXTURE", split="DEV", trials_per_case=2, k_values=(1,))
    run_benchmark(cases=cases, config=config, output_dir=tmp_path, run_id="inv-run")

    # 12. Overwrite forbidden
    with pytest.raises(FileExistsError, match="RUN_ID_ALREADY_EXISTS"):
        run_benchmark(cases=cases, config=config, output_dir=tmp_path, run_id="inv-run")

    manifest = json.loads((tmp_path / "inv-run" / "manifest.json").read_text(encoding="utf-8"))
    lines = (tmp_path / "inv-run" / "trials.jsonl").read_text(encoding="utf-8").splitlines()
    outcomes = [TrialOutcome.model_validate_json(l) for l in lines]

    # Deleting a trial -> SCORING_INCOMPLETE_TRIAL_INVENTORY
    with pytest.raises(ValueError, match="SCORING_INCOMPLETE_TRIAL_INVENTORY"):
        validate_run_artifacts_for_scoring(manifest, outcomes[:-1], base_dir=tmp_path / "inv-run")

    # Mode mismatch (all trials swapped OFFLINE_FIXTURE -> SCRIPTED) -> SCORING_MODE_MISMATCH
    swapped = [o.model_copy(update={"mode": "SCRIPTED"}) for o in outcomes]
    with pytest.raises(ValueError, match="SCORING_MODE_MISMATCH"):
        validate_run_artifacts_for_scoring(manifest, swapped, base_dir=tmp_path / "inv-run")

    # Missing trace hash -> SCORING_TRACE_METADATA_MISSING
    no_hash = outcomes[0].model_copy(update={"trace_sha256": None})
    with pytest.raises(ValueError, match="SCORING_TRACE_METADATA_MISSING"):
        validate_run_artifacts_for_scoring(manifest, [no_hash, *outcomes[1:]], base_dir=tmp_path / "inv-run")

    # Swapping trace_path and trace_sha256 between two trials with identical outcomes -> SCORING_TRACE_IDENTITY_MISMATCH
    swapped_trace = outcomes[0].model_copy(update={
        "trace_path": outcomes[1].trace_path,
        "trace_sha256": outcomes[1].trace_sha256,
    })
    with pytest.raises(ValueError, match="SCORING_TRACE_IDENTITY_MISMATCH"):
        validate_run_artifacts_for_scoring(manifest, [swapped_trace, *outcomes[1:]], base_dir=tmp_path / "inv-run")

    # Tampering with passed=false/actual_verdict in trials.jsonl without changing trace -> SCORING_OUTCOME_TRACE_MISMATCH
    tampered_outcome = outcomes[0].model_copy(update={"passed": not outcomes[0].passed})
    with pytest.raises(ValueError, match="SCORING_OUTCOME_TRACE_MISMATCH"):
        validate_run_artifacts_for_scoring(manifest, [tampered_outcome, *outcomes[1:]], base_dir=tmp_path / "inv-run")

    # Tampering with an on-disk trace file -> SCORING_TRACE_DIGEST_MISMATCH
    trace_file = tmp_path / "inv-run" / outcomes[0].trace_path
    trace_file.write_text('{"tampered": true}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="SCORING_TRACE_DIGEST_MISMATCH"):
        validate_run_artifacts_for_scoring(manifest, outcomes, base_dir=tmp_path / "inv-run")

    # Deleting trace file -> SCORING_TRACE_FILE_MISSING
    trace_file.unlink()
    with pytest.raises(ValueError, match="SCORING_TRACE_FILE_MISSING"):
        validate_run_artifacts_for_scoring(manifest, outcomes, base_dir=tmp_path / "inv-run")

    # 9. Cross-run trial rejected
    foreign = outcomes[0].model_copy(update={"run_id": "other-run"})
    with pytest.raises(ValueError, match="SCORING_CROSS_RUN_TRIAL_REJECTED"):
        validate_run_artifacts_for_scoring(manifest, [foreign, *outcomes[1:]], base_dir=tmp_path / "inv-run")


def test_regression_fixture_content_change_changes_manifest_hash(tmp_path):
    cases = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01"])
    config = RunConfig(mode="OFFLINE_FIXTURE", split="DEV", trials_per_case=1, k_values=(1,))
    m_before = build_benchmark_manifest(run_id="m-test", cases=cases, config=config)

    repo_copy = tmp_path / "repo-01"
    repo_copy.mkdir()
    src = Path(__file__).resolve().parent.parent / cases[0].repo_pin.fixture_dir / "src" / "consent.py"
    (repo_copy / "consent.py").write_text(src.read_text(encoding="utf-8") + "\n# mutated\n", encoding="utf-8")
    mutated_case = cases[0].model_copy(
        update={"repo_pin": cases[0].repo_pin.model_copy(update={"fixture_dir": str(repo_copy)})}
    )
    m_after = build_benchmark_manifest(run_id="m-test", cases=[mutated_case], config=config)
    assert m_before["manifestSha256"] != m_after["manifestSha256"]


def test_regression_live_preflight_and_simulated_provider_execution(tmp_path, monkeypatch):
    def deny_network(_client, request, **_kwargs):
        raise AssertionError(f"Preflight/simulated test must never dispatch HTTP: {request.url}")

    monkeypatch.setattr(httpx.Client, "send", deny_network)
    cases = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01"])

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

    # Simulated provider via live_model_factory increments simulatedProviderCalls, NOT physicalAttempts
    report = run_benchmark(
        cases=cases,
        config=RunConfig(mode="LIVE", split="DEV", trials_per_case=1, k_values=(1,), allow_live=True, model_route="fake-live"),
        output_dir=tmp_path,
        run_id="live-sim-1",
        live_model_factory=lambda case, _cfg: _build_scripted_model_for_case(case, "src/consent.py"),
    )
    usage = report["semanticReliability"]["overall"]["usage"]
    assert usage["simulatedProviderCalls"] > 0
    assert usage["physicalAttempts"] == 0
    assert report["semanticReliability"]["overall"]["passedTrials"] == 1


def test_regression_real_scripted_assessment_root_hitl_and_fault_recovery(tmp_path, monkeypatch):
    def deny_network(_client, request, **_kwargs):
        raise AssertionError(f"Offline SCRIPTED CI must never dispatch HTTP: {request.url}")

    monkeypatch.setattr(httpx.Client, "send", deny_network)

    cases = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01", "CASE-15", "CASE-20"])
    report = run_benchmark(
        cases=cases,
        config=RunConfig(mode="SCRIPTED", split="DEV", trials_per_case=1, k_values=(1,)),
        output_dir=tmp_path,
        run_id="scripted-real-root",
    )
    assert report["semanticReliability"]["overall"]["usage"]["physicalAttempts"] == 0
    assert report["semanticReliability"]["overall"]["usage"]["scriptedInvocations"] > 0
    assert report["semanticReliability"]["overall"]["passedTrials"] == 3
    assert report["faultInjectionRecovery"]["passedTrials"] == 1
    assert report["invariantCoverage"]["completionGateUndecidedRule"] == "NOT_TESTED"
    assert report["invariantCoverage"]["outOfScopeRuleRejection"] == "NOT_TESTED"

    # Unmatched HITL question fails with HITL_FIXTURE_ANSWER_MISMATCH (never fabricates answer)
    from evals.benchmark_runner import _match_hitl_answer
    bad_hitl_case = cases[1].model_copy(update={
        "hitl_answers": (cases[1].hitl_answers[0].model_copy(update={"request_key": "unrelated_key", "question_pattern": "^nomatch$"}),)
    })
    assert _match_hitl_answer(bad_hitl_case, {"unresolvedFact": "notification_owner", "question": "Who owns notification?"}) is None
    monkeypatch.setattr("evals.benchmark_runner._match_hitl_answer", lambda _c, _r: None)
    mismatch_report = run_benchmark(
        cases=[cases[1]],
        config=RunConfig(mode="SCRIPTED", split="DEV", trials_per_case=1, k_values=(1,)),
        output_dir=tmp_path,
        run_id="hitl-mismatch",
    )
    assert mismatch_report["semanticReliability"]["overall"]["failuresByCode"].get("HITL_FIXTURE_ANSWER_MISMATCH") == 1


def test_regression_p15_fail_closed_and_cli_model_route(tmp_path):
    reviews = load_manual_reviews(REVIEWS_PATH)
    # Missing trial in trial_metadata_by_key fails closed
    with pytest.raises(ValueError, match="MANUAL_REVIEW_TRIAL_NOT_FOUND"):
        score_manual_reviews(reviews, expected_run_id="pilot-v1", trial_metadata_by_key={})

    # CLI accepts --model-route
    rc = cli_main([
        "manifest",
        "--cases", str(CASES_PATH),
        "--run-id", "cli-route-test",
        "--model-route", "offline-scripted",
        "--output", str(tmp_path / "manifest.json"),
    ])
    assert rc == 0
    assert json.loads((tmp_path / "manifest.json").read_text())["model"]["configuredModelId"] == "offline-scripted"


def test_regression_gold_evidence_content_criterion_and_hitl_resolves_fact_false(tmp_path):
    from hashlib import sha256
    from evals.benchmark_schema import HitlFixtureAnswer

    # 1. Citing only line 1 (docstring) with the EXACT expected ID ev-case-01-1 and valid provenance fails GoldEvidenceCriterion
    case = load_benchmark_cases(CASES_PATH, case_ids=["CASE-01"])[0]
    exp = case.gold_rubric.stages[0]
    repo_root = Path(__file__).resolve().parent.parent / case.repo_pin.fixture_dir
    lines = (repo_root / "src/consent.py").read_text(encoding="utf-8").splitlines()
    line1 = lines[0]
    impl_excerpt = "\n".join(lines[3:8])
    docstring_only = grade_trial(
        run_id="r1", case_id="CASE-01", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=("ev-case-01-1",), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False,
        observed_evidence_records={"ev-case-01-1": {
            "evidenceType": "REPOSITORY_SOURCE", "repositoryId": case.repo_pin.repo_id,
            "commitSha": case.repo_pin.commit_sha, "path": "src/consent.py",
            "start_line": 1, "end_line": 1, "contentSha256": sha256(line1.encode()).hexdigest(),
        }},
        expected_repo_id=case.repo_pin.repo_id, expected_commit_sha=case.repo_pin.commit_sha,
        repo_fixture_root=repo_root, graph_executed=True,
    )
    assert docstring_only.passed is False and docstring_only.evidence_match is False

    # 1b. Order-independent evidence ID (ev-case-01-99) PASSES when GoldEvidenceCriterion is met
    reordered_id = grade_trial(
        run_id="r1", case_id="CASE-01", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=("ev-case-01-99",), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False,
        observed_evidence_records={"ev-case-01-99": {
            "evidenceType": "REPOSITORY_SOURCE", "repositoryId": case.repo_pin.repo_id,
            "commitSha": case.repo_pin.commit_sha, "path": "src/consent.py",
            "start_line": 4, "end_line": 8, "contentSha256": sha256(impl_excerpt.encode()).hexdigest(),
        }},
        decision_referenced_ids=("ev-case-01-99",),
        expected_repo_id=case.repo_pin.repo_id, expected_commit_sha=case.repo_pin.commit_sha,
        repo_fixture_root=repo_root, graph_executed=True,
    )
    assert reordered_id.passed is True and reordered_id.evidence_match is True

    # 1c. Decision citing insufficient ev-b while ev-a sits unused -> FAIL (no false positive)
    unused_good_ev = grade_trial(
        run_id="r1", case_id="CASE-01", trial_index=0, thread_id="t1", mode="SCRIPTED", split="DEV",
        expectation=exp, is_negative_control=False, is_fault_injection=False,
        observed_lifecycle_state="COMPLETE", observed_verdict="APPLICABLE_COMPLIANT",
        observed_evidence_refs=("ev-a", "ev-b"), observed_hitl_state="NONE",
        observed_persisted_state={"lifecycleState": "COMPLETE", "openHumanRequests": 0},
        authority_violation=False,
        observed_evidence_records={
            "ev-a": {
                "evidenceType": "REPOSITORY_SOURCE", "repositoryId": case.repo_pin.repo_id,
                "commitSha": case.repo_pin.commit_sha, "path": "src/consent.py",
                "start_line": 4, "end_line": 8, "contentSha256": sha256(impl_excerpt.encode()).hexdigest(),
            },
            "ev-b": {
                "evidenceType": "REPOSITORY_SOURCE", "repositoryId": case.repo_pin.repo_id,
                "commitSha": case.repo_pin.commit_sha, "path": "src/consent.py",
                "start_line": 1, "end_line": 1, "contentSha256": sha256(line1.encode()).hexdigest(),
            },
        },
        decision_referenced_ids=("ev-b",),
        expected_repo_id=case.repo_pin.repo_id, expected_commit_sha=case.repo_pin.commit_sha,
        repo_fixture_root=repo_root, graph_executed=True,
    )
    assert unused_good_ev.passed is False and unused_good_ev.evidence_match is False

    # 2. HITL resolves_fact=False does NOT create HUMAN_CONFIRMED_FACT, and unknown request_id fails closed
    client = _BenchmarkRuntimeClient(case, "t1", "a1", locale="vi")
    assert client.context()["locale"] == "vi"
    req = client.post_human_request({"question": "Who?", "unresolvedFact": "owner"})
    client.resolve_human_request(
        req["requestId"],
        HitlFixtureAnswer(request_key="owner", question_pattern="Who", answer="Unknown", resolves_fact=False),
    )
    assert client.facts == []
    with pytest.raises(ValueError, match="UNKNOWN_OPEN_HUMAN_REQUEST"):
        client.resolve_human_request("nonexistent-req", HitlFixtureAnswer(request_key="k", question_pattern="q", answer="a"))

    # 3. Setup/model-resolution failure inside _run_real_root_trial records failed TrialOutcome instead of aborting run
    def _boom(_case, _cfg):
        raise RuntimeError("MODEL_INIT_BOOM")

    err_report = run_benchmark(
        cases=[case],
        config=RunConfig(mode="LIVE", split="DEV", trials_per_case=1, k_values=(1,), allow_live=True, model_route="fake-live"),
        output_dir=tmp_path,
        run_id="setup-fail-recorded",
        live_model_factory=_boom,
    )
    assert err_report["semanticReliability"]["overall"]["failedTrials"] == 1
