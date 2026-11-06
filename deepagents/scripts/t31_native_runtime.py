"""Native transport for the isolated T31 pilot; never a synthetic capacity fixture."""
from __future__ import annotations

from contextlib import contextmanager, asynccontextmanager
import hmac
import json
import os
from pathlib import Path
import socket
import stat
import sys
import threading
import time
from typing import Any, Mapping
from urllib.parse import urlsplit

import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse

from assessment_root.execution_policy import (
    NativeRootExecutionPolicy, activate_root_execution_policy,
)
from tools.common.capabilities.agent_runtime import local_server
from tools.common.capabilities.agent_runtime.agent_server_client import (
    agent_thread_id,
)
from tools.common.capabilities.agent_runtime.root_capacity import (
    ROOT_BOUNDARY, RootCapacityClient, resource_measurements,
)


def native_host_prerequisites() -> dict[str, Any]:
    """Business purpose: Reject unsupported hosts without inventing native capacity.

    Business rules:
    - Only the actual Linux host identity, cgroup v2 and Docker measurements are eligible.
    - This check reports prerequisites only; API registration and reservation remain authoritative.
    Execution flow:
    1. Validate the real machine identity and supported kernel surfaces.
    2. Collect bounded read-only resource observations and list unavailable fields.
    Failure cases:
    - Unsupported platforms and unknown core observations remain blocked.
    Side effects:
    - Reads kernel files and Docker statistics; performs no provider or API mutation.
    """
    if sys.platform != "linux":
        return {"supported": False, "reason": "SUPPORTED_LINUX_NATIVE_HOST_REQUIRED"}
    try:
        identity = Path("/etc/machine-id").read_bytes().strip().lower()
    except OSError:
        identity = b""
    if (len(identity) != 32 or identity == b"0" * 32
            or any(value not in b"0123456789abcdef" for value in identity)):
        return {"supported": False, "reason": "NATIVE_HOST_IDENTITY_REQUIRED"}
    measured = resource_measurements()
    required = (
        "cpuPressure", "memoryAvailableBytes", "cgroupMemoryAvailableBytes",
        "cgroupMemoryLimitBytes", "cgroupCpuLimitCores", "processRssBytes",
        "diskAvailableBytes", "diskPressure", "activeSandboxes", "sandboxMemoryBytes",
        "sandboxCpuCores", "sandboxSamples",
    )
    missing = [name for name in required if measured.get(name) is None]
    if measured.get("cgroupObserved") is not True:
        missing.append("cgroupObserved")
    return {"supported": not missing, "reason": "OBSERVED" if not missing else "NATIVE_RESOURCE_MEASUREMENT_REQUIRED",
            "missingMeasurements": missing, "syntheticMeasurements": False}


class ObservedRootCapacityClient(RootCapacityClient):
    """Record actual authoritative responses without changing the admission protocol."""

    def __init__(self) -> None:
        """Business purpose: Observe real capacity without replacing its protocol.
        Business rules:
        - The production constructor owns genuine host/incarnation identity.
        Execution flow:
        1. Initialize the native client and an empty synchronized observation.
        Failure cases:
        - Invalid native identity propagates before registration.
        Side effects:
        - Reads native identity and allocates process-local receipt state.
        """
        super().__init__()
        self._observed_lock = threading.Lock()
        self.last_report: dict[str, Any] | None = None
        self.last_report_at: float | None = None
        self._quiesce_receipts: dict[str, dict[str, Any]] = {}

    def call(self, action: str, **payload) -> dict[str, Any]:
        """Business purpose: Preserve the native admission protocol and retain its readiness receipt.

        Business rules:
        - Registration, metrics, identities and reservations are sent unchanged to the real API.
        - Only a successful report updates the observed capacity; errors never synthesize a ceiling.
        Execution flow:
        1. Delegate to the production authenticated capacity client.
        2. Retain the successful report response and local observation time.
        Failure cases:
        - Every API or identity failure propagates with production semantics.
        Side effects:
        - Performs the normal API operation and stores non-sensitive receipt metadata in memory.
        """
        result = super().call(action, **payload)
        if action == "report":
            with self._observed_lock:
                self.last_report = dict(result)
                self.last_report_at = time.monotonic()
        elif action == "quiesce" and type(result.get("count")) is int and result["count"] in {0, 1}:
            with self._observed_lock:
                self._quiesce_receipts[payload["runId"]] = dict(result)
        return result

    def quiesce_receipt(self, run_id: str) -> dict[str, Any] | None:
        """Business purpose: Distinguish API-confirmed quiescence from local tracking cleanup.
        Business rules:
        - Local set removal is not evidence that the API released its physical reservation.
        Execution flow:
        1. Read only the successful authenticated response for this exact native run.
        Failure cases:
        - Missing or failed API acknowledgement returns unknown, even after physical drain.
        Side effects:
        - Read-only synchronized receipt projection; never retries or releases a slot.
        """
        with self._observed_lock:
            receipt = self._quiesce_receipts.get(run_id)
            return None if receipt is None else dict(receipt)

    def readiness(self) -> dict[str, Any]:
        """Business purpose: Describe the last genuine controller observation before dispatch.

        Business rules:
        - A positive observation is preliminary; the next create_run still must reserve atomically.
        - Missing or older-than30-second observations cannot advertise readiness.
        Execution flow:
        1. Read the recorded response under its lock and compute age.
        2. Return capacity, freshness and exact server incarnation metadata.
        Failure cases:
        - Missing, stale or zero effective capacity returns ready:false.
        Side effects:
        - Read-only memory projection; creates no reservation or physical identity.
        """
        with self._observed_lock:
            report = dict(self.last_report or {})
            age = None if self.last_report_at is None else time.monotonic() - self.last_report_at
        ready = age is not None and 0 <= age <= 30 and type(report.get("effective")) is int and report["effective"] > 0
        return {"ready": ready, "reportAgeSeconds": age, "controller": report,
                "incarnationId": self.identity["incarnationId"], "reservationStillRequired": True}


class T31NativeRuntime(local_server.LocalAgentRuntime):
    """The production native runtime restricted to one frozen operator-owned audit command."""

    def __init__(self, manifest: Mapping[str, Any], policy: NativeRootExecutionPolicy) -> None:
        """Business purpose: Restrict the existing native runtime to one prepared audit.
        Business rules:
        - The command is copied from private persisted preparation, never selected by HTTP.
        Execution flow:
        1. Bind its production transport thread and genuine capacity client.
        Failure cases:
        - Malformed private bindings or unsupported identity prevents construction.
        Side effects:
        - Allocates the standard runtime executor; performs no registration or paid work.
        """
        self.manifest = dict(manifest)
        self.policy = policy
        self.command = json.loads(json.dumps(manifest["rootCommandPayload"]))
        self.correlation_id = str(self.command.get("correlationId") or manifest["rootCommandId"])
        self.thread_id = agent_thread_id(ROOT_BOUNDARY, self.command, self.correlation_id)
        super().__init__(capacity_client=ObservedRootCapacityClient())

    def _validate_request(self, thread_id: str, payload: Mapping[str, Any]) -> None:
        """Business purpose: Limit this private native server to its prepared canonical pilot command.

        Business rules:
        - HTTP data cannot install policies, change audit membership or invoke another boundary.
        - The production transport thread and complete persisted event must match exactly.
        Execution flow:
        1. Compare the submitted thread, boundary, assessment and event against the private manifest.
        2. Reject a substituted command before production create_run can reserve or schedule it.
        Failure cases:
        - Any altered or missing binding returns an authorization failure.
        Side effects:
        - Pure validation; changes no API state or runtime slot.
        """
        context = payload.get("context") or {}
        if (thread_id != self.thread_id or not isinstance(context, Mapping)
                or context.get("assessment_id") != self.manifest["assessmentId"]
                or context.get("system_boundary_name") != ROOT_BOUNDARY
                or context.get("system_event") != self.command
                or payload.get("input") is None):
            raise PermissionError("The private pilot server accepts only its frozen native command")

    def create_run(self, thread_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Business purpose: Submit the exact pilot through unchanged native physical admission.

        Business rules:
        - One pilot command is eligible; no direct Root fallback or fabricated telemetry is available.
        Execution flow:
        1. Verify the command against the private preparation manifest.
        2. Delegate reservation, durable publication and scheduling to LocalAgentRuntime.
        Failure cases:
        - Identity, capacity and persistence failures retain production refusal semantics.
        Side effects:
        - May reserve and submit one native physical run through the production protocol.
        """
        self._validate_request(thread_id, payload)
        return super().create_run(thread_id, payload)

    def _execute_owned_run(self, thread_id: str, run_id: str, payload: Mapping[str, Any]) -> None:
        """Business purpose: Apply additional frozen governance inside the admitted native execution.

        Business rules:
        - The production runtime creates native identity and PhysicalRunScope before the boundary uses this policy.
        - Existing graph, checkpoint, cancellation and drain behavior is preserved.
        Execution flow:
        1. Recheck the persisted command and install its process-local policy.
        2. Execute the unchanged native graph through terminal physical drain and restore context.
        Failure cases:
        - Wrong durable bindings fail without a Root invocation; native failures keep normal settlement.
        Side effects:
        - Executes only already admitted native work and temporarily binds trusted policy context.
        """
        self._validate_request(thread_id, payload)
        with activate_root_execution_policy(self.policy):
            super()._execute_owned_run(thread_id, run_id, payload)


@contextmanager
def owned_native_server(manifest: Mapping[str, Any], policy: NativeRootExecutionPolicy):
    """Business purpose: Host one isolated native pilot server with real persistence and capacity.

    Business rules:
    - Startup requires the supported Linux host and a private loopback endpoint.
    - Production mode, a private exclusive process lock and one worker are mandatory.
    - No stored pilot execution is automatically cleared or replaced.
    Execution flow:
    1. Validate host/endpoint, bind the owned socket and build the production HTTP route set.
    2. Start the native lifespan, verify its authenticated health endpoint and expose the runtime.
    3. Shut down this owned server only after its native physical futures drain.
    Failure cases:
    - Unsupported hosts, occupied ports, lock/persistence failures or readiness timeouts reject startup.
    Side effects:
    - Opens this isolated server, registers genuine capacity and opens its existing checkpoint/store database.
    """
    host = native_host_prerequisites()
    if not host["supported"]:
        raise RuntimeError(host["reason"])
    endpoint = urlsplit(manifest["agentBase"])
    if (endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1"
            or not endpoint.port or endpoint.port < 1024 or endpoint.username or endpoint.password
            or endpoint.path not in {"", "/"} or endpoint.query or endpoint.fragment):
        raise ValueError("Private loopback native endpoint required")
    if (os.getenv("LCSP_AGENT_RUNTIME_MODE") != "production"
            or os.getenv("LCSP_AGENT_RUNTIME_JOBS_PER_WORKER") != "1"
            or os.getenv("LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS") != "1"):
        raise ValueError("pilot requires production native mode and one worker")
    lock_path = Path(os.environ.get("LCSP_AGENT_SERVER_LOCK_PATH", ""))
    if not lock_path.is_absolute() or lock_path.parent.stat().st_mode & 0o077:
        raise ValueError("pilot requires an owner-only native lock directory")
    descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        metadata = os.fstat(descriptor)
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077
                or metadata.st_uid != os.geteuid() or metadata.st_nlink != 1):
            raise ValueError("pilot requires a private regular native lock")
    finally:
        os.close(descriptor)
    runtime = T31NativeRuntime(manifest, policy)

    @asynccontextmanager
    async def lifespan(app):
        """Business purpose: Start and close the single owned production native runtime.

        Business rules:
        - Durable startup and shutdown use LocalAgentRuntime without alternate admission paths.
        Execution flow:
        1. Start the native runtime and publish it to the private HTTP application.
        2. Close it after all request handling ends.
        Failure cases:
        - Startup and close failures remain visible to the operator.
        Side effects:
        - Opens/closes native stores, reporting and owned executor resources.
        """
        try:
            runtime.start()
            app.state.runtime = runtime
            yield
        finally:
            runtime.close()

    async def authenticated(request, call_next):
        """Business purpose: Keep the loopback pilot HTTP surface private to its prepared worker.

        Business rules:
        - All native endpoints require the private worker key; key contents are never logged.
        Execution flow:
        1. Compare the supplied worker header in constant time.
        2. Forward authenticated requests to unchanged production routes.
        Failure cases:
        - Missing or incorrect credentials return403 before runtime access.
        Side effects:
        - Pure authentication gate around the owned server request.
        """
        if not hmac.compare_digest(request.headers.get("x-worker-api-key", ""), manifest["workerKey"]):
            return JSONResponse({"ok": False}, status_code=403)
        return await call_next(request)

    # The production SDK does not attach worker auth to its ordinary routes. A
    # loopback-only operator client below uses the same create/poll/cancel protocol
    # with explicit auth instead of modifying global SDK defaults.
    app = Starlette(lifespan=lifespan, routes=list(local_server.app.routes))
    app.middleware("http")(authenticated)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    thread = None
    try:
        sock.bind(("127.0.0.1", endpoint.port))
        sock.listen(128)
        server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False,
                                              host="127.0.0.1", port=endpoint.port))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, name="t31-native-server")
        thread.start()
        try:
            deadline = time.monotonic() + 60
            while not server.started:
                if not thread.is_alive() or time.monotonic() >= deadline:
                    raise RuntimeError("NATIVE_PILOT_SERVER_STARTUP_FAILED")
                threading.Event().wait(0.05)
            yield runtime
        finally:
            server.should_exit = True
            thread.join()
    finally:
        sock.close()
        if thread is None:
            runtime._executor.shutdown(wait=True, cancel_futures=False)


def dispatch_owned_native(runtime: T31NativeRuntime, manifest: Mapping[str, Any], *, timeout_seconds: float) -> dict[str, Any]:
    """Business purpose: Create, poll and cancel the canonical pilot through the native HTTP surface.

    Business rules:
    - The request uses the production dispatcher protocol with private authenticated HTTP routes.
    - Authentication is confined to this owned client; timeout cancellation retains physical drain.
    Execution flow:
    1. Build the same frozen context, transport thread and metadata as the production dispatcher.
    2. Create asynchronously and poll its exact native ID, cancelling cooperatively on deadline.
    3. Return a terminal transport receipt after the server has physically drained.
    Failure cases:
    - Capacity, request, HTTP and terminal errors propagate; there is no direct Root retry.
    Side effects:
    - Performs authenticated native HTTP operations for the prepared assessment only.
    """
    from langgraph_sdk import get_sync_client

    client = get_sync_client(url=manifest["agentBase"], headers={"x-worker-api-key": manifest["workerKey"]}, timeout=30)
    command = dict(runtime.command)
    context = {
        "assessment_id": manifest["assessmentId"], "thread_id": runtime.thread_id,
        "correlation_id": runtime.correlation_id, "system_boundary_name": ROOT_BOUNDARY,
        "system_deadline_at": time.time() + timeout_seconds, "system_event": command,
        "repository_path": "/", "response_language": "en",
    }
    client.threads.create(thread_id=runtime.thread_id, if_exists="do_nothing",
                          metadata={"assessment_id": manifest["assessmentId"], "lcsp_boundary_name": ROOT_BOUNDARY})
    run = client.runs.create(
        runtime.thread_id, "lcsp-agent",
        input={"messages": [{"role": "user", "content":
            "A trusted LCSP system event is present in runtime context. Root middleware dispatches it before model invocation."}]},
        context=context, config={"recursion_limit": 1000},
        metadata={"lcsp_boundary_name": ROOT_BOUNDARY, "assessment_id": manifest["assessmentId"],
                  "lcsp_root_command_key": manifest["rootCommandKey"], "correlation_id": runtime.correlation_id},
        multitask_strategy="reject", stream_mode=["values"],
    )
    run_id = run.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        raise RuntimeError("Native pilot run identity missing")
    deadline = time.monotonic() + timeout_seconds
    cancelled = False
    try:
        while run.get("status") in {"pending", "running"}:
            if time.monotonic() >= deadline and not cancelled:
                client.runs.cancel(runtime.thread_id, run_id, wait=False, action="interrupt")
                cancelled = True
            threading.Event().wait(0.1)
            run = client.runs.get(runtime.thread_id, run_id)
    except BaseException:
        client.runs.cancel(runtime.thread_id, run_id, wait=False, action="interrupt")
        raise
    # A terminal native status is published after PhysicalRunScope.drain. The
    # done callback can still be releasing its API slot; wait for that exact work.
    with runtime._lock:
        future = runtime._run_futures.get((runtime.thread_id, run_id))
    if future is not None:
        future.result()
    release_deadline = time.monotonic() + 30
    while True:
        with runtime._lock:
            reserved = run_id in runtime._capacity_active
        receipt = runtime._capacity.quiesce_receipt(run_id)
        if receipt is not None or time.monotonic() >= release_deadline:
            break
        threading.Event().wait(0.05)
    return {"nativeRunId": run_id, "nativeThreadId": runtime.thread_id,
            "transportState": run.get("status"), "cancelRequested": cancelled,
            "physicalDrainObserved": True, "locallyTrackedReservation": reserved,
            "capacityReleaseObserved": receipt is not None, "capacityQuiesceReceipt": receipt}
