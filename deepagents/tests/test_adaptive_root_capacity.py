"""LCSP-364 physical quiescence, backpressure and singleton lifecycle (provider-free)."""
from concurrent.futures import Future
from threading import Event, Thread
from types import SimpleNamespace
from uuid import uuid4
import asyncio
import time

import httpx
import pytest

from tools.common.capabilities.agent_runtime import local_server, agent_server_client, rabbitmq_consumer
from tools.common.capabilities.agent_runtime.root_capacity import (
    CAPACITY_UNAVAILABLE, ROOT_COMMAND_OBSOLETE, RootCapacityUnavailable,
    RootCommandObsolete, RootCapacityClient, _docker_bytes, _cgroup_limits,
)
from orchestration.runtime_control import (
    PhysicalRunScope, active_physical_run_scope, cancellable_sync, physical_to_thread,
)
from test_agent_runtime_rabbitmq_consumer import FakeChannel


class CapacityProtocol:
    def __init__(self, admitted=True):
        self.admitted = admitted
        self.calls = []

    def call(self, action, **payload):
        self.calls.append((action, payload))
        return {"admitted": self.admitted, "evaluationSeconds": 15}


def test_image_health_api_fixture_fences_reports_and_never_admits_roots():
    from tests.integration.test_production_agent_server_image_e2e import _SnapshotApi
    api = _SnapshotApi(b"provider-free archive fixture")
    api.start()
    host, port = api._server.server_address[:2]
    url = f"http://127.0.0.1:{port}/internal/assessment-root-capacity"
    headers = {"x-worker-api-key": "test-worker-key"}
    identity = {"hostId": "a" * 64, "incarnationId": str(uuid4())}
    try:
        assert httpx.get(url + "/registration").status_code == 403
        assert httpx.get(url + "/registration", headers=headers).json()["data"]["version"] == 0
        payload = {**identity, "expectedVersion": 0, "liveRunIds": []}
        assert httpx.post(url + "/register", headers=headers, json=payload).status_code == 200
        assert httpx.post(url + "/report", headers=headers, json=payload).status_code == 409
        payload.update(expectedVersion=1, metrics={"reservedRootRuns": 0, "activeNativeRoots": 0})
        assert httpx.post(url + "/report", headers=headers, json=payload).json()["data"]["effective"] == 0
        assert httpx.post(url + "/reserve", headers=headers, json=identity).json()["data"]["admitted"] is False
    finally:
        api.stop()


def test_inherited_cgroup_limits_tighten_an_unlimited_worker_leaf(tmp_path):
    (tmp_path / "cgroup.controllers").write_text("cpu io memory")
    parent = tmp_path / "tenant"; leaf = parent / "worker"; leaf.mkdir(parents=True)
    for group, maximum, usage, quota, pressure in [
        (parent, "4000", "3000", "150000 100000", "4.0"),
        (leaf, "max", "500", "max 100000", "1.0"),
    ]:
        for file, content in {"memory.max": maximum, "memory.current": usage, "cpu.max": quota,
            "cpu.pressure": f"some avg10={pressure} avg60=0 avg300=0 total=0",
            "io.pressure": f"some avg10={pressure} avg60=0 avg300=0 total=0"}.items():
            (group / file).write_text(content)
    result = _cgroup_limits(leaf, tmp_path)
    assert result["cgroupObserved"] is True
    assert result["cgroupMemoryLimitBytes"] == 4000
    assert result["cgroupMemoryAvailableBytes"] == 1000
    assert result["cgroupCpuLimitCores"] <= 1.5
    assert result["cpuPressure"] == 0.04
    (parent / "memory.max").unlink()
    assert _cgroup_limits(leaf, tmp_path)["cgroupObserved"] is False


def test_hidden_cgroup_ancestry_is_unknown_rather_than_unlimited(tmp_path):
    (tmp_path / "cgroup.controllers").write_text("cpu io memory")
    (tmp_path / "memory.max").write_text("max")
    assert _cgroup_limits(tmp_path, tmp_path)["cgroupObserved"] is False


@pytest.mark.parametrize("action", ["register", "report"])
def test_snapshot_posts_one_comparison_version_and_does_not_retry_a_stale_handshake(monkeypatch, action):
    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://capacity.fixture")
    monkeypatch.setenv("WORKER_API_KEY", "fixture-only-key")
    calls = []
    monkeypatch.setattr(httpx, "get", lambda url, **kwargs: httpx.Response(200,
        json={"ok": True, "data": {"version": 7}}, request=httpx.Request("GET", url)))
    def post(url, **kwargs):
        calls.append(kwargs["json"])
        return httpx.Response(409, json={"ok": False}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", post)
    with pytest.raises(httpx.HTTPStatusError): RootCapacityClient().call(action, liveRunIds=[])
    assert len(calls) == 1 and calls[0]["expectedVersion"] == 7


@pytest.mark.parametrize("original_key", ["old-command", None])
def test_queued_continue_never_acknowledges_the_previous_still_draining_run(monkeypatch, original_key):
    client = SimpleNamespace(threads=SimpleNamespace(create=lambda **kwargs: None))
    monkeypatch.setattr(agent_server_client, "get_sync_client", lambda **kwargs: client)
    monkeypatch.setattr(agent_server_client, "_find_active_thread_run", lambda *args: {
        "run_id": "still-draining", "metadata": {"lcsp_root_command_key": original_key}})
    monkeypatch.setattr(agent_server_client, "_poll_run_until_terminal", lambda *args, **kwargs: pytest.fail("must not ACK the old run"))
    with pytest.raises(RootCapacityUnavailable):
        agent_server_client.dispatch_agent_runtime_event("assessment_root_requested", {
            "assessmentId": "fixture", "idempotencyKey": "new-continue-command"}, "fixture-correlation")


def payload(name="fixture"):
    return {"input": {"messages": ["provider-free fixture"]}, "context": {
        "system_boundary_name": "assessment_root_requested", "assessment_id": name,
        "system_event": {"idempotencyKey": f"root:{name}"}},
        "metadata": {"lcsp_boundary_name": "assessment_root_requested"}}


class BlockingGraph:
    def __init__(self, started, release, late):
        self.started, self.release, self.late = started, release, late

    def stream(self, *_args, **_kwargs):
        def provider():
            self.started.set()
            assert self.release.wait(5)
            return "measured fixture response"
        cancellable_sync(provider, late_result=lambda result: self.late.append(result))
        yield {"done": True}

    def get_state(self, *_args, **_kwargs):
        return SimpleNamespace(values={}, next=("pending",), created_at="fixture", metadata={})


def wait_until(predicate, seconds=3):
    deadline = time.monotonic() + seconds
    while not predicate() and time.monotonic() < deadline:
        time.sleep(0.005)
    assert predicate()


def test_stop_retains_physical_slot_and_nonterminal_transport_until_late_usage_ends(monkeypatch):
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS", "1")
    monkeypatch.setattr(local_server, "resource_measurements", lambda: {})
    protocol = CapacityProtocol()
    runtime = local_server.LocalAgentRuntime(capacity_client=protocol)
    started, release, late = Event(), Event(), []
    runtime.graph = BlockingGraph(started, release, late)
    try:
        run = runtime.create_run("transport-one", payload())
        assert started.wait(2)
        runtime.cancel_run("transport-one", run["run_id"])
        time.sleep(.08)
        assert runtime.get_run("transport-one", run["run_id"])["status"] == "running"
        assert not any(action == "quiesce" for action, _ in protocol.calls)
        with pytest.raises(RootCapacityUnavailable):
            runtime.create_run("transport-two", payload("other"))
        assert runtime._executor._work_queue.qsize() == 0
        release.set()
        runtime._run_futures[("transport-one", run["run_id"])].result(timeout=2)
        wait_until(lambda: any(action == "quiesce" for action, _ in protocol.calls))
        assert late == ["measured fixture response"]
        assert runtime.get_run("transport-one", run["run_id"])["status"] == "interrupted"
        assert len([action for action, _ in protocol.calls if action == "quiesce"]) == 1
    finally:
        release.set()
        runtime.close()


def test_global_refusal_publishes_no_run_or_future_and_restores_local_capacity(monkeypatch):
    monkeypatch.setattr(local_server, "resource_measurements", lambda: {})
    protocol = CapacityProtocol(admitted=False)
    runtime = local_server.LocalAgentRuntime(capacity_client=protocol)
    try:
        for _ in range(20):
            with pytest.raises(RootCapacityUnavailable):
                runtime.create_run("transport", payload())
        assert runtime._runs == runtime._run_futures == {}
        assert not runtime._capacity_active
        assert runtime._executor._work_queue.qsize() == 0
        assert all(action == "reserve" for action, _ in protocol.calls)
    finally:
        runtime.close()


@pytest.mark.asyncio
async def test_cancelled_accounting_callback_retains_physical_scope_until_actual_end():
    scope, started, release, drained = PhysicalRunScope(), Event(), Event(), Event()
    token = active_physical_run_scope.set(scope)
    try:
        def record():
            started.set()
            assert release.wait(3)
        task = asyncio.create_task(physical_to_thread(record))
        assert await asyncio.to_thread(started.wait, 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        waiter = Thread(target=lambda: (scope.drain(), drained.set()))
        waiter.start()
        assert not drained.wait(.05)
        release.set()
        assert await asyncio.to_thread(drained.wait, 1)
        waiter.join(1)
    finally:
        release.set()
        active_physical_run_scope.reset(token)


@pytest.mark.parametrize("status,code,expected", [
    (429, CAPACITY_UNAVAILABLE, RootCapacityUnavailable),
    (409, ROOT_COMMAND_OBSOLETE, RootCommandObsolete),
    (429, "OTHER_ERROR", httpx.HTTPStatusError),
])
def test_sdk_translates_only_the_exact_capacity_or_obsolete_signal(status, code, expected):
    def create(*_args, **_kwargs):
        response = httpx.Response(status, request=httpx.Request("POST", "http://fixture/runs"), json={"error": code})
        response.raise_for_status()
    with pytest.raises(expected):
        agent_server_client._create_bounded_run(SimpleNamespace(runs=SimpleNamespace(create=create)))


@pytest.mark.parametrize("confirmed", [True, False])
def test_capacity_refusal_uses_delivery_specific_confirmed_delay_without_spending_attempt(confirmed):
    channel = FakeChannel()
    channel.publish_result = confirmed
    future = Future()
    future.set_exception(RootCapacityUnavailable())
    rabbitmq_consumer._settle_delivery(channel=channel, delivery_tag=7, routing_key="root",
        queue_name="fixture.root", properties=SimpleNamespace(headers={rabbitmq_consumer.AGENT_RUNTIME_ATTEMPT_HEADER: 3}),
        body=b"{}", completed=future)
    assert channel.published[0]["routing_key"].endswith("retry.15000ms")
    assert channel.published[0]["properties"].headers[rabbitmq_consumer.AGENT_RUNTIME_ATTEMPT_HEADER] == 3
    assert channel.acked == ([7] if confirmed else [])
    assert channel.nacked == ([] if confirmed else [(7, True)])


def test_obsolete_duplicate_never_invokes_or_retries_a_root(monkeypatch):
    def obsolete(*_args, **_kwargs):
        raise RootCommandObsolete()
    monkeypatch.setattr(rabbitmq_consumer, "dispatch_agent_runtime_event", obsolete)
    assert rabbitmq_consumer._dispatch_delivery("assessment_root_requested", None, b'{"assessmentId":"fixture"}') is None


@pytest.mark.parametrize("value,expected", [("2GiB", 2 * 1024**3), ("1.5MB", 1500000), ("0B", 0)])
def test_reported_docker_memory_units_are_preserved(value, expected):
    assert _docker_bytes(value) == expected


def test_unrecognized_docker_memory_is_unknown_not_zero():
    with pytest.raises(ValueError):
        _docker_bytes("unavailable")


def test_second_server_cannot_enter_the_same_host_lock(monkeypatch, tmp_path):
    import sys
    monkeypatch.setenv("LCSP_AGENT_SERVER_LOCK_PATH", str(tmp_path / "runtime.lock"))
    monkeypatch.delenv("LANGGRAPH_CHECKPOINT_DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_URI", raising=False)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("LCSP_AGENT_RUNTIME_MODE", "development")
    monkeypatch.setitem(sys.modules, "agent", SimpleNamespace(create_root_agent=lambda **_kwargs: SimpleNamespace()))
    monkeypatch.setattr(local_server, "resource_measurements", lambda: {})
    first_protocol, second_protocol = CapacityProtocol(), CapacityProtocol()
    first = local_server.LocalAgentRuntime(capacity_client=first_protocol)
    second = local_server.LocalAgentRuntime(capacity_client=second_protocol)
    try:
        first.start()
        with pytest.raises(BlockingIOError):
            second.start()
        assert any(action == "register" for action, _ in first_protocol.calls)
        assert not second_protocol.calls
    finally:
        first.close()
        second.close()
