"""Provider-free native pilot restrictions; synthetic inputs here never prove production capacity."""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
import hashlib
import json
import threading
import time
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from assessment_root.execution_policy import NativeRootExecutionPolicy, activate_root_execution_policy, root_runner_options
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from orchestration.agent_stream import active_agent_stream_cancel
from orchestration.runtime_control import (
    PhysicalRunScope, active_physical_run_scope, active_runtime_incarnation_id, active_runtime_run_id,
)
from scripts import run_t31_scoped_pilot as pilot
from scripts import t31_native_runtime as native

ASSESSMENT, AUDIT = str(uuid4()), str(uuid4())
COMMAND = {"assessmentId": ASSESSMENT, "auditRequestId": AUDIT, "idempotencyKey": "rule-audit:" + AUDIT + ":start"}


@pytest.fixture(autouse=True)
def prohibit_network(monkeypatch):
    def blocked(*_args, **_kwargs):
        pytest.fail("Native pilot tests cannot use real HTTP or provider transport")
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", blocked)


def policy():
    return NativeRootExecutionPolicy(ASSESSMENT, AUDIT, COMMAND["idempotencyKey"],
                                     lambda client, claim, context: (client, claim, context),
                                     tuple(MODEL_GOVERNANCE_MIDDLEWARE))


@contextmanager
def physical(run="native-run", incarnation="native-incarnation", scope=None):
    values = [(active_runtime_run_id, run), (active_runtime_incarnation_id, incarnation),
              (active_physical_run_scope, scope)]
    tokens = [(variable, variable.set(value)) for variable, value in values]
    try:
        yield
    finally:
        for variable, token in reversed(tokens):
            variable.reset(token)


def test_no_policy_preserves_production_defaults_even_for_request_policy_fields():
    assert root_runner_options({**COMMAND, "executionPolicy": {"backend_factory": "external"}}, object()) == {}
    with pytest.raises(TypeError):
        with activate_root_execution_policy({"assessment_id": ASSESSMENT}):
            pytest.fail("HTTP-shaped data must never install a trusted policy")


@pytest.mark.parametrize("field", ["assessmentId", "auditRequestId", "idempotencyKey"])
def test_policy_rejects_mismatched_command_before_runner_arguments(field):
    with activate_root_execution_policy(policy()), physical(scope=PhysicalRunScope()):
        with pytest.raises(ValueError, match="command mismatch"):
            root_runner_options({**COMMAND, field: "different"}, object())


@pytest.mark.parametrize("run,incarnation,scope", [
    (None, "incarnation", PhysicalRunScope()), ("run", None, PhysicalRunScope()),
    ("run", "incarnation", None), ("run", "incarnation", object()),
])
def test_policy_requires_all_native_physical_bindings(run, incarnation, scope):
    with activate_root_execution_policy(policy()), physical(run, incarnation, scope):
        with pytest.raises(RuntimeError, match="physical execution"):
            root_runner_options(COMMAND, object())


def test_policy_retains_every_governance_object_in_order_and_binds_actual_client():
    current = policy()
    for downgraded in (current.governance[:-1], tuple(reversed(current.governance))):
        with activate_root_execution_policy(replace(current, governance=downgraded)), physical(scope=PhysicalRunScope()):
            with pytest.raises(ValueError, match="governance"):
                root_runner_options(COMMAND, object())
    client, claim, context = object(), {}, {}
    with activate_root_execution_policy(current), physical(scope=PhysicalRunScope()):
        options = root_runner_options(COMMAND, client)
        assert options["backend_factory"](claim, context) == (client, claim, context)
        assert all(a is b for a, b in zip(options["governance"], current.governance))
    assert root_runner_options(COMMAND, client) == {}


def unstarted_runtime():
    runtime = native.T31NativeRuntime.__new__(native.T31NativeRuntime)
    runtime.manifest = {"assessmentId": ASSESSMENT}
    runtime.command = deepcopy(COMMAND)
    runtime.thread_id = "transport-thread"
    runtime.policy = policy()
    return runtime


def request():
    return {"input": {"messages": [{"role": "user", "content": "trusted event"}]},
            "context": {"assessment_id": ASSESSMENT, "system_boundary_name": native.ROOT_BOUNDARY,
                        "system_event": deepcopy(COMMAND)}}


@pytest.mark.parametrize("change", ["thread", "assessment", "audit", "boundary", "input", "extra-event"])
def test_native_server_rejects_changed_transport_before_base_admission(monkeypatch, change):
    runtime, payload, thread_id = unstarted_runtime(), request(), "transport-thread"
    if change == "thread":
        thread_id = "wrong-thread"
    elif change == "assessment":
        payload["context"]["assessment_id"] = "wrong"
    elif change == "audit":
        payload["context"]["system_event"]["auditRequestId"] = "wrong"
    elif change == "boundary":
        payload["context"]["system_boundary_name"] = "other"
    elif change == "input":
        payload["input"] = None
    else:
        payload["context"]["system_event"]["policy"] = "external"
    monkeypatch.setattr(native.local_server.LocalAgentRuntime, "create_run",
                        lambda *_args: pytest.fail("mismatched request reached native reservation"))
    with pytest.raises(PermissionError):
        runtime.create_run(thread_id, payload)


def test_valid_command_delegates_to_the_existing_native_admission(monkeypatch):
    runtime, payload, observed = unstarted_runtime(), request(), []
    def existing(self, thread_id, received):
        observed.append((self, thread_id, received))
        return {"run_id": "native-issued-id", "status": "pending"}
    monkeypatch.setattr(native.local_server.LocalAgentRuntime, "create_run", existing)
    assert runtime.create_run(runtime.thread_id, payload)["run_id"] == "native-issued-id"
    assert observed == [(runtime, runtime.thread_id, payload)]


def test_real_native_execution_hook_binds_policy_and_waits_for_physical_drain():
    # Exercise the unchanged production _execute_owned_run, with only its graph
    # and persistence surfaces replaced by provider-free in-memory fixtures.
    runtime, payload = unstarted_runtime(), request()
    runtime._lock = threading.RLock()
    runtime._capacity = SimpleNamespace(identity={"incarnationId": "native-incarnation"})
    runtime._cancel_events = {(runtime.thread_id, "native-run"): threading.Event()}
    runtime._executing_root_runs = set()
    statuses, observed, errors = [], [], []
    graph_returned, release_child = threading.Event(), threading.Event()
    child_threads = []
    runtime._set_run_status = lambda _thread, _run, state: statuses.append(state)
    runtime._update_thread_error = lambda _thread, exc: errors.append(exc)
    runtime._set_thread_status = lambda *_args: None
    def graph(_thread, _payload, **_kwargs):
        observed.append(root_runner_options(COMMAND, "actual-boundary-client"))
        scope = active_physical_run_scope.get()
        assert isinstance(scope, PhysicalRunScope)
        assert active_runtime_run_id.get() == "native-run"
        assert active_runtime_incarnation_id.get() == "native-incarnation"
        scope.retain()
        def late_child():
            release_child.wait(3)
            scope.release()
        child = threading.Thread(target=late_child)
        child.start()
        child_threads.append(child)
        graph_returned.set()
        return {}, False
    runtime._run_graph = graph
    worker = threading.Thread(target=runtime._execute_owned_run,
                              args=(runtime.thread_id, "native-run", payload))
    worker.start()
    try:
        assert graph_returned.wait(3)
        assert statuses == ["running"]
        assert worker.is_alive(), "terminal native status cannot precede physical child cleanup"
    finally:
        release_child.set()
        worker.join(3)
        for child in child_threads:
            child.join(3)
    assert not worker.is_alive() and not errors
    assert statuses == ["running", "success"]
    assert observed[0]["backend_factory"]({}, {})[0] == "actual-boundary-client"
    assert not runtime._executing_root_runs
    assert root_runner_options(COMMAND, object()) == {}


def test_unsupported_host_cannot_manufacture_telemetry(monkeypatch):
    monkeypatch.setattr(native.sys, "platform", "darwin")
    monkeypatch.setattr(native, "resource_measurements", lambda: pytest.fail("unsupported host cannot claim measurements"))
    assert native.native_host_prerequisites()["supported"] is False


@pytest.mark.parametrize("effective,age,expected", [(None, 0, False), (0, 0, False), (1, 31, False), (1, 0, True)])
def test_readiness_requires_a_recent_actual_positive_controller_response(effective, age, expected):
    observer = native.ObservedRootCapacityClient.__new__(native.ObservedRootCapacityClient)
    observer._observed_lock = threading.Lock()
    observer.identity = {"incarnationId": "fixture-incarnation"}
    observer.last_report = {"effective": effective}
    observer.last_report_at = time.monotonic() - age
    result = observer.readiness()
    assert result["ready"] is expected
    assert result["reservationStillRequired"] is True


def manifest():
    rows = [{"assessmentRuleId": f"rule-{index:03}", "assessmentRuleVersion": "v1"} for index in range(243)]
    pairs = pilot.canonical_audit_membership(rows)
    return {
        "manifestVersion": "T31_SCOPED_PILOT_RUNTIME_V2",
        "apiBase": "http://127.0.0.1:3101", "agentBase": "http://127.0.0.1:3102",
        "checkpointDatabaseUrl": "postgresql://fixture@127.0.0.1:55491/lcsp_assessment_t31_fixture",
        "repositoryFullName": pilot.REPOSITORY, "repositoryCommit": pilot.COMMIT,
        "sourcePathPrefix": pilot.SOURCE_PREFIX, "ruleSetVersionId": pilot.BASELINE,
        "ruleSetDigest": pilot.BASELINE_DIGEST, "auditScopeMode": "FULL_RULE_SET", "auditRequestRevision": 1,
        "assessmentId": ASSESSMENT, "repositorySnapshotId": str(uuid4()), "repositoryScanJobId": str(uuid4()),
        "auditRequestId": AUDIT, "auditRules": rows,
        "auditMembershipSha256": hashlib.sha256(json.dumps(pairs, separators=(",", ":")).encode()).hexdigest(),
        "rootCommandId": "persisted-outbox-id", "rootCommandKey": COMMAND["idempotencyKey"],
        "rootCommandPayload": deepcopy(COMMAND), "workerKey": "fixture-only", "customerSessionToken": "fixture-only",
    }


@pytest.mark.parametrize("field,value", [
    ("manifestVersion", "T31_SCOPED_PILOT_RUNTIME_V1"), ("auditScopeMode", "SELECTED_RULES"),
    ("assessmentId", pilot.HISTORICAL_ASSESSMENT), ("agentBase", "http://external.invalid:3102"),
    ("agentBase", "http://127.0.0.1:3101"), ("auditMembershipSha256", "changed"),
    ("rootCommandKey", "other"), ("ruleSetDigest", "changed"), ("customerSessionToken", ""),
])
def test_fresh_native_manifest_rejects_old_or_changed_bindings(field, value):
    value_map = manifest()
    pilot.validate_prepared_runtime(value_map)
    value_map[field] = value
    with pytest.raises((ValueError, TypeError)):
        pilot.validate_prepared_runtime(value_map)


def context_for(value_map):
    return {key: value_map[key] for key in (
        "assessmentId", "repositorySnapshotId", "repositoryScanJobId", "repositoryCommit",
        "sourcePathPrefix", "ruleSetVersionId",
    )} | {
        "auditRequest": {"requestId": AUDIT, "scopeMode": "FULL_RULE_SET",
                         "selectedRuleIds": [row["assessmentRuleId"] for row in value_map["auditRules"]]},
        "coverage": [{**row, "currentDecisionId": None} for row in value_map["auditRules"]],
        "threadId": "canonical-assessment-thread", "caseRevision": 0, "facts": [], "evidence": [], "openHumanRequestIds": [], "humanRequests": [],
    }


@pytest.mark.parametrize("change", ["source", "audit", "member", "version", "fact", "decision", "resume"])
def test_authoritative_checks_block_drift_before_hydration_or_budget(change):
    value_map = manifest()
    context = context_for(value_map)
    claim = {"assessmentId": ASSESSMENT, "threadId": context["threadId"], "checkpointThreadId": AUDIT,
             "executionId": str(uuid4()), "resumeCheckpointId": None, "recoveredExecution": False,
             "humanAnswerReviewRequired": False}
    assert "auditRequestId" not in claim  # Actual server claim schema uses checkpointThreadId.
    pilot.validate_authoritative_context(value_map, claim, context)
    if change == "source":
        context["sourcePathPrefix"] = "outside"
    elif change == "audit":
        context["auditRequest"]["requestId"] = str(uuid4())
    elif change == "member":
        context["auditRequest"]["selectedRuleIds"].pop()
    elif change == "version":
        context["coverage"][0]["assessmentRuleVersion"] = "v2"
    elif change == "fact":
        context["facts"] = [{"factId": "inherited"}]
    elif change == "decision":
        context["coverage"][0]["currentDecisionId"] = "inherited"
    else:
        claim["resumeCheckpointId"] = "old"
    with pytest.raises(ValueError):
        pilot.validate_authoritative_context(value_map, claim, context)


def test_worker_preparation_expiry_cancels_native_run_and_never_continues():
    cancel, errors, continued = threading.Event(), [], []
    def work():
        token = active_agent_stream_cancel.set(cancel)
        try:
            with pilot.preparation_deadline(0.01):
                assert cancel.wait(1)
            continued.append(True)
        except Exception as error:
            errors.append(error)
        finally:
            active_agent_stream_cancel.reset(token)
    thread = threading.Thread(target=work)
    thread.start()
    thread.join(2)
    assert not thread.is_alive() and not continued
    assert len(errors) == 1 and isinstance(errors[0], TimeoutError)


def test_private_create_only_receipt_preserves_existing_attempt_and_rejects_symlink(tmp_path):
    path = tmp_path / "native-dispatch.json"
    pilot.private_json(path, {"attempt": "first"}, create_only=True)
    with pytest.raises(FileExistsError):
        pilot.private_json(path, {"attempt": "second"}, create_only=True)
    assert json.loads(path.read_text()) == {"attempt": "first"}
    linked = tmp_path / "linked.json"
    linked.symlink_to(path)
    with pytest.raises(OSError):
        pilot.private_json(linked, {"attempt": "substituted"})
    assert json.loads(path.read_text()) == {"attempt": "first"}


def test_local_quiesce_cleanup_cannot_invent_an_api_acknowledgement(monkeypatch):
    observer = native.ObservedRootCapacityClient.__new__(native.ObservedRootCapacityClient)
    observer._observed_lock = threading.Lock()
    observer._quiesce_receipts = {}
    def failed(*_args, **_kwargs):
        raise RuntimeError("fixture lost API acknowledgement")
    monkeypatch.setattr(native.RootCapacityClient, "call", failed)
    with pytest.raises(RuntimeError):
        observer.call("quiesce", runId="native-run")
    assert observer.quiesce_receipt("native-run") is None
    monkeypatch.setattr(native.RootCapacityClient, "call", lambda *_args, **_kwargs: {"count": 1})
    observer.call("quiesce", runId="native-run")
    assert observer.quiesce_receipt("native-run") == {"count": 1}
    assert observer.quiesce_receipt("another-run") is None
