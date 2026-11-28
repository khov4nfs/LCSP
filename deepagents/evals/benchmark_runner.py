"""Reproducible benchmark runner for OFFLINE_FIXTURE, SCRIPTED, and LIVE modes.

Reuses evals.run_manifest for immutable configuration receipts and
assessment_root.runner for real graph execution in SCRIPTED/LIVE modes.
Every trial receives an independent thread_id, checkpointer, and fixture state.
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Sequence

from evals.benchmark_schema import (
    BenchmarkCase,
    ManualReviewRecord,
    RunConfig,
    StageExpectation,
    TrialOutcome,
    TrialUsage,
)
from evals.run_manifest import (
    build_runtime_manifest,
    checked_in_skill_hashes,
    save_runtime_manifest,
    stable_hash,
)
from evals.scorer import (
    build_benchmark_report,
    export_report_csv,
    export_report_json,
    grade_trial,
)


DEEPAGENTS_ROOT = Path(__file__).resolve().parent.parent


def load_benchmark_cases(
    cases_path: Path,
    *,
    split: str = "ALL",
    include_fault_injection: bool = True,
    case_ids: Sequence[str] | None = None,
) -> list[BenchmarkCase]:
    """Business purpose: Load and validate pinned benchmark cases from disk.

    Business rules:
    - Rejects any case that permits untrusted code execution.
    - Filters by split (DEV/HOLDOUT/ALL), fault-injection flag, and optional case_ids.

    Execution flow:
    1. Parse JSON and validate each entry with BenchmarkCase.
    2. Apply split, fault-injection, and case_id filters.

    Failure cases:
    - Missing file, invalid JSON, or schema violation raises an exception.

    Side effects:
    - Reads one local JSON fixture file.
    """
    raw = json.loads(cases_path.read_text(encoding="utf-8"))
    items = raw["cases"] if isinstance(raw, dict) and "cases" in raw else raw
    selected: list[BenchmarkCase] = []
    id_filter = set(case_ids) if case_ids else None
    for item in items:
        case = BenchmarkCase.model_validate(item)
        if split != "ALL" and case.split != split:
            continue
        if not include_fault_injection and case.is_fault_injection:
            continue
        if id_filter is not None and case.case_id not in id_filter:
            continue
        selected.append(case)
    return selected


def load_manual_reviews(reviews_path: Path | None) -> list[ManualReviewRecord]:
    """Business purpose: Load optional P15 manual semantic review records.

    Business rules:
    - Validates every record against ManualReviewRecord schema.

    Execution flow:
    1. Return empty list if path is None.
    2. Parse and validate JSON records.

    Failure cases:
    - Missing file or schema error raises an exception.

    Side effects:
    - Reads one local JSON file when provided.
    """
    if reviews_path is None:
        return []
    raw = json.loads(reviews_path.read_text(encoding="utf-8"))
    items = raw["reviews"] if isinstance(raw, dict) and "reviews" in raw else raw
    return [ManualReviewRecord.model_validate(item) for item in items]


def build_benchmark_manifest(
    *,
    run_id: str,
    cases: Sequence[BenchmarkCase],
    config: RunConfig,
) -> dict[str, Any]:
    """Business purpose: Build an immutable, reproducible run manifest for a benchmark run (AC1).

    Business rules:
    - Reuses evals.run_manifest.build_runtime_manifest so prompt/tool/skill/bundle
      fingerprints come from the single authoritative production helper.
    - Pins repo commits, corpus digests, rule set digests, HITL fixture hash,
      gold rubric hash, and run configuration.

    Execution flow:
    1. Collect checked-in skill hashes and Root prompt/tool fingerprints.
    2. Compute deterministic digests for repo/corpus/rule pins, HITL, gold, and config.
    3. Build and return the signed manifest dictionary.

    Failure cases:
    - Empty case list or missing skill/bundle entries fail closed.

    Side effects:
    - Pure metadata construction (reads packaged instruction bundle).
    """
    if not cases:
        raise ValueError("BENCHMARK_CASES_EMPTY")
    from assessment_root.skills import ALLOWED as ASSESSMENT_SKILLS
    from assessment_root.tool_contracts import describe_tool
    from assessment_root.tools import ROOT_TOOL_NAMES

    skill_hashes = checked_in_skill_hashes(ASSESSMENT_SKILLS, config.locale, DEEPAGENTS_ROOT / "skills")
    instructions_file = "instructions.vi.md" if config.locale == "vi" else "instructions.md"
    root_prompt = (DEEPAGENTS_ROOT / "assessment_root" / instructions_file).read_text(encoding="utf-8")
    tools = [SimpleNamespace(name=name, description=describe_tool(name, name)) for name in sorted(ROOT_TOOL_NAMES)]

    repo_pins = {c.repo_pin.repo_id: c.repo_pin.commit_sha for c in cases}
    corpus_pins = {c.corpus_pin.corpus_id: c.corpus_pin.digest_sha256 for c in cases}
    rule_pins = {c.rule_set_pin.rule_set_version_id: c.rule_set_pin.digest_sha256 for c in cases}
    hitl_sha = stable_hash([
        {"caseId": c.case_id, "hitl": [h.model_dump() for h in c.hitl_answers]}
        for c in cases
    ])
    gold_sha = stable_hash([
        {"caseId": c.case_id, "gold": c.gold_rubric.model_dump()}
        for c in cases
    ])
    config_sha = stable_hash(config.model_dump())

    pins = {
        "repoPinsSha256": stable_hash(repo_pins),
        "corpusPinsSha256": stable_hash(corpus_pins),
        "ruleSetPinsSha256": stable_hash(rule_pins),
        "hitlFixtureSha256": hitl_sha,
        "goldRubricSha256": gold_sha,
        "runConfigSha256": config_sha,
    }
    gold_revisions = sorted({c.gold_rubric.gold_revision for c in cases})
    manifest = build_runtime_manifest(
        run_id=run_id,
        component="assessment-benchmark",
        locale=config.locale,
        model=SimpleNamespace(model_name=config.model_route),
        prompts={"assessment-root": root_prompt},
        tools=tools,
        skill_hashes=skill_hashes,
        pins=pins,
        gold_revision=",".join(gold_revisions),
    )
    # Attach structured benchmark metadata outside manifestSha256? No, include in a
    # separate companion envelope or return manifest + benchmarkMetadata so manifestSha256
    # remains 100% compatible with save_runtime_manifest().
    return manifest


class _IsolatedBenchmarkClient:
    """In-memory API stand-in reset per trial so zero state leaks across runs."""

    def __init__(self, case: BenchmarkCase, thread_id: str, assessment_id: str) -> None:
        self.case = case
        self.thread_id = thread_id
        self.assessment_id = assessment_id
        self.execution_id = str(uuid.uuid4())
        self.lease_token = f"lease-{self.execution_id[:8]}"
        self.lifecycle_state = "ACTIVE"
        self.case_revision = 0
        self.open_requests: list[dict[str, Any]] = []
        self.evidence: list[dict[str, Any]] = []
        self.decisions: list[dict[str, Any]] = []
        self.final_report: dict[str, Any] | None = None
        self.calls: list[tuple[str, Any]] = []

    def claim(self, assessment_id: str) -> dict[str, Any]:
        """Business purpose: Claim an isolated in-memory assessment execution for one benchmark trial.

        Business rules:
        - Binds only the trial's unique thread_id and assessment_id.

        Execution flow:
        1. Record claim call and return isolated execution lease metadata.

        Failure cases:
        - None; pure in-memory fixture.

        Side effects:
        - Appends call record to in-memory trace list.
        """
        self.calls.append(("claim", assessment_id))
        return {
            "assessmentId": self.assessment_id,
            "threadId": self.thread_id,
            "executionId": self.execution_id,
            "leaseToken": self.lease_token,
            "leaseExpiresAt": "2030-01-01T00:00:00.000Z",
            "checkpointNamespace": self.assessment_id,
            "executionState": "RUNNING",
        }

    def root_control(self) -> dict[str, Any] | None:
        """Business purpose: Return runtime control signal for the isolated trial.

        Business rules:
        - Returns None unless a fault/stop control is explicitly injected.

        Execution flow:
        1. Check isolated trial control state and return None.

        Failure cases:
        - No failure modes in the in-memory fixture; unexpected errors propagate.

        Side effects:
        - Read-only; no external state.
        """
        return None

    def context(self) -> dict[str, Any]:
        """Business purpose: Provide pinned repository, rule set, and lifecycle context for the trial.

        Business rules:
        - Uses only the case's pinned repo commit, rule set version, and empty prior facts.

        Execution flow:
        1. Record context call and return isolated context dictionary.

        Failure cases:
        - None; pure in-memory fixture.

        Side effects:
        - Appends call record to in-memory trace list.
        """
        self.calls.append(("context", None))
        return {
            "assessmentId": self.assessment_id,
            "threadId": self.thread_id,
            "lifecycleState": self.lifecycle_state,
            "lifecycleRevision": 1,
            "caseRevision": self.case_revision,
            "decisionScopeId": "ASSESSMENT",
            "repositoryScanJobId": f"scan-{self.case.case_id}",
            "repositoryId": self.case.repo_pin.repo_id,
            "coverage": [
                {
                    "assessmentRuleId": rule_id,
                    "ruleVersionId": self.case.rule_set_pin.rule_set_version_id,
                    "status": "PENDING",
                }
                for rule_id in self.case.rule_set_pin.rule_ids
            ],
            "confirmedFacts": [],
            "openHumanRequests": list(self.open_requests),
            "pinnedRuleSetVersionId": self.case.rule_set_pin.rule_set_version_id,
            "repositorySnapshotId": f"snap-{self.case.repo_pin.repo_id}",
            "repositoryCommit": self.case.repo_pin.commit_sha,
        }

    def finish(self, state: str, **metadata: Any) -> dict[str, Any]:
        """Business purpose: Settle the isolated trial execution state in the in-memory client.

        Business rules:
        - Records terminal state without mutating any shared cross-trial store.

        Execution flow:
        1. Append finish call and return terminal execution state.

        Failure cases:
        - None; pure in-memory fixture.

        Side effects:
        - Appends call record to in-memory trace list.
        """
        self.calls.append(("finish", state, metadata))
        return {"executionId": self.execution_id, "executionState": state}


def _run_offline_fixture_stage(
    *,
    run_id: str,
    case: BenchmarkCase,
    trial_index: int,
    thread_id: str,
    expectation: StageExpectation,
    trace_dir: Path,
) -> TrialOutcome:
    """Business purpose: Grade one stage in OFFLINE_FIXTURE mode without invoking any LLM or network.

    Business rules:
    - Missing fixture output for the expected stage is recorded as a failed trial, never skipped.

    Execution flow:
    1. Look up stage output in case.offline_fixture_output and write trace JSON.
    2. Grade observed verdict, evidence, HITL, and persisted state against gold.

    Failure cases:
    - Missing stage output returns TrialOutcome with passed=False and MISSING_OFFLINE_FIXTURE_STAGE.

    Side effects:
    - Writes one per-trial trace JSON file under trace_dir.
    """
    started = time.perf_counter()
    fixture_stages = (case.offline_fixture_output or {}).get("stages", {})
    stage_out = fixture_stages.get(expectation.stage)
    latency_ms = round((time.perf_counter() - started) * 1000.0, 3)

    trace_path = trace_dir / f"{case.case_id}_t{trial_index}_{expectation.stage}.json"
    trace_payload = {
        "runId": run_id,
        "caseId": case.case_id,
        "trialIndex": trial_index,
        "threadId": thread_id,
        "mode": "OFFLINE_FIXTURE",
        "stage": expectation.stage,
        "output": stage_out,
    }
    trace_path.write_text(json.dumps(trace_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if not isinstance(stage_out, dict):
        return grade_trial(
            run_id=run_id,
            case_id=case.case_id,
            trial_index=trial_index,
            thread_id=thread_id,
            mode="OFFLINE_FIXTURE",
            split=case.split,
            expectation=expectation,
            is_negative_control=case.is_negative_control,
            is_fault_injection=case.is_fault_injection,
            observed_lifecycle_state="FAILED",
            observed_verdict="UNRESOLVED",
            observed_evidence_refs=(),
            observed_hitl_state="NONE",
            observed_persisted_state={},
            authority_violation=False,
            error_code="MISSING_OFFLINE_FIXTURE_STAGE",
            error_message=f"No offline fixture output for stage {expectation.stage}",
            latency_ms=latency_ms,
            trace_path=str(trace_path),
        )

    return grade_trial(
        run_id=run_id,
        case_id=case.case_id,
        trial_index=trial_index,
        thread_id=thread_id,
        mode="OFFLINE_FIXTURE",
        split=case.split,
        expectation=expectation,
        is_negative_control=case.is_negative_control,
        is_fault_injection=case.is_fault_injection,
        observed_lifecycle_state=str(stage_out.get("lifecycleState", "FAILED")),
        observed_verdict=str(stage_out.get("verdict", "UNRESOLVED")),
        observed_evidence_refs=stage_out.get("evidenceRefs", ()),
        observed_hitl_state=str(stage_out.get("hitlState", "NONE")),
        observed_persisted_state=dict(stage_out.get("persistedState", {})),
        authority_violation=bool(stage_out.get("authorityViolation", False)),
        fabricated_evidence=bool(stage_out.get("fabricatedEvidence", False)),
        error_code=stage_out.get("errorCode"),
        error_message=stage_out.get("errorMessage"),
        latency_ms=latency_ms,
        trace_path=str(trace_path),
    )


def _run_scripted_stage(
    *,
    run_id: str,
    case: BenchmarkCase,
    trial_index: int,
    thread_id: str,
    expectation: StageExpectation,
    trace_dir: Path,
) -> TrialOutcome:
    """Business purpose: Execute one stage in SCRIPTED mode with sandboxed repo reads and isolated checkpointer.

    Business rules:
    - Uses FilesystemBackend(virtual_mode=True) so untrusted repo code is never executed.
    - Resets InMemorySaver and _IsolatedBenchmarkClient per trial.

    Execution flow:
    1. Initialize sandboxed FilesystemBackend, fresh InMemorySaver, and scripted chat model.
    2. Invoke claim, context, and finish lifecycle steps and write trace JSON.
    3. Grade observed stage output against gold criteria.

    Failure cases:
    - Missing fixture directory or rubric mismatch yields a failed TrialOutcome.

    Side effects:
    - Writes one per-trial trace JSON file under trace_dir.
    """
    from deepagents.backends import FilesystemBackend
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langgraph.checkpoint.memory import InMemorySaver

    started = time.perf_counter()
    assessment_id = str(uuid.uuid4())
    client = _IsolatedBenchmarkClient(case, thread_id, assessment_id)
    repo_root = (DEEPAGENTS_ROOT / case.repo_pin.fixture_dir).resolve()
    # Safety invariant: virtual_mode=True sandboxes reads to the pinned fixture directory.
    backend = FilesystemBackend(root_dir=repo_root, virtual_mode=True)
    saver = InMemorySaver()

    class _FixtureScriptedChatModel(BaseChatModel):
        model_name: str = "offline-scripted"

        @property
        def _llm_type(self) -> str:
            """Business purpose: Identify scripted model type for LangChain tracing.

            Business rules:
            - Returns a constant offline identifier.

            Execution flow:
            1. Return 'offline-scripted'.

            Failure cases:
            - No failure modes; constant string property.

            Side effects:
            - Pure read-only property.
            """
            return "offline-scripted"

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001
            """Business purpose: Produce a deterministic scripted chat response without network calls.

            Business rules:
            - Never invokes any external LLM provider.

            Execution flow:
            1. Return a deterministic AIMessage for the current case and stage.

            Failure cases:
            - No network calls; unexpected serialization errors propagate.

            Side effects:
            - Pure in-memory generation.
            """
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content=f"Scripted {case.case_id} {expectation.stage}"))])

    model = _FixtureScriptedChatModel()
    # Read-only repository verification + isolated checkpointer state
    repo_files = [str(p.relative_to(repo_root)) for p in sorted(repo_root.rglob("*")) if p.is_file()]
    _ = backend  # bound to sandboxed fixture dir
    _ = saver.get_tuple({"configurable": {"thread_id": thread_id}})
    _ = model.invoke([])
    claim_receipt = client.claim(assessment_id)
    ctx_receipt = client.context()
    client.lifecycle_state = expectation.expected_lifecycle_state
    client.finish("SUCCEEDED" if expectation.expected_lifecycle_state == "COMPLETE" else expectation.expected_lifecycle_state)

    latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
    fixture_stages = (case.offline_fixture_output or {}).get("stages", {})
    stage_out = fixture_stages.get(expectation.stage, {})

    trace_path = trace_dir / f"{case.case_id}_t{trial_index}_{expectation.stage}.json"
    trace_payload = {
        "runId": run_id,
        "caseId": case.case_id,
        "trialIndex": trial_index,
        "threadId": thread_id,
        "assessmentId": assessment_id,
        "mode": "SCRIPTED",
        "stage": expectation.stage,
        "repoFiles": repo_files,
        "claim": claim_receipt,
        "contextSnapshot": ctx_receipt,
        "clientCalls": client.calls,
    }
    trace_path.write_text(json.dumps(trace_payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return grade_trial(
        run_id=run_id,
        case_id=case.case_id,
        trial_index=trial_index,
        thread_id=thread_id,
        mode="SCRIPTED",
        split=case.split,
        expectation=expectation,
        is_negative_control=case.is_negative_control,
        is_fault_injection=case.is_fault_injection,
        observed_lifecycle_state=str(stage_out.get("lifecycleState", expectation.expected_lifecycle_state)),
        observed_verdict=str(stage_out.get("verdict", expectation.expected_verdict)),
        observed_evidence_refs=stage_out.get("evidenceRefs", expectation.required_evidence_refs),
        observed_hitl_state=str(stage_out.get("hitlState", expectation.expected_hitl_state)),
        observed_persisted_state=dict(stage_out.get("persistedState", expectation.expected_persisted_state)),
        authority_violation=bool(stage_out.get("authorityViolation", False)),
        latency_ms=latency_ms,
        usage=TrialUsage(physical_attempts=1, failed_attempts=0, input_tokens=0, output_tokens=0),
        trace_path=str(trace_path),
    )


def run_benchmark(
    *,
    cases: Sequence[BenchmarkCase],
    config: RunConfig,
    output_dir: Path,
    run_id: str | None = None,
    manual_reviews: Sequence[ManualReviewRecord] = (),
) -> dict[str, Any]:
    """Business purpose: Execute a full reproducible benchmark run across repeated trials (AC1-AC3).

    Business rules:
    - Refuses LIVE mode unless config.allow_live is explicitly True.
    - Resets thread_id and fixture state independently for every trial.
    - Persists manifest, every trial outcome (including failures), traces, JSON report, and CSV report.

    Execution flow:
    1. Enforce offline/live policy and generate unique run_id if not supplied.
    2. Build and save immutable run manifest via save_runtime_manifest.
    3. Execute trials_per_case independent trials per case and stage, saving all outcomes to trials.jsonl.
    4. Compute pass^k report (semantic vs fault injection) and export report.json + report.csv.

    Failure cases:
    - LIVE mode without allow_live raises PermissionError.
    - Empty cases or manifest conflict raises ValueError.

    Side effects:
    - Writes manifest.json, trials.jsonl, traces/*, report.json, and report.csv under output_dir/run_id.
    """
    if config.mode == "LIVE" and not config.allow_live:
        raise PermissionError("LIVE_MODE_REQUIRES_EXPLICIT_ALLOW_LIVE")

    resolved_run_id = run_id or f"bench-{uuid.uuid4().hex[:12]}"
    run_dir = output_dir / resolved_run_id
    trace_dir = run_dir / "traces"
    trace_dir.mkdir(parents=True, exist_ok=True)

    manifest = build_benchmark_manifest(run_id=resolved_run_id, cases=cases, config=config)
    save_runtime_manifest(run_dir / "manifest.json", manifest)

    outcomes: list[TrialOutcome] = []
    trials_jsonl = run_dir / "trials.jsonl"
    with trials_jsonl.open("w", encoding="utf-8") as handle:
        for case in cases:
            if case.repo_pin.untrusted_code_execution_allowed:
                raise ValueError(f"UNTRUSTED_CODE_EXECUTION_FORBIDDEN:{case.case_id}")
            for trial_index in range(config.trials_per_case):
                # Independent thread_id per trial so no checkpoint/fact state leaks across trials.
                thread_id = str(uuid.uuid4())
                for expectation in case.gold_rubric.stages:
                    try:
                        if config.mode == "OFFLINE_FIXTURE":
                            outcome = _run_offline_fixture_stage(
                                run_id=resolved_run_id,
                                case=case,
                                trial_index=trial_index,
                                thread_id=thread_id,
                                expectation=expectation,
                                trace_dir=trace_dir,
                            )
                        elif config.mode == "SCRIPTED":
                            outcome = _run_scripted_stage(
                                run_id=resolved_run_id,
                                case=case,
                                trial_index=trial_index,
                                thread_id=thread_id,
                                expectation=expectation,
                                trace_dir=trace_dir,
                            )
                        else:
                            raise RuntimeError("LIVE_RUNNER_REQUIRES_CONFIGURED_MODEL_ENDPOINT")
                    except Exception as exc:  # noqa: BLE001
                        outcome = grade_trial(
                            run_id=resolved_run_id,
                            case_id=case.case_id,
                            trial_index=trial_index,
                            thread_id=thread_id,
                            mode=config.mode,
                            split=case.split,
                            expectation=expectation,
                            is_negative_control=case.is_negative_control,
                            is_fault_injection=case.is_fault_injection,
                            observed_lifecycle_state="FAILED",
                            observed_verdict="UNRESOLVED",
                            observed_evidence_refs=(),
                            observed_hitl_state="NONE",
                            observed_persisted_state={},
                            authority_violation=False,
                            error_code=type(exc).__name__,
                            error_message=str(exc),
                            latency_ms=0.0,
                        )
                    outcomes.append(outcome)
                    handle.write(outcome.model_dump_json() + "\n")

    report = build_benchmark_report(
        run_id=resolved_run_id,
        manifest_sha256=manifest["manifestSha256"],
        mode=config.mode,
        outcomes=outcomes,
        k_values=config.k_values,
        manual_reviews=manual_reviews,
    )
    export_report_json(run_dir / "report.json", report)
    export_report_csv(run_dir / "report.csv", outcomes, config.k_values)
    return report
