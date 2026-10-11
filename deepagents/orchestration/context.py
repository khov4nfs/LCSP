"""Per-run context contract for the LCSP root orchestrator.

Only stable identifiers and pinned artifact metadata belong here. Repository,
Customer context and legal contents stay behind governed LCSP tools and are
hydrated by the runtime stages that own those data boundaries.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class LCSPRunContext:
    """Immutable runtime context propagated from root to every subagent."""

    assessment_id: str | None = None
    user_id: str | None = None
    workflow_run_id: str | None = None
    checkpoint_id: str | None = None
    thread_id: str | None = None
    logical_run_id: str | None = None
    snapshot_id: str | None = None
    scan_job_id: str | None = None
    commit_sha: str | None = None
    idempotency_key: str | None = None
    correlation_id: str | None = None
    system_boundary_name: str | None = None
    system_deadline_at: float | None = None
    system_event: dict[str, Any] = field(default_factory=dict)
    repository_path: str | None = None


def coerce_run_context(value: Any) -> LCSPRunContext | None:
    """The trusted run context from a tool runtime's ``context`` (object or mapping)."""
    if isinstance(value, LCSPRunContext):
        return value
    if isinstance(value, dict):
        try:
            return LCSPRunContext(**value)
        except TypeError:
            return None
    return None


def bounded_context_lines(context: LCSPRunContext | None) -> tuple[str, ...]:
    """Project non-sensitive run identifiers into model context."""
    if context is None:
        return ()

    lines: list[str] = []
    for name in (
        "assessment_id",
        "workflow_run_id",
        "checkpoint_id",
        "idempotency_key",
    ):
        value = getattr(context, name)
        if value:
            lines.append(f"{name}={value}")

    return tuple(lines)
