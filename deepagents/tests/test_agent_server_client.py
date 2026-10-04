from __future__ import annotations

import httpx
import pytest

from tools.common.capabilities.agent_runtime import agent_server_client


class _NullObserver:
    def __init__(self, _message):
        self.events = []

    def emit(self, **kwargs):
        self.events.append(kwargs)


class _FakeThreads:
    def __init__(self):
        self.created = []

    def create(self, **kwargs):
        self.created.append(kwargs)
        return {"thread_id": kwargs["thread_id"]}

    def get_state(self, _thread_id):
        return {"values": {"ok": True}}


class _FakeRuns:
    def __init__(self, *, listed_runs=None, timeout_first_get=False, refuse_cancel=True):
        self.listed_runs = list(listed_runs or [])
        self.timeout_first_get = timeout_first_get
        self.create_calls = 0
        self.created_context = None
        self.get_calls = 0
        self.cancel_calls = []
        self._refuse_cancel = refuse_cancel
        self._created_run_status = "running"

    def list(self, _thread_id, limit=25):
        return list(self.listed_runs)

    def create(self, _thread_id, _assistant_id, **kwargs):
        self.create_calls += 1
        self.created_context = kwargs.get("context")
        self.created_kwargs = kwargs
        return {
            "run_id": "created-run",
            "status": self._created_run_status,
            "metadata": dict(kwargs.get("metadata") or {}),
        }

    def get(self, _thread_id, run_id):
        self.get_calls += 1
        if self.timeout_first_get and self.get_calls == 1:
            raise httpx.ReadTimeout("timed out")
        return {
            "run_id": run_id,
            "status": "success",
            "metadata": {"lcsp_boundary_name": "scan_requested"},
        }

    def cancel(self, thread_id, run_id, **kwargs):
        self.cancel_calls.append({"thread_id": thread_id, "run_id": run_id, **kwargs})
        if self._refuse_cancel:
            raise AssertionError("cancel should not be called")


class _FakeClient:
    def __init__(self, runs):
        self.threads = _FakeThreads()
        self.runs = runs


def _install_client(monkeypatch, fake_client):
    monkeypatch.setattr(agent_server_client, "get_sync_client", lambda **_kwargs: fake_client)
    monkeypatch.setattr(agent_server_client.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(agent_server_client, "_ScanRunObserver", _NullObserver)
    fake_client.control_reports = []
    monkeypatch.setattr(
        agent_server_client, "report_runtime_control",
        lambda *args, **kwargs: fake_client.control_reports.append((args, kwargs)),
    )


def test_native_terminal_state_retires_the_registered_generation(monkeypatch):
    client = _FakeClient(_FakeRuns())
    _install_client(monkeypatch, client)
    agent_server_client.dispatch_agent_runtime_event(
        "assessment_interview_resume_requested", {"assessmentId": "a"}, "correlation"
    )
    args, _ = client.control_reports[0]
    assert args[1] == "created-run"
    assert args[2]["system_event"] == {"assessmentId": "a"}
    assert args[3] == "COMPLETED"


def test_checkpoint_continue_preserves_frozen_event_and_checkpoint(monkeypatch):
    runs = _FakeRuns()
    _install_client(monkeypatch, _FakeClient(runs))
    frozen = {"assessment_id": "a", "system_event": {"answer": "original"}, "repository_path": "/pinned"}
    agent_server_client.resume_agent_runtime_run("interview_context_updated", {
        "assessmentId": "a", "threadId": "original-thread", "logicalRunId": "old-run",
        "runtimeContext": frozen, "requestId": "resume-request",
        "checkpoint": {"checkpoint_id": "interrupted-checkpoint"},
    }, "resume-correlation")
    assert runs.created_kwargs["input"] is None
    assert runs.created_kwargs["checkpoint_id"] == "interrupted-checkpoint"
    assert runs.created_kwargs["multitask_strategy"] == "reject"
    assert runs.created_context["system_event"] == frozen["system_event"]
    assert runs.created_context["repository_path"] == "/pinned"
    assert runs.created_context["logical_run_id"] == "old-run"


def test_duplicate_continue_reattaches_completed_request_without_parallel_run(monkeypatch):
    runs = _FakeRuns(listed_runs=[{"run_id": "already-resumed", "status": "success", "metadata": {"lcsp_resume_request_id": "same-request"}}])
    _install_client(monkeypatch, _FakeClient(runs))
    agent_server_client.resume_agent_runtime_run("interview_context_updated", {
        "threadId": "original-thread", "requestId": "same-request", "runtimeContext": {"system_event": {"original": True}},
    }, "correlation")
    assert runs.create_calls == 0


def test_exact_stop_never_resolves_a_newer_active_run(monkeypatch):
    class Runs(_FakeRuns):
        def get(self, thread_id, run_id):
            assert (thread_id, run_id) == ("exact-thread", "old-run")
            return {"run_id": run_id, "status": "interrupted" if self.cancel_calls else "running"}
    runs = Runs(refuse_cancel=False, listed_runs=[{"run_id": "new-run", "status": "running"}])
    _install_client(monkeypatch, _FakeClient(runs))
    callbacks = []
    monkeypatch.setattr(agent_server_client, "load_config", lambda: type("Config", (), {"nestjs_api_base_url": "unused", "worker_api_key": "test"})())
    monkeypatch.setattr(agent_server_client.WorkerApiClient, "_post_with_retry", lambda self, path, payload, **kwargs: callbacks.append(payload))
    result = agent_server_client.dispatch_agent_runtime_event("assessment_interview_pause_requested", {
        "assessmentId": "a", "targetRunId": "old-run", "threadId": "exact-thread", "boundary": "interview_context_updated", "controlAction": "STOP",
    }, "correlation")
    assert result["state"] == "STOPPED"
    assert runs.cancel_calls == [{"thread_id": "exact-thread", "run_id": "old-run", "wait": False, "action": "interrupt"}]
    assert callbacks[0]["targetRunId"] == "old-run"


def test_run_poll_timeout_keeps_existing_binding(monkeypatch):
    fake_runs = _FakeRuns(timeout_first_get=True)
    fake_client = _FakeClient(fake_runs)
    _install_client(monkeypatch, fake_client)

    result = agent_server_client.dispatch_agent_runtime_event(
        "scan_requested",
        {"assessmentId": "assessment-1", "scanJobId": "scan-1"},
        "correlation-1",
        timeout_seconds=30,
    )

    assert result == {"ok": True}
    assert fake_runs.create_calls == 1
    assert fake_runs.get_calls == 2


def test_dispatch_shares_deadline_and_deducts_scheduler_setup_time(monkeypatch):
    fake_runs = _FakeRuns()
    _install_client(monkeypatch, _FakeClient(fake_runs))
    ticks = iter([100.0, 104.0])
    monkeypatch.setattr(agent_server_client.time, "monotonic", lambda: next(ticks))
    monkeypatch.setattr(agent_server_client.time, "time", lambda: 1000.0)
    seen = []
    monkeypatch.setattr(agent_server_client, "_poll_run_until_terminal", lambda *_args, **kwargs: seen.append(kwargs["timeout_seconds"]))
    agent_server_client.dispatch_agent_runtime_event("scan_requested", {}, "corr-1", timeout_seconds=30)
    assert fake_runs.created_context["system_deadline_at"] == 1030.0
    assert seen == [26.0]


def test_dispatch_without_a_boundary_deadline_never_interrupts_the_run(monkeypatch):
    monkeypatch.delenv("LCSP_AGENT_SERVER_RUN_TIMEOUT_SECONDS", raising=False)
    fake_runs = _FakeRuns()
    _install_client(monkeypatch, _FakeClient(fake_runs))
    seen = []
    monkeypatch.setattr(
        agent_server_client,
        "_poll_run_until_terminal",
        lambda *_args, **kwargs: seen.append(kwargs["timeout_seconds"]),
    )
    agent_server_client.dispatch_agent_runtime_event(
        "assessment_interview_resume_requested", {}, "corr-1", timeout_seconds=None
    )
    # No deadline reaches the worker's cancel timer or the poll loop.
    assert fake_runs.created_context["system_deadline_at"] is None
    assert seen == [None]


def test_redelivered_scan_reattaches_active_boundary_run(monkeypatch):
    fake_runs = _FakeRuns(
        listed_runs=[
            {
                "run_id": "active-run",
                "status": "running",
                "metadata": {"lcsp_boundary_name": "scan_requested"},
            }
        ]
    )
    fake_client = _FakeClient(fake_runs)
    _install_client(monkeypatch, fake_client)

    result = agent_server_client.dispatch_agent_runtime_event(
        "scan_requested",
        {"assessmentId": "assessment-1", "scanJobId": "scan-1"},
        "correlation-1",
        timeout_seconds=30,
    )

    assert result == {"ok": True}
    assert fake_runs.create_calls == 0
    assert fake_runs.get_calls == 1


def test_active_run_from_other_boundary_is_not_reused(monkeypatch):
    fake_runs = _FakeRuns(
        listed_runs=[
            {
                "run_id": "other-boundary-run",
                "status": "running",
                "metadata": {"lcsp_boundary_name": "assessment_interview_resume"},
            }
        ]
    )
    fake_client = _FakeClient(fake_runs)
    _install_client(monkeypatch, fake_client)

    result = agent_server_client.dispatch_agent_runtime_event(
        "scan_requested",
        {"assessmentId": "assessment-1", "scanJobId": "scan-1"},
        "correlation-1",
        timeout_seconds=30,
    )

    assert result == {"ok": True}
    assert fake_runs.create_calls == 1
    assert fake_runs.get_calls == 1


def test_interrupt_cancels_the_active_run_for_this_boundary(monkeypatch):
    fake_runs = _FakeRuns(
        listed_runs=[
            {
                "run_id": "active-run",
                "status": "running",
                "metadata": {"lcsp_boundary_name": "assessment_interview_resume_requested"},
            }
        ],
        refuse_cancel=False,
    )
    fake_client = _FakeClient(fake_runs)
    _install_client(monkeypatch, fake_client)

    agent_server_client.interrupt_agent_runtime_run(
        "assessment_interview_resume_requested",
        {"assessmentId": "assessment-1", "workflowRunId": "workflow-1"},
        "correlation-1",
    )

    assert fake_runs.cancel_calls == [
        {
            "thread_id": agent_server_client.agent_thread_id(
                "assessment_interview_resume_requested",
                {"assessmentId": "assessment-1", "workflowRunId": "workflow-1"},
                "correlation-1",
            ),
            "run_id": "active-run",
            "wait": False,
            "action": "interrupt",
        }
    ]


def test_interrupt_is_a_noop_when_no_active_run_exists(monkeypatch):
    fake_runs = _FakeRuns(listed_runs=[], refuse_cancel=False)
    fake_client = _FakeClient(fake_runs)
    _install_client(monkeypatch, fake_client)

    agent_server_client.interrupt_agent_runtime_run(
        "assessment_interview_resume_requested",
        {"assessmentId": "assessment-1", "workflowRunId": "workflow-1"},
        "correlation-1",
    )

    assert fake_runs.cancel_calls == []


def test_interrupt_ignores_an_active_run_from_a_different_boundary(monkeypatch):
    fake_runs = _FakeRuns(
        listed_runs=[
            {
                "run_id": "other-boundary-run",
                "status": "running",
                "metadata": {"lcsp_boundary_name": "scan_requested"},
            }
        ],
        refuse_cancel=False,
    )
    fake_client = _FakeClient(fake_runs)
    _install_client(monkeypatch, fake_client)

    agent_server_client.interrupt_agent_runtime_run(
        "assessment_interview_resume_requested",
        {"assessmentId": "assessment-1", "workflowRunId": "workflow-1"},
        "correlation-1",
    )

    assert fake_runs.cancel_calls == []


def test_resume_creates_a_run_with_no_new_input_and_polls_to_terminal(monkeypatch):
    fake_runs = _FakeRuns()
    fake_client = _FakeClient(fake_runs)
    _install_client(monkeypatch, fake_client)
    captured_create_kwargs = {}
    original_create = fake_runs.create

    def capturing_create(thread_id, assistant_id, **kwargs):
        captured_create_kwargs.update(kwargs)
        return original_create(thread_id, assistant_id, **kwargs)

    fake_runs.create = capturing_create

    result = agent_server_client.resume_agent_runtime_run(
        "assessment_interview_resume_requested",
        {"assessmentId": "assessment-1", "workflowRunId": "workflow-1"},
        "correlation-1",
        timeout_seconds=30,
    )

    assert result == {"ok": True}
    assert fake_runs.create_calls == 1
    assert captured_create_kwargs["input"] is None
    assert captured_create_kwargs["multitask_strategy"] == "enqueue"


def test_dispatch_short_circuits_pause_command_without_creating_a_run(monkeypatch):
    """A pause command must never create its own Agent Server run: with
    multitask_strategy="enqueue" that run would just queue behind the turn it
    is meant to interrupt instead of stopping it."""
    fake_runs = _FakeRuns(
        listed_runs=[
            {
                "run_id": "active-turn-run",
                "status": "running",
                "metadata": {
                    "lcsp_boundary_name": "assessment_interview_resume_requested"
                },
            }
        ],
        refuse_cancel=False,
    )
    fake_client = _FakeClient(fake_runs)
    _install_client(monkeypatch, fake_client)

    result = agent_server_client.dispatch_agent_runtime_event(
        "assessment_interview_pause_requested",
        {"assessmentId": "assessment-1", "workflowRunId": "workflow-1"},
        "correlation-1",
    )

    assert result == {"status": "interrupt_requested"}
    assert fake_runs.create_calls == 0
    assert fake_runs.cancel_calls == [
        {
            "thread_id": agent_server_client.agent_thread_id(
                "assessment_interview_resume_requested",
                {"assessmentId": "assessment-1", "workflowRunId": "workflow-1"},
                "correlation-1",
            ),
            "run_id": "active-turn-run",
            "wait": False,
            "action": "interrupt",
        }
    ]


def test_customer_stop_interrupts_a_running_engineering_assessment(monkeypatch) -> None:
    active = {
        "run_id": "engineering-run",
        "status": "running",
        "metadata": {"lcsp_boundary_name": "engineering_assessment_requested"},
    }
    fake_runs = _FakeRuns(listed_runs=[active], refuse_cancel=False)
    _install_client(monkeypatch, _FakeClient(fake_runs))

    result = agent_server_client.dispatch_agent_runtime_event(
        "assessment_interview_pause_requested",
        {"assessmentId": "assessment-1"},
        "corr-stop",
    )

    assert result == {"status": "interrupt_requested"}
    # The Investigator's run is interrupted (checkpoints kept), not deleted.
    assert [(c["run_id"], c["action"]) for c in fake_runs.cancel_calls] == [
        ("engineering-run", "interrupt")
    ]


def test_an_interrupted_run_settles_without_error_so_it_is_not_retried(monkeypatch) -> None:
    class _InterruptedRuns(_FakeRuns):
        def get(self, _thread_id, run_id):
            self.get_calls += 1
            return {"run_id": run_id, "status": "interrupted", "metadata": {}}

    fake_runs = _InterruptedRuns()
    _install_client(monkeypatch, _FakeClient(fake_runs))

    result = agent_server_client.dispatch_agent_runtime_event(
        "engineering_assessment_requested",
        {"assessmentId": "assessment-1", "scanJobId": "scan-1"},
        "corr-1",
    )

    # A customer stop is not a failure: no exception, so the broker delivery is
    # acked and the stopped Investigator does not restart until Continue.
    assert result == {"status": "INTERRUPTED", "runId": "created-run"}
