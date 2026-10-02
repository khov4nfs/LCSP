"""Container entrypoint for the LCSP local Deep Agent runtime service."""

from __future__ import annotations

import os
import re
import signal
import shlex
import subprocess
import sys
import threading
import time
from collections.abc import Sequence
from pathlib import Path

from langsmith_bootstrap import disable_langsmith_tracing_by_default
from tools.common.capabilities.platform.docker_sandbox import DockerSandboxManager


DEFAULT_SANDBOX_REAPER_INTERVAL_SECONDS = 3600
DEFAULT_SANDBOX_TTL_SECONDS = 86400
DEFAULT_AGENT_RUNTIME_JOBS_PER_WORKER = 8


def main() -> int:
    disable_langsmith_tracing_by_default()
    role = _agent_runtime_role()
    reaper_stop = threading.Event()
    reaper_thread = _start_sandbox_reaper(reaper_stop)
    processes: list[subprocess.Popen[bytes]] = []
    if role in {"combined", "server"}:
        agent_server_command = _agent_server_command()
        processes.append(
            _start(
                agent_server_command,
                local_graph_dev=_uses_langgraph_dev(agent_server_command),
            )
        )
    if role in {"combined", "bridge"}:
        processes.append(
            _start(
                (
                    sys.executable,
                    "-m",
                    "tools.common.capabilities.agent_runtime.rabbitmq_consumer",
                ),
                local_graph_dev=False,
            )
        )

    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        reaper_stop.set()
        for process in processes:
            if process.poll() is None:
                process.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    exit_code = 0
    try:
        while True:
            for process in processes:
                code = process.poll()
                if code is not None:
                    exit_code = code
                    stop(signal.SIGTERM, None)
                    return exit_code
            time.sleep(0.5)
    finally:
        reaper_stop.set()
        for process in processes:
            if process.poll() is None:
                process.kill()
        if reaper_thread is not None:
            reaper_thread.join(timeout=2)


def _start(args: Sequence[str], *, local_graph_dev: bool) -> subprocess.Popen[bytes]:
    env = {
        **os.environ,
    }
    if local_graph_dev:
        env["LCSP_LOCAL_GRAPH_DEV"] = os.environ.get("LCSP_LOCAL_GRAPH_DEV", "1")
    else:
        env.setdefault("LCSP_LOCAL_GRAPH_DEV", "0")
    _harden_langsmith_env(env)
    return subprocess.Popen(args, cwd=os.getcwd(), env=env)


def _agent_server_command() -> tuple[str, ...]:
    production = _agent_runtime_mode() == "production"
    configured = os.environ.get("LCSP_AGENT_RUNTIME_SERVER_COMMAND", "").strip()
    if configured:
        expanded = os.path.expandvars(configured)
        command = tuple(shlex.split(expanded))
        if not command:
            raise RuntimeError("LCSP_AGENT_RUNTIME_SERVER_COMMAND is empty")
        if Path(command[0]).name == "langgraph":
            command = (_langgraph_executable(), *command[1:])
        _validate_agent_server_command(command, production=production)
        return command

    if production:
        return (
            sys.executable,
            "-m",
            "tools.common.capabilities.agent_runtime.local_server",
        )

    return (
        _langgraph_executable(),
        "dev",
        "--no-browser",
        "--no-reload",
        "--allow-blocking",
        "--n-jobs-per-worker",
        str(_agent_runtime_jobs_per_worker()),
    )


def _validate_agent_server_command(
    command: Sequence[str],
    *,
    production: bool,
) -> None:
    if not production:
        return
    unexpanded = [arg for arg in command if re.search(r"\$[A-Za-z_]", arg)]
    if unexpanded:
        raise RuntimeError(
            "LCSP_AGENT_RUNTIME_SERVER_COMMAND contains unexpanded environment "
            f"variables: {', '.join(unexpanded)}"
        )
    if _uses_lcsp_local_server(command):
        return
    if len(command) >= 2 and Path(command[0]).name == "langgraph":
        raise RuntimeError(
            "production Agent Server command must use the LCSP local agent "
            "runtime server, not the langgraph CLI"
        )
    raise RuntimeError(
        "production Agent Server command must run "
        "tools.common.capabilities.agent_runtime.local_server"
    )


def _agent_runtime_mode() -> str:
    configured = os.environ.get("LCSP_AGENT_RUNTIME_MODE", "").strip().lower()
    if configured:
        return configured
    if os.environ.get("NODE_ENV", "").strip().lower() == "production":
        return "production"
    return "development"


def _agent_runtime_jobs_per_worker() -> int:
    raw = os.environ.get(
        "LCSP_AGENT_RUNTIME_JOBS_PER_WORKER",
        str(DEFAULT_AGENT_RUNTIME_JOBS_PER_WORKER),
    ).strip()
    if not raw.isdigit():
        raise RuntimeError("LCSP_AGENT_RUNTIME_JOBS_PER_WORKER must be a positive integer")
    value = int(raw)
    if value < 1 or value > 64:
        raise RuntimeError("LCSP_AGENT_RUNTIME_JOBS_PER_WORKER must be between 1 and 64")
    return value


def _agent_runtime_role() -> str:
    configured = os.environ.get("LCSP_AGENT_RUNTIME_ROLE", "").strip().lower()
    if not configured:
        return "combined"
    if configured not in {"combined", "server", "bridge"}:
        raise RuntimeError(
            "LCSP_AGENT_RUNTIME_ROLE must be one of: combined, server, bridge"
        )
    return configured


def _uses_langgraph_dev(command: Sequence[str]) -> bool:
    return (
        len(command) >= 2
        and Path(command[0]).name == "langgraph"
        and command[1] == "dev"
    )


def _uses_lcsp_local_server(command: Sequence[str]) -> bool:
    return (
        len(command) >= 3
        and command[1] == "-m"
        and command[2] == "tools.common.capabilities.agent_runtime.local_server"
    )


def _langgraph_executable() -> str:
    sibling = Path(sys.executable).with_name("langgraph")
    return str(sibling) if sibling.exists() else "langgraph"


def _harden_langsmith_env(env: dict[str, str]) -> None:
    tracing_enabled = env.get("LCSP_LANGSMITH_TRACING", "").strip().lower()
    if tracing_enabled in {"1", "true", "yes", "on"}:
        return
    for key in list(env):
        if key.startswith("LANGSMITH_") or key in {
            "LANGSMITH_API_KEY",
            "LANGCHAIN_API_KEY",
            "LANGCHAIN_ENDPOINT",
            "LANGCHAIN_PROJECT",
        }:
            env.pop(key, None)
    env["LANGSMITH_TRACING"] = "false"
    env["LANGCHAIN_TRACING_V2"] = "false"


def _start_sandbox_reaper(stop_event: threading.Event) -> threading.Thread | None:
    enabled, ttl_seconds, interval_seconds = _sandbox_reaper_settings(os.environ)
    if not enabled:
        return None
    thread = threading.Thread(
        target=_sandbox_reaper_loop,
        args=(stop_event, ttl_seconds, interval_seconds),
        name="lcsp-repository-sandbox-reaper",
        daemon=True,
    )
    thread.start()
    return thread


def _sandbox_reaper_loop(
    stop_event: threading.Event,
    ttl_seconds: int,
    interval_seconds: int,
) -> None:
    while not stop_event.is_set():
        _cleanup_stale_sandboxes(ttl_seconds)
        if interval_seconds <= 0:
            return
        stop_event.wait(interval_seconds)


def _cleanup_stale_sandboxes(ttl_seconds: int) -> list[str]:
    try:
        deleted = DockerSandboxManager().cleanup_stale(max_age_seconds=ttl_seconds)
    except Exception as exc:  # pragma: no cover - defensive startup guard
        print(f"[sandbox-reaper] cleanup failed: {exc}", file=sys.stderr, flush=True)
        return []
    if deleted:
        print(
            f"[sandbox-reaper] deleted {len(deleted)} stale repository sandbox(s)",
            flush=True,
        )
    return deleted


def _sandbox_reaper_settings(
    env: os._Environ[str] | dict[str, str],
) -> tuple[bool, int, int]:
    enabled = (
        env.get("LCSP_REPOSITORY_SANDBOX_CLEANUP_ON_START", "true").strip().lower()
    )
    if enabled in {"0", "false", "no", "off"}:
        return False, DEFAULT_SANDBOX_TTL_SECONDS, DEFAULT_SANDBOX_REAPER_INTERVAL_SECONDS
    ttl_seconds = _env_int(
        env,
        "LCSP_REPOSITORY_SANDBOX_TTL_SECONDS",
        DEFAULT_SANDBOX_TTL_SECONDS,
    )
    interval_seconds = _env_int(
        env,
        "LCSP_REPOSITORY_SANDBOX_REAPER_INTERVAL_SECONDS",
        DEFAULT_SANDBOX_REAPER_INTERVAL_SECONDS,
    )
    return True, ttl_seconds, interval_seconds


def _env_int(env: os._Environ[str] | dict[str, str], key: str, default: int) -> int:
    try:
        return int(env.get(key, str(default)))
    except ValueError:
        return default


if __name__ == "__main__":
    raise SystemExit(main())