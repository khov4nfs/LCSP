"""Physical admission client and aggregate measurements for the one Agent Server.

No prompt, repository contents, provider key or customer identity is a metric.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import threading
import time
import uuid
from collections import deque
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit

import httpx
from langgraph.checkpoint.postgres import PostgresSaver

LOGGER = logging.getLogger(__name__)
CAPACITY_UNAVAILABLE = "ASSESSMENT_ROOT_CAPACITY_UNAVAILABLE"
ROOT_COMMAND_OBSOLETE = "ASSESSMENT_ROOT_COMMAND_OBSOLETE"
METRIC_SOURCE = "PROCFS_CGROUP_DOCKER_NATIVE_CHECKPOINTER"
ROOT_BOUNDARY = "assessment_root_requested"
_observations: deque[tuple[float, float, bool]] = deque(maxlen=4096)
_provider_errors: deque[float] = deque(maxlen=4096)
_budget_denials: deque[float] = deque(maxlen=4096)
_metrics_lock = threading.Lock()


class RootCapacityUnavailable(RuntimeError):
    """Admission refusal: durable broker deferral, never Assessment failure."""


class RootCommandObsolete(RuntimeError):
    """Already-consumed or superseded canonical command: ACK without native execution."""


def observe_provider_pressure(error: BaseException) -> None:
    """Business purpose: Record observed provider/budget refusal without retaining provider payloads.

    Business rules:
    - Only actual HTTP 429 or PaidAdmissionError evidence increments a pressure counter.
    Execution flow:
    1. Inspect safe exception metadata and append its observation time.
    Failure cases:
    - Other errors provide no positive rate/budget evidence and are not reclassified.
    Side effects:
    - Updates bounded, process-local operational counters; no billing or provider operation.
    """
    from middleware.failure_policy import PaidAdmissionError, error_status

    with _metrics_lock:
        if error_status(error) == 429:
            _provider_errors.append(time.time())
        if isinstance(error, PaidAdmissionError):
            _budget_denials.append(time.time())


@contextmanager
def checkpoint_observation():
    """Business purpose: Measure actual checkpoint operations and preserve their failure behavior.

    Business rules:
    - Errors remain errors; measurements contain duration/success only.
    Execution flow:
    1. Time the operation, then record its observed success or failure even when it raises.
    Failure cases:
    - Checkpoint exceptions propagate unchanged to native recovery.
    Side effects:
    - Appends one bounded operational observation without copying checkpoint contents.
    """
    started = time.monotonic()
    failed = True
    try:
        yield
        failed = False
    finally:
        with _metrics_lock:
            _observations.append((time.time(), (time.monotonic() - started) * 1000, failed))


class MeasuredPostgresSaver(PostgresSaver):
    """The existing saver with timing; native checkpoint identity/serialization is unchanged."""

    def get_tuple(self, config):
        """Business purpose: Measure a canonical checkpoint read without changing its result.

        Business rules:
        - Native PostgresSaver remains the read authority.
        Execution flow:
        1. Time and delegate the native read.
        Failure cases:
        - Native errors propagate and count as observed failures.
        Side effects:
        - Reads checkpoint state and appends aggregate timing only.
        """
        with checkpoint_observation():
            return super().get_tuple(config)

    def put(self, config, checkpoint, metadata, new_versions):
        """Business purpose: Measure a native checkpoint commit while preserving canonical ancestry.

        Business rules:
        - Native PostgresSaver alone serializes and persists the supplied checkpoint.
        Execution flow:
        1. Time and delegate the unchanged native commit.
        Failure cases:
        - Database errors propagate; no successful measurement is fabricated.
        Side effects:
        - Persists the native checkpoint and records only timing/success.
        """
        with checkpoint_observation():
            return super().put(config, checkpoint, metadata, new_versions)

    def put_writes(self, config, writes, task_id, task_path=""):
        """Business purpose: Measure durable native pending writes without changing replay semantics.

        Business rules:
        - Writes retain their exact task/path/checkpoint identity.
        Execution flow:
        1. Time and delegate the existing pending-write operation.
        Failure cases:
        - Native errors propagate and count as failures.
        Side effects:
        - Persists pending writes and aggregate timing without retaining their payloads.
        """
        with checkpoint_observation():
            return super().put_writes(config, writes, task_id, task_path)


def _read_number(path: Path) -> int | None:
    """Business purpose: Read a kernel resource limit without inventing an unlimited/healthy value.

    Business rules:
    - Kernel 'max' explicitly means unlimited; missing/unreadable values remain unknown.
    Execution flow:
    1. Parse a nonnegative integer from the requested kernel file.
    Failure cases:
    - Missing, nonnumeric or negative readings return null.
    Side effects:
    - Read-only local kernel observation.
    """
    try:
        value = int(path.read_text().strip())
        return value if value >= 0 else None
    except (OSError, ValueError):
        return None


def _pressure(path: Path) -> float | None:
    """Business purpose: Read measured CPU/I/O stall pressure for resource admission.

    Business rules:
    - The kernel's ten-second 'some' stall average is a fraction, not CPU idleness.
    Execution flow:
    1. Read and parse the pressure observation.
    Failure cases:
    - Unavailable PSI remains null and cannot justify scale-up.
    Side effects:
    - Read-only kernel observation.
    """
    try:
        match = re.search(r"^some avg10=([0-9.]+)", path.read_text(), re.M)
        return float(match[1]) / 100 if match else None
    except OSError:
        return None


def _docker_bytes(value: str) -> float:
    """Business purpose: Preserve Docker's reported byte units in aggregate sandbox measurements.

    Business rules:
    - Only explicit byte/SI/IEC quantities are accepted; malformed output is unknown.
    Execution flow:
    1. Parse the quantity and apply its reported unit.
    Failure cases:
    - Unsupported units/quantities raise ValueError for the collector's unknown path.
    Side effects:
    - Pure unit conversion.
    """
    match = re.fullmatch(r"([0-9.]+)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)", value.strip())
    if not match:
        raise ValueError("Unrecognized Docker memory quantity")
    units = {"B": 1, "kB": 1000, "KB": 1000, "MB": 1000**2, "GB": 1000**3, "TB": 1000**4,
             "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4}
    return float(match[1]) * units[match[2]]


def _cgroup_limits(group: Path, root: Path) -> dict[str, Any]:
    """Business purpose: Respect inherited cgroup resource constraints rather than just the worker's leaf.

    Business rules:
    - Every visible ancestor can tighten RAM/CPU limits; a namespaced root with hidden parents is unknown.
    - The real hierarchy root has no memory.max/cpu.max files; host measurements bound that unlimited root.
    Execution flow:
    1. Verify the hierarchy, then collect the tightest finite memory/CPU limits and remaining memory.
    2. Combine measured stall pressure across the worker and its ancestors.
    Failure cases:
    - Missing/non-numeric limits, hidden ancestry or unreadable pressure fail closed without healthy substitutions.
    Side effects:
    - Reads kernel resource files only; no process, controller or container is modified.
    """
    result = dict(cgroupObserved=False, cgroupMemoryLimitBytes=None,
        cgroupMemoryAvailableBytes=None, cgroupCpuLimitCores=None, cpuPressure=None, diskPressure=None)
    try:
        group, root = group.resolve(), root.resolve()
        if not group.is_relative_to(root) or not {"cpu", "memory"}.issubset(set((root / "cgroup.controllers").read_text().split())):
            return result
        # memory.max exists only on non-root cgroups. At the mount root it
        # identifies a delegated/namespaced subtree whose ancestors are hidden.
        if (root / "memory.max").exists():
            return result
        limits, available, cpus, cpu_pressure, io_pressure = [], [], [], [], []
        current = group
        while current != root:
            maximum = (current / "memory.max").read_text().strip()
            usage = _read_number(current / "memory.current")
            quota, period = (current / "cpu.max").read_text().split()
            cpu, io = _pressure(current / "cpu.pressure"), _pressure(current / "io.pressure")
            if usage is None or cpu is None or io is None or int(period) <= 0:
                return result
            if maximum != "max":
                if int(maximum) <= 0: return result
                limits.append(int(maximum)); available.append(max(0, int(maximum) - usage))
            if quota != "max":
                if int(quota) <= 0: return result
                cpus.append(int(quota) / int(period))
            cpu_pressure.append(cpu); io_pressure.append(io)
            current = current.parent
        count = os.cpu_count()
        if count is None: return result
        result.update(cgroupObserved=True, cgroupMemoryLimitBytes=min(limits, default=None),
            cgroupMemoryAvailableBytes=min(available, default=None),
            cgroupCpuLimitCores=min([count, *cpus]), cpuPressure=max(cpu_pressure, default=None),
            diskPressure=max(io_pressure, default=None))
    except (OSError, ValueError, TypeError):
        pass
    return result


def resource_measurements() -> dict[str, Any]:
    """Business purpose: Capture real host, cgroup and sandbox headroom for Root admission.

    Business rules:
    - Collector failures remain null; zero sandboxes is measured through successful Docker enumeration.
    - Sandbox identifiers are hashed; no environment, names, repository contents or credentials leave this collector.
    Execution flow:
    1. Read host/PSI/cgroup ancestor limits and current process RSS.
    2. Read filesystem free space and aggregate labelled sandbox Docker stats.
    3. Add recent actual checkpoint and provider-pressure observations.
    Failure cases:
    - Missing procfs, cgroup, Docker or checkpoint data stays unknown for fail-closed evaluation.
    Side effects:
    - Read-only kernel/filesystem/Docker calls with bounded deadlines and output.
    """
    result: dict[str, Any] = {key: None for key in (
        "cpuPressure", "memoryAvailableBytes", "cgroupMemoryAvailableBytes", "cgroupMemoryLimitBytes",
        "cgroupCpuLimitCores", "processRssBytes", "diskAvailableBytes", "diskPressure",
        "sandboxMemoryBytes", "largestSandboxMemoryBytes", "sandboxCpuCores", "activeSandboxes",
    )}
    result["cpuPressure"] = _pressure(Path("/proc/pressure/cpu"))
    result["diskPressure"] = _pressure(Path("/proc/pressure/io"))
    try:
        mem = dict(re.findall(r"^(\w+):\s+(\d+)", Path("/proc/meminfo").read_text(), re.M))
        result["memoryAvailableBytes"] = int(mem["MemAvailable"]) * 1024
        rss = re.search(r"^VmRSS:\s+(\d+)", Path("/proc/self/status").read_text(), re.M)
        result["processRssBytes"] = int(rss[1]) * 1024 if rss else None
        disk = os.statvfs(os.getenv("LCSP_ROOT_CAPACITY_DISK_PATH", os.getcwd()))
        result["diskAvailableBytes"] = disk.f_bavail * disk.f_frsize
    except (OSError, KeyError, ValueError):
        pass
    result["cgroupObserved"] = False
    try:
        relative = next(line.split(":", 2)[2] for line in Path("/proc/self/cgroup").read_text().splitlines() if line.startswith("0::"))
        group = Path("/sys/fs/cgroup") / relative.lstrip("/")
        limits = _cgroup_limits(group, Path("/sys/fs/cgroup"))
        for key in ("cgroupObserved", "cgroupMemoryLimitBytes", "cgroupMemoryAvailableBytes", "cgroupCpuLimitCores"):
            result[key] = limits[key]
        for key in ("cpuPressure", "diskPressure"):
            if result[key] is not None and limits[key] is not None:
                result[key] = max(result[key], limits[key])
    except (OSError, ValueError, StopIteration, TypeError):
        pass
    result["sandboxSamples"] = None
    try:
        from tools.common.capabilities.platform.docker_sandbox import SANDBOX_LABEL

        ids = subprocess.run(["docker", "ps", "-q", "--filter", f"label={SANDBOX_LABEL}=true"],
            capture_output=True, check=True, timeout=5, text=True).stdout.split()
        if len(ids) > 256 or any(not re.fullmatch(r"[a-f0-9]{12,64}", item) for item in ids):
            raise ValueError("Sandbox enumeration exceeded supported bounds")
        stats = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}", *ids],
            capture_output=True, check=True, timeout=10, text=True).stdout if ids else ""
        samples = []
        for line in stats.splitlines():
            item = json.loads(line)
            used, maximum = item["MemUsage"].split("/")
            samples.append({"sandboxId": hashlib.sha256(item["ID"].encode()).hexdigest()[:16],
                "threadHash": (item["Name"].removeprefix("lcsp-repository-sandbox-")
                    if re.fullmatch(r"lcsp-repository-sandbox-[a-f0-9]{24}", item["Name"]) else None),
                "memoryBytes": _docker_bytes(used), "memoryLimitBytes": _docker_bytes(maximum),
                "cpuCores": float(item["CPUPerc"].strip("%")) / 100})
        if len(samples) != len(ids):
            raise ValueError("Sandbox snapshot changed during sampling")
        result.update(sandboxMemoryBytes=sum(s["memoryBytes"] for s in samples),
            largestSandboxMemoryBytes=max((s["memoryBytes"] for s in samples), default=0),
            sandboxCpuCores=sum(s["cpuCores"] for s in samples), activeSandboxes=len(samples), sandboxSamples=samples)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        pass
    result.update(brokerReady=None, brokerUnacknowledged=None, brokerOtherReady=None, brokerObservedAt=None,
                  brokerSource="RABBITMQ_MANAGEMENT")
    management_url = os.getenv("LCSP_ROOT_CAPACITY_RABBITMQ_MANAGEMENT_URL")
    if management_url:
        try:
            broker = urlsplit(os.environ["RABBITMQ_URL"])
            vhost = unquote(broker.path[1:]) if broker.path not in {"", "/"} else "/"
            prefix = os.getenv("LCSP_AGENT_RUNTIME_RABBITMQ_QUEUE_PREFIX", "lcsp.agent_runtime.boundary")
            queue = f"{prefix}.{ROOT_BOUNDARY}"
            response = httpx.get(f"{management_url.rstrip('/')}/api/queues/{quote(vhost, safe='')}",
                auth=(unquote(broker.username or ""), unquote(broker.password or "")), timeout=5)
            response.raise_for_status()
            queues = response.json()
            snapshot = next(item for item in queues if item.get("name") == queue)
            if type(snapshot.get("messages_ready")) is int and type(snapshot.get("messages_unacknowledged")) is int:
                result.update(brokerReady=snapshot["messages_ready"], brokerUnacknowledged=snapshot["messages_unacknowledged"],
                              brokerOtherReady=sum(item["messages_ready"] for item in queues if
                                  item.get("name", "").startswith(prefix + ".") and item["name"] != queue and ".retry." not in item["name"]),
                              brokerObservedAt=datetime.now(UTC).isoformat().replace("+00:00", "Z"))
        except (httpx.HTTPError, KeyError, ValueError, StopIteration, TypeError):
            pass
    with _metrics_lock:
        cutoff = time.time() - 60
        checkpoints = [item for item in _observations if item[0] >= cutoff]
        result.update(
            checkpointLatencyMs=max((item[1] for item in checkpoints), default=None),
            checkpointFailureRate=sum(item[2] for item in checkpoints) / len(checkpoints) if checkpoints else None,
            checkpointObservedAt=datetime.fromtimestamp(checkpoints[-1][0], UTC).isoformat().replace("+00:00", "Z") if checkpoints else None,
            provider429Count=sum(at >= cutoff for at in _provider_errors),
            budgetDenialCount=sum(at >= cutoff for at in _budget_denials),
        )
    return result


class RootCapacityClient:
    """Authenticated, incarnation-fenced API protocol for physical admission."""

    def __init__(self) -> None:
        base = os.environ.get("NESTJS_API_BASE_URL")
        key = os.environ.get("WORKER_API_KEY")
        if not base or not key:
            raise RuntimeError("Root capacity requires NESTJS_API_BASE_URL and WORKER_API_KEY")
        self._url = base.rstrip("/") + "/internal/assessment-root-capacity"
        self._key = key
        self.identity = {"hostId": hashlib.sha256(Path("/etc/machine-id").read_bytes().strip()).hexdigest(),
            "incarnationId": str(uuid.uuid4())}

    def call(self, action: str, **payload) -> dict[str, Any]:
        """Business purpose: Transport one operational reservation/report with exact server authority.

        Business rules:
        - Worker credentials remain headers only and are never logged; API problem/transport failures fail closed.
        Execution flow:
        1. For registration/reconciliation, read a comparison version so a delayed request cannot undo newer ownership/slots.
        2. POST the typed identity-bound operation and validate the shared success envelope.
        Failure cases:
        - HTTP, malformed-envelope and network failures raise without admitting or freeing work locally.
        Side effects:
        - Performs the selected API operational operation; never calls a provider or writes legal decisions.
        """
        if action in {"register", "report"}:
            current = httpx.get(f"{self._url}/registration", headers={"x-worker-api-key": self._key}, timeout=20)
            current.raise_for_status()
            envelope = current.json()
            if not isinstance(envelope, dict) or envelope.get("ok") is not True or type(envelope.get("data", {}).get("version")) is not int:
                raise RuntimeError("Invalid Root registration API envelope")
            payload["expectedVersion"] = envelope["data"]["version"]
        response = httpx.post(f"{self._url}/{action}", json={**self.identity, **payload},
            headers={"x-worker-api-key": self._key}, timeout=20)
        response.raise_for_status()
        envelope = response.json()
        if not isinstance(envelope, dict) or envelope.get("ok") is not True or not isinstance(envelope.get("data"), dict):
            raise RuntimeError("Invalid Root capacity API envelope")
        return envelope["data"]
