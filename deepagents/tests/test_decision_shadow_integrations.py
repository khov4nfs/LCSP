import json

from decision import (
    DecisionGateway,
    DecisionGatewayConfig,
    InMemoryDecisionIdempotencyStore,
    InterviewRoutingPacket,
    PrReviewTriagePacket,
    RootRoutingPacket,
    ShadowDecisionObserver,
    ShadowDecisionRecord,
    WorkerApiDecisionIdempotencyStore,
)
from contracts.handoffs import PlannerResult
from decision.pr_review_triage import (
    record_pr_review_shadow_triage_packet,
    run_pr_review_shadow_triage,
    write_pr_review_shadow_triage_packet,
)
from orchestration.dispatcher import RootSubagentDispatcher
from orchestration.lifecycle import RootSubagentReservation
from decision.shadow import INTERVIEW_TOPIC_CHOICES, ROOT_ROUTE_CHOICES
from decision.telemetry import InMemoryDecisionTelemetrySink
from decision.typesafe_client import TypeSafeJevClient, TypeSafeJevError


def _config(**overrides):
    values = {
        "provider": "jev",
        "mode": "SHADOW",
        "fallback": "existing",
        "api_key": "typesafe-test-key",
        "timeout_ms": 100,
        "policy_version": "TEST_POLICY",
        "endpoint": "https://typesafe.test/jev",
        "max_retries": 0,
    }
    values.update(overrides)
    return DecisionGatewayConfig(**values)


def _client(*, calls=None, choice_overrides=None, confidence=0.93, errors=None):
    call_log = calls if calls is not None else []
    choices = dict(choice_overrides or {})
    failures = list(errors or [])

    def transport(payload, headers, timeout):
        call_log.append({"payload": payload, "headers": headers, "timeout": timeout})
        if failures:
            raise failures.pop(0)
        decisions = []
        for question in payload["questions"]:
            question_id = question["question_id"]
            question_type = question["question_type"]
            item = {
                "questionId": question_id,
                "confidence": confidence,
                "probability": confidence,
            }
            if question_type == "CHOICE":
                selected = choices.get(question_id, question["choices"][0])
                item["choice"] = selected
                item["probabilities"] = {selected: confidence}
            elif question_type == "SCORE":
                item["score"] = 0.64
            else:
                item["noul"] = {"value": True, "reason_code": "BOUNDED_SIGNAL"}
            decisions.append(item)
        return {
            "provider": "typesafe",
            "modelVersion": "jev-shadow-test",
            "responseId": "jev-shadow-response",
            "usage": {"inputTokens": 20, "outputTokens": 10},
            "decisions": decisions,
        }

    return TypeSafeJevClient(
        api_key="typesafe-test-key",
        endpoint="https://typesafe.test/jev",
        timeout_ms=100,
        max_retries=0,
        transport=transport,
    )


def _observer(*, client, sink=None, config=None, seen=None, store=None):
    gateway = DecisionGateway(config=config or _config(), client=client)
    return ShadowDecisionObserver(
        gateway=gateway,
        telemetry_sink=sink,
        idempotency_store=store,
        seen_decision_ids=seen,
    )


def _pr_packet(**overrides):
    values = {
        "pr_number": 343,
        "head_sha": "d2a7352c26494f00a0ce51f534d508364eb26c08",
        "base_sha": "4064ae2c498f8d712e7e7c4c55a5e89f6a1cd0fb",
        "review_run_id": "review-run-1",
        "changed_filenames": ("deepagents/decision/shadow.py", "deepagents/tests/test_decision_shadow_integrations.py"),
        "change_categories": ("python", "tests"),
        "jira_issue_ids": ("LCSP-336",),
        "acceptance_criteria_ids": ("AC-shadow-pr-triage",),
        "bounded_summary": "Decision shadow observer and focused tests.",
        "ci_state_codes": ("PYTHON_WORKER_PENDING", "RELEASE_GATE_PENDING"),
        "scanner_change_metadata": ("PGE_METADATA_AVAILABLE",),
        "diff_stat_keys": ("python_files_changed", "tests_changed"),
        "addition_count": 120,
        "deletion_count": 4,
        "pge_artifact_version": "sha256:" + "a" * 64,
    }
    values.update(overrides)
    return PrReviewTriagePacket(**values)


def test_pr_review_triage_records_shadow_result_with_exact_head_correlation():
    calls = []
    sink = InMemoryDecisionTelemetrySink()
    observer = _observer(
        client=_client(calls=calls, choice_overrides={"affected_domain": "SCANNER"}),
        sink=sink,
    )

    record = observer.observe_pr_review_triage(
        _pr_packet(),
        authoritative_domain="SCANNER",
    )

    assert len(calls) == 1
    payload = calls[0]["payload"]
    assert payload["head_sha"] == "d2a7352c26494f00a0ce51f534d508364eb26c08"
    assert "raw_diff" not in json.dumps(payload, sort_keys=True)
    assert record.shadow_proposed_action == "SCANNER"
    assert record.authoritative_action == "SCANNER"
    assert record.agreement is True
    result_events = [event for event in sink.events if event["eventType"] == "DECISION_MODEL_RESULT"]
    assert result_events
    assert result_events[0]["headSha"] == "d2a7352c26494f00a0ce51f534d508364eb26c08"
    assert result_events[0]["data"]["authoritativeAction"] == "SCANNER"
    assert result_events[0]["data"]["shadowProposedAction"] == "SCANNER"
    assert result_events[0]["data"]["agreement"] is True


def test_pr_review_triage_rejects_raw_source_before_provider_execution():
    calls = []
    observer = _observer(client=_client(calls=calls))

    record = observer.observe_pr_review_triage(
        _pr_packet(bounded_summary="def leak_secret():\n    return token"),
        authoritative_domain="SCANNER",
    )

    assert calls == []
    assert record.gateway_outcome is not None
    assert record.gateway_outcome.provider_result is None
    assert record.fallback_reason == "RAW_SOURCE_PAYLOAD_FORBIDDEN"


def test_root_deterministic_transition_bypasses_jev():
    calls = []
    observer = _observer(client=_client(calls=calls))

    record = observer.observe_root_routing(
        RootRoutingPacket(
            assessment_id="assessment-1",
            review_run_id="run-1",
            checkpoint_id="checkpoint-1",
            current_stage="ENGINEERING_RULE_DONE",
            run_status="READY",
            authoritative_route="PLAN",
            deterministic_transition_available=True,
        )
    )

    assert calls == []
    assert record.skipped is True
    assert record.authoritative_action == "PLAN"
    assert record.fallback_reason == "DETERMINISTIC_TRANSITION"


def test_ambiguous_root_routing_observes_jev_without_changing_authority():
    calls = []
    sink = InMemoryDecisionTelemetrySink()
    observer = _observer(
        client=_client(calls=calls, choice_overrides={"route": "INVESTIGATE"}),
        sink=sink,
    )

    record = observer.observe_root_routing(
        RootRoutingPacket(
            assessment_id="assessment-1",
            review_run_id="run-1",
            checkpoint_id="checkpoint-ambiguous",
            current_stage="POST_INTERVIEW",
            run_status="AMBIGUOUS",
            authoritative_route="PLAN",
            deterministic_transition_available=False,
            pending_stage_candidates=("PLAN", "INVESTIGATE"),
            coverage_state="PARTIAL",
        )
    )

    assert len(calls) == 1
    assert calls[0]["payload"]["questions"][0]["choices"] == list(ROOT_ROUTE_CHOICES)
    assert record.authoritative_action == "PLAN"
    assert record.shadow_proposed_action == "INVESTIGATE"
    assert record.agreement is False
    assert sink.events[0]["assessmentId"] == "assessment-1"
    assert sink.events[0]["reviewRunId"] == "run-1"


def test_provider_failure_and_low_confidence_leave_root_route_unchanged():
    failure_calls = []
    failure_observer = _observer(
        client=_client(
            calls=failure_calls,
            errors=[TypeSafeJevError("PROVIDER_AUTH_ERROR", "auth failed")],
        )
    )

    failed = failure_observer.observe_root_routing(
        RootRoutingPacket(
            assessment_id="assessment-1",
            review_run_id="run-fail",
            checkpoint_id="checkpoint-fail",
            current_stage="POST_INTERVIEW",
            run_status="AMBIGUOUS",
            authoritative_route="INTERVIEW",
            deterministic_transition_available=False,
        )
    )

    assert failed.authoritative_action == "INTERVIEW"
    assert failed.shadow_proposed_action is None
    assert failed.fallback_reason == "PROVIDER_AUTH_ERROR"

    low_confidence_calls = []
    low_confidence_observer = _observer(
        client=_client(
            calls=low_confidence_calls,
            choice_overrides={"route": "GATE"},
            confidence=0.2,
        )
    )

    low_confidence = low_confidence_observer.observe_root_routing(
        RootRoutingPacket(
            assessment_id="assessment-1",
            review_run_id="run-low-confidence",
            checkpoint_id="checkpoint-low-confidence",
            current_stage="POST_INTERVIEW",
            run_status="AMBIGUOUS",
            authoritative_route="INTERVIEW",
            deterministic_transition_available=False,
        )
    )

    assert low_confidence.authoritative_action == "INTERVIEW"
    assert low_confidence.shadow_proposed_action == "GATE"
    assert low_confidence.fallback_reason == "LOW_CONFIDENCE"


def test_interview_topic_choice_is_restricted_to_server_owned_enum():
    calls = []
    observer = _observer(
        client=_client(calls=calls, choice_overrides={"missing_topic": "DATA_SOURCE"})
    )

    record = observer.observe_interview_routing(
        InterviewRoutingPacket(
            assessment_id="assessment-1",
            review_run_id="run-interview",
            authoritative_topic="DATA_SOURCE",
            active_question_id="question-1",
            active_topic_key="DATA_SOURCE",
            context_revision=3,
            customer_safe_topic_keys=("DATA_SOURCE", "PURPOSE"),
            unresolved_topic_keys=("DATA_SOURCE",),
            resolution_criteria_keys=("data_source_confirmed",),
        )
    )

    assert len(calls) == 1
    topic_question = calls[0]["payload"]["questions"][1]
    assert topic_question["question_id"] == "missing_topic"
    assert tuple(topic_question["choices"]) == INTERVIEW_TOPIC_CHOICES
    assert record.shadow_proposed_action == "DATA_SOURCE"
    assert record.agreement is True


def test_jev_cannot_set_ai_absence_risk_or_readiness_state():
    calls = []
    observer = _observer(
        client=_client(calls=calls, choice_overrides={"missing_topic": "AI_ABSENT_CONFIRMED"})
    )

    record = observer.observe_interview_routing(
        InterviewRoutingPacket(
            assessment_id="assessment-1",
            review_run_id="run-invalid-topic",
            authoritative_topic="NONE",
        )
    )

    assert record.gateway_outcome is not None
    assert record.gateway_outcome.provider_result is None
    assert record.shadow_proposed_action is None
    assert record.authoritative_action == "NONE"
    assert record.fallback_reason == "PROVIDER_SCHEMA_INVALID"


def test_shadow_observer_deduplicates_replayed_decision_id():
    calls = []
    store = InMemoryDecisionIdempotencyStore()
    observer = _observer(
        client=_client(calls=calls, choice_overrides={"affected_domain": "CI_RELEASE"}),
        store=store,
    )
    packet = _pr_packet(pr_number=344, head_sha="b" * 40)

    first = observer.observe_pr_review_triage(packet, authoritative_domain="CI_RELEASE")
    recreated_observer = _observer(
        client=_client(calls=calls, choice_overrides={"affected_domain": "CI_RELEASE"}),
        store=store,
    )
    replay = recreated_observer.observe_pr_review_triage(packet, authoritative_domain="CI_RELEASE")

    assert len(calls) == 1
    assert first.skipped is False
    assert replay.skipped is True
    assert replay.fallback_reason == "DUPLICATE_DECISION_ID"


def test_shadow_observer_skips_provider_when_durable_claim_is_unavailable():
    calls = []

    class FailingClaimApi:
        def claim_decision_model_request(self, decision_id, payload):
            raise RuntimeError("claim API unavailable")

    observer = _observer(
        client=_client(calls=calls, choice_overrides={"affected_domain": "CI_RELEASE"}),
        store=WorkerApiDecisionIdempotencyStore(FailingClaimApi()),
    )

    record = observer.observe_pr_review_triage(
        _pr_packet(pr_number=345, head_sha="c" * 40),
        authoritative_domain="CI_RELEASE",
    )

    assert calls == []
    assert record.skipped is True
    assert record.fallback_reason == "IDEMPOTENCY_CLAIM_UNAVAILABLE"


def test_interview_decision_identity_includes_context_revision():
    calls = []
    store = InMemoryDecisionIdempotencyStore()
    first_observer = _observer(
        client=_client(calls=calls, choice_overrides={"missing_topic": "PURPOSE"}),
        store=store,
    )
    packet_v1 = InterviewRoutingPacket(
        assessment_id="assessment-1",
        review_run_id="run-interview",
        authoritative_topic="PURPOSE",
        context_revision=1,
    )
    packet_v2 = InterviewRoutingPacket(
        assessment_id="assessment-1",
        review_run_id="run-interview",
        authoritative_topic="PURPOSE",
        context_revision=2,
    )

    first = first_observer.observe_interview_routing(packet_v1)
    replay_observer = _observer(
        client=_client(calls=calls, choice_overrides={"missing_topic": "PURPOSE"}),
        store=store,
    )
    replay = replay_observer.observe_interview_routing(packet_v1)
    later_revision = replay_observer.observe_interview_routing(packet_v2)

    assert len(calls) == 2
    assert first.decision_id.endswith(":rev-1")
    assert replay.skipped is True
    assert later_revision.decision_id.endswith(":rev-2")
    assert later_revision.skipped is False


def test_root_dispatcher_observes_shadow_route_without_changing_authoritative_dispatch():
    from unittest.mock import MagicMock

    calls = []
    observer = _observer(
        client=_client(calls=calls, choice_overrides={"route": "INVESTIGATE"})
    )
    lifecycle = MagicMock()
    reservation = RootSubagentReservation(
        subagent_type="planner",
        status="OWNER",
        execution_id="planner:owner",
        trigger="AMBIGUOUS_ROOT_ROUTE",
    )
    lifecycle.reserve_subagent.return_value = reservation
    lifecycle.owner_instruction.return_value = ""
    lifecycle.complete_subagent.return_value = {"status": "COMPLETE"}
    specialist = MagicMock()
    specialist.invoke.return_value = {
        "structured_response": {
            "status": "INVESTIGATE",
            "engineering_rule_ids": ["ENG-1"],
            "artifact_versions": {"technicalEvidenceReportId": "ter-1"},
            "coverage_state": "COMPLETE",
            "selected_scope": [
                {
                    "ref": "node:ai",
                    "criterion": "AI invocation exists",
                }
            ],
            "unresolved_facts": [],
            "next_step": "INVESTIGATE",
        }
    }
    dispatcher = RootSubagentDispatcher(
        lifecycle=lifecycle,
        agent_factory=MagicMock(return_value=specialist),
        subagents={
            "planner": {
                "name": "planner",
                "model": "test-model",
                "tools": [],
                "system_prompt": "planner prompt",
                "middleware": [],
                "response_format": PlannerResult,
            }
        },
        shadow_decision_observer=observer,
    )

    result = dispatcher.dispatch(
        subagent_type="planner",
        instruction="Plan from bounded state.",
        trigger="AMBIGUOUS_ROOT_ROUTE",
        metadata={
            "root_shadow_routing": True,
            "assessment_id": "assessment-1",
            "workflow_run_id": "workflow-1",
            "checkpoint_id": "checkpoint-1",
            "current_stage": "POST_INTERVIEW",
            "run_status": "AMBIGUOUS",
            "pending_stage_candidates": ("PLAN", "INVESTIGATE"),
            "deterministic_transition_available": False,
        },
        reenter_root=False,
    )

    assert len(calls) == 1
    assert result["status"] == "COMPLETED"
    assert result["subagentType"] == "planner"


def test_root_dispatcher_shadow_bypasses_deterministic_transition_at_call_site():
    from unittest.mock import MagicMock

    calls = []
    observer = _observer(client=_client(calls=calls))
    root = MagicMock()
    root.invoke.return_value = {"messages": [{"role": "assistant", "content": "queued"}]}
    dispatcher = RootSubagentDispatcher(
        root_agent=root,
        subagents={
            "planner": {
                "name": "planner",
                "model": "test-model",
                "tools": [],
                "system_prompt": "planner prompt",
                "middleware": [],
            }
        },
        shadow_decision_observer=observer,
    )

    result = dispatcher.dispatch(
        subagent_type="planner",
        instruction="Plan from deterministic state.",
        trigger="DETERMINISTIC_ROUTE",
        metadata={
            "root_shadow_routing": True,
            "assessment_id": "assessment-1",
            "workflow_run_id": "workflow-1",
            "checkpoint_id": "checkpoint-1",
            "current_stage": "ENGINEERING_RULE_READY",
            "run_status": "READY",
            "pending_stage_candidates": ("PLAN",),
            "deterministic_transition_available": True,
        },
    )

    assert result["status"] == "ROOT_REENTERED"
    assert calls == []


def test_root_dispatcher_shadow_observer_failure_does_not_block_authoritative_dispatch():
    from unittest.mock import MagicMock

    class RaisingObserver:
        def observe_root_routing(self, packet):
            raise RuntimeError("shadow should not block root")

    root = MagicMock()
    root.invoke.return_value = {"messages": [{"role": "assistant", "content": "queued"}]}
    dispatcher = RootSubagentDispatcher(
        root_agent=root,
        subagents={
            "planner": {
                "name": "planner",
                "model": "test-model",
                "tools": [],
                "system_prompt": "planner prompt",
                "middleware": [],
            }
        },
        shadow_decision_observer=RaisingObserver(),
    )

    result = dispatcher.dispatch(
        subagent_type="planner",
        instruction="Plan from ambiguous state.",
        trigger="AMBIGUOUS_ROOT_ROUTE",
        metadata={
            "root_shadow_routing": True,
            "assessment_id": "assessment-1",
            "workflow_run_id": "workflow-1",
            "checkpoint_id": "checkpoint-1",
            "current_stage": "POST_INTERVIEW",
            "run_status": "AMBIGUOUS",
            "pending_stage_candidates": ("PLAN", "INVESTIGATE"),
            "deterministic_transition_available": False,
        },
    )

    assert result["status"] == "ROOT_REENTERED"
    assert result["subagentType"] == "planner"


def test_pr_review_triage_runner_records_bounded_exact_head_packet(tmp_path, monkeypatch):
    observed = {}
    head_sha = "d" * 40
    base_sha = "e" * 40

    def fake_git_lines(*args):
        if "--name-only" in args:
            return [
                "deepagents/decision/shadow.py",
                "apps/api/src/modules/scan/presentation/http/scan.controller.ts",
            ]
        if "--numstat" in args:
            return [
                "12\t3\tdeepagents/decision/shadow.py",
                "4\t1\tapps/api/src/modules/scan/presentation/http/scan.controller.ts",
            ]
        return []

    class FakeObserver:
        def observe_pr_review_triage(self, packet, *, authoritative_domain=None):
            observed["packet"] = packet
            observed["authoritative_domain"] = authoritative_domain
            return ShadowDecisionRecord(
                decision_id=f"review-triage-v1:{packet.pr_number}:{packet.head_sha}",
                decision_type="PR_REVIEW_TRIAGE",
                authoritative_action=authoritative_domain,
                shadow_proposed_action="AGENT_RUNTIME",
                agreement=authoritative_domain == "AGENT_RUNTIME",
                confidence=None,
                fallback_reason="MISSING_CREDENTIALS",
                skipped=False,
            )

    monkeypatch.setattr("decision.pr_review_triage._git_lines", fake_git_lines)
    monkeypatch.setenv("GITHUB_RUN_ID", "run-336")
    output = tmp_path / "pr-review-triage.json"

    result = run_pr_review_shadow_triage(
        pr_number=344,
        base_sha=base_sha,
        head_sha=head_sha,
        output_path=output,
        observer_factory=lambda sink: FakeObserver(),
    )

    packet = observed["packet"]
    assert packet.pr_number == 344
    assert packet.head_sha == head_sha
    assert packet.base_sha == base_sha
    assert "deepagents/decision/shadow.py" in packet.changed_filenames
    assert packet.addition_count == 16
    assert packet.deletion_count == 4
    assert packet.acceptance_criteria_ids == ()
    assert observed["authoritative_domain"] == "AGENT_RUNTIME"
    serialized = json.dumps(packet.__dict__, sort_keys=True)
    assert "raw_diff" not in serialized
    assert "def " not in serialized
    assert result["headSha"] == head_sha
    assert output.exists()


def test_pr_review_triage_pull_request_stage_writes_packet_without_provider_call(tmp_path, monkeypatch):
    head_sha = "f" * 40
    base_sha = "a" * 40

    def fake_git_lines(*args):
        if "--name-only" in args:
            return ["deepagents/decision/shadow.py"]
        if "--numstat" in args:
            return ["8\t2\tdeepagents/decision/shadow.py"]
        return []

    monkeypatch.setattr("decision.pr_review_triage._git_lines", fake_git_lines)
    output = tmp_path / "pr-review-triage-packet.json"

    result = write_pr_review_shadow_triage_packet(
        pr_number=344,
        base_sha=base_sha,
        head_sha=head_sha,
        output_path=output,
    )

    assert result["recordingStatus"] == "PACKET_READY_UNTRUSTED_PR_STAGE"
    assert result["typedResultRecorded"] is False
    assert result["trustedRecorderRequired"] is True
    packet = result["packet"]
    assert packet["head_sha"] == head_sha
    assert packet["base_sha"] == base_sha
    assert packet["acceptance_criteria_ids"] == ()
    serialized = output.read_text(encoding="utf-8")
    assert "TYPESAFE_API_KEY" not in serialized
    assert "raw_diff" not in serialized


def test_pr_review_triage_trusted_recorder_requires_durable_store(tmp_path):
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(
        json.dumps(
            {
                "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_PACKET_V1",
                "authoritativeReviewDomain": "AGENT_RUNTIME",
                "packet": {
                    "pr_number": 344,
                    "head_sha": "b" * 40,
                    "base_sha": "c" * 40,
                    "changed_filenames": ["deepagents/decision/shadow.py"],
                    "change_categories": ["python_worker"],
                    "jira_issue_ids": ["LCSP-336"],
                    "acceptance_criteria_ids": [],
                    "ci_state_codes": ["GITHUB_ACTIONS"],
                    "scanner_change_metadata": [],
                    "diff_stat_keys": ["python_worker_files_changed"],
                },
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "record.json"

    result = record_pr_review_shadow_triage_packet(
        packet_path=packet_path,
        output_path=output,
        require_durable=True,
    )

    assert result["recordingStatus"] == "TYPED_RESULT_NOT_RECORDED_DURABLE_CREDENTIALS_MISSING"
    assert result["typedResultRecorded"] is False
    assert result["headSha"] == "b" * 40


def test_pr_review_triage_trusted_recorder_rejects_forged_packet_correlation(tmp_path):
    packet_path = tmp_path / "packet.json"
    trusted_head_sha = "b" * 40
    trusted_base_sha = "c" * 40
    packet_path.write_text(
        json.dumps(
            {
                "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_PACKET_V1",
                "authoritativeReviewDomain": "LEGAL_RULES",
                "packet": {
                    "pr_number": 999,
                    "head_sha": "d" * 40,
                    "base_sha": trusted_base_sha,
                    "changed_filenames": ["deepagents/decision/shadow.py"],
                    "change_categories": ["python_worker"],
                    "jira_issue_ids": ["LCSP-336"],
                    "acceptance_criteria_ids": [],
                    "ci_state_codes": ["GITHUB_ACTIONS"],
                    "scanner_change_metadata": [],
                    "diff_stat_keys": ["python_worker_files_changed"],
                },
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "record.json"

    def fail_if_called(sink):
        raise AssertionError("forged packets must not construct observers")

    result = record_pr_review_shadow_triage_packet(
        packet_path=packet_path,
        output_path=output,
        require_durable=True,
        expected_pr_number=344,
        expected_head_sha=trusted_head_sha,
        expected_base_sha=trusted_base_sha,
        trusted_authoritative_domain="AGENT_RUNTIME",
        observer_factory=fail_if_called,
    )

    assert result["recordingStatus"] == "TYPED_RESULT_NOT_RECORDED_CORRELATION_MISMATCH"
    assert result["typedResultRecorded"] is False
    assert result["correlationMismatches"] == ["PR_NUMBER_MISMATCH", "HEAD_SHA_MISMATCH"]
    assert result["trustedCorrelation"] == {
        "prNumber": 344,
        "headSha": trusted_head_sha,
        "baseSha": trusted_base_sha,
    }
    assert result["authoritativeReviewDomain"] == "AGENT_RUNTIME"
    assert not output.with_suffix(".events.jsonl").exists()


def test_pr_review_triage_trusted_recorder_uses_trusted_authoritative_domain(tmp_path):
    packet_path = tmp_path / "packet.json"
    head_sha = "b" * 40
    base_sha = "c" * 40
    observed = {}
    packet_path.write_text(
        json.dumps(
            {
                "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_PACKET_V1",
                "authoritativeReviewDomain": "LEGAL_RULES",
                "packet": {
                    "pr_number": 344,
                    "head_sha": head_sha,
                    "base_sha": base_sha,
                    "changed_filenames": ["docs/operations/lcsp-336.md"],
                    "change_categories": ["docs"],
                    "jira_issue_ids": ["LCSP-336"],
                    "acceptance_criteria_ids": [],
                    "ci_state_codes": ["GITHUB_ACTIONS"],
                    "scanner_change_metadata": [],
                    "diff_stat_keys": ["docs_files_changed"],
                },
            }
        ),
        encoding="utf-8",
    )

    class FakeObserver:
        def observe_pr_review_triage(self, packet, *, authoritative_domain=None):
            observed["authoritative_domain"] = authoritative_domain
            return ShadowDecisionRecord(
                decision_id=f"review-triage-v1:{packet.pr_number}:{packet.head_sha}",
                decision_type="PR_REVIEW_TRIAGE",
                authoritative_action=authoritative_domain,
                shadow_proposed_action="AGENT_RUNTIME",
                agreement=False,
                confidence=None,
                fallback_reason="MISSING_CREDENTIALS",
                skipped=False,
            )

    result = record_pr_review_shadow_triage_packet(
        packet_path=packet_path,
        output_path=tmp_path / "record.json",
        expected_pr_number=344,
        expected_head_sha=head_sha,
        expected_base_sha=base_sha,
        trusted_authoritative_domain="AGENT_RUNTIME",
        observer_factory=lambda sink: FakeObserver(),
    )

    assert observed["authoritative_domain"] == "AGENT_RUNTIME"
    assert result["authoritativeReviewDomain"] == "AGENT_RUNTIME"


def test_pr_review_triage_trusted_recorder_replaces_forged_packet_metadata(
    tmp_path,
    monkeypatch,
):
    packet_path = tmp_path / "packet.json"
    compare_path = tmp_path / "trusted-compare.json"
    head_sha = "b" * 40
    base_sha = "c" * 40
    observed = {}
    monkeypatch.delenv("LCSP_PGE_ARTIFACT_VERSION", raising=False)
    packet_path.write_text(
        json.dumps(
            {
                "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_PACKET_V1",
                "authoritativeReviewDomain": "LEGAL_RULES",
                "packet": {
                    "pr_number": 344,
                    "head_sha": head_sha,
                    "base_sha": base_sha,
                    "changed_filenames": ["apps/api/src/fake-payment-secret.ts"],
                    "change_categories": ["api"],
                    "jira_issue_ids": ["LCSP-999"],
                    "acceptance_criteria_ids": ["LCSP-999:forged"],
                    "bounded_summary": "forged unrestricted PR summary",
                    "ci_state_codes": ["FORGED_CI_GREEN"],
                    "scanner_change_metadata": ["FORGED_SCANNER_SIGNAL"],
                    "diff_stat_keys": ["forged_files_changed"],
                    "addition_count": 9999,
                    "deletion_count": 9999,
                    "pge_artifact_version": "forged-pge-version",
                },
            }
        ),
        encoding="utf-8",
    )
    compare_path.write_text(
        json.dumps(
            {
                "files": [
                    {
                        "filename": "deepagents/decision/shadow.py",
                        "additions": 10,
                        "deletions": 2,
                    },
                    {
                        "filename": "docs/operations/lcsp-336.md",
                        "additions": 5,
                        "deletions": 1,
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    class FakeObserver:
        def observe_pr_review_triage(self, packet, *, authoritative_domain=None):
            observed["packet"] = packet
            observed["authoritative_domain"] = authoritative_domain
            return ShadowDecisionRecord(
                decision_id=f"review-triage-v1:{packet.pr_number}:{packet.head_sha}",
                decision_type="PR_REVIEW_TRIAGE",
                authoritative_action=authoritative_domain,
                shadow_proposed_action="AGENT_RUNTIME",
                agreement=True,
                confidence=None,
                fallback_reason="MISSING_CREDENTIALS",
                skipped=False,
            )

    result = record_pr_review_shadow_triage_packet(
        packet_path=packet_path,
        output_path=tmp_path / "record.json",
        expected_pr_number=344,
        expected_head_sha=head_sha,
        expected_base_sha=base_sha,
        trusted_authoritative_domain="AGENT_RUNTIME",
        trusted_compare_path=compare_path,
        trusted_pr_title="LCSP-336 shadow decision integrations",
        trusted_head_ref="feat/LCSP-336-shadow",
        trusted_review_run_id="trusted-run-1",
        trusted_ci_state_codes=("workflow:Tests", "conclusion:success"),
        require_trusted_metadata=True,
        observer_factory=lambda sink: FakeObserver(),
    )

    packet = observed["packet"]
    assert packet.changed_filenames == (
        "deepagents/decision/shadow.py",
        "docs/operations/lcsp-336.md",
    )
    assert packet.change_categories == ("python_worker", "docs")
    assert packet.jira_issue_ids == ("LCSP-336",)
    assert packet.acceptance_criteria_ids == ()
    assert packet.ci_state_codes == ("workflow:Tests", "conclusion:success")
    assert packet.scanner_change_metadata == ()
    assert packet.diff_stat_keys == ("docs_files_changed", "python_worker_files_changed")
    assert packet.addition_count == 15
    assert packet.deletion_count == 3
    assert packet.pge_artifact_version is None
    serialized = json.dumps(packet.__dict__, sort_keys=True)
    assert "LCSP-999" not in serialized
    assert "FORGED_CI_GREEN" not in serialized
    assert "forged-pge-version" not in serialized
    assert result["changedFileCount"] == 2
    assert result["changeCategories"] == ["python_worker", "docs"]


def test_pr_review_triage_trusted_recorder_requires_trusted_metadata_before_observer(
    tmp_path,
):
    packet_path = tmp_path / "packet.json"
    head_sha = "b" * 40
    base_sha = "c" * 40
    packet_path.write_text(
        json.dumps(
            {
                "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_PACKET_V1",
                "packet": {
                    "pr_number": 344,
                    "head_sha": head_sha,
                    "base_sha": base_sha,
                    "changed_filenames": ["deepagents/decision/shadow.py"],
                    "change_categories": ["python_worker"],
                    "jira_issue_ids": ["LCSP-336"],
                    "acceptance_criteria_ids": [],
                    "ci_state_codes": ["GITHUB_ACTIONS"],
                    "scanner_change_metadata": [],
                    "diff_stat_keys": ["python_worker_files_changed"],
                },
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "record.json"

    def fail_if_called(sink):
        raise AssertionError("missing trusted metadata must not construct observers")

    result = record_pr_review_shadow_triage_packet(
        packet_path=packet_path,
        output_path=output,
        expected_pr_number=344,
        expected_head_sha=head_sha,
        expected_base_sha=base_sha,
        require_trusted_metadata=True,
        observer_factory=fail_if_called,
    )

    assert result["recordingStatus"] == "TYPED_RESULT_NOT_RECORDED_TRUSTED_METADATA_INVALID"
    assert result["trustedMetadataError"] == "TRUSTED_COMPARE_JSON_MISSING"
    assert result["typedResultRecorded"] is False
    assert not output.with_suffix(".events.jsonl").exists()
