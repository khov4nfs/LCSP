"""Internal Agent Runtime health boundary used by local/runtime E2E checks."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from langgraph.config import get_config

from tools.common.capabilities.agent_runtime.boundary import AgentBoundaryBase
from tools.common.capabilities.platform.repository_sandbox import (
    activate_repository_backend,
    hydrate_repository,
    resolve_repository_thread_backend,
)


class AgentRuntimeHealthBoundary(AgentBoundaryBase):
    """Hydrate and check one pinned test repository on the native LangGraph thread."""

    boundary_source = "agent-runtime.health"
    source_event = "internal.agent-runtime.health.v1"
    requires_rbac = False

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        snapshot_id = _text(message.get("snapshotId"))
        scan_job_id = _text(message.get("scanJobId"))
        if not snapshot_id or not scan_job_id:
            raise ValueError("runtime health requires snapshotId and scanJobId")

        backend = resolve_repository_thread_backend(get_config())
        hydrate_repository(
            backend,
            snapshot_id=snapshot_id,
            scan_job_id=scan_job_id,
            commit_sha=_text(message.get("commitSha")) or "",
            correlation_id=correlationId,
        )
        with activate_repository_backend(backend) as repository:
            expected_path = _text(message.get("expectedPath")) or "src/app.py"
            read = repository.read(expected_path, offset=0, limit=4000)
            if getattr(read, "error", None):
                raise RuntimeError(f"hydrated repository file is missing: {expected_path}")

            payload = {
                "boundary": self.boundary_name,
                "correlationId": correlationId,
                "expectedPath": expected_path,
                "checkedAt": datetime.now(timezone.utc).isoformat(),
            }
            write = repository.write(
                ".lcsp/agent/runtime-health.json",
                json.dumps(payload, sort_keys=True, separators=(",", ":")),
            )
            if getattr(write, "error", None):
                raise RuntimeError("failed to write runtime health marker")


def _text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


__all__ = ["AgentRuntimeHealthBoundary"]
