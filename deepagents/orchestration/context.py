"""Per-run context contract for the LCSP root orchestrator.

Only stable identifiers and pinned artifact metadata belong here. Repository,
Wizard and legal contents stay behind governed LCSP tools and are hydrated by the
context-wizard pipeline stage.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class LCSPRunContext:
    """Immutable runtime context propagated from root to every subagent."""

    assessment_id: str | None = None
    user_id: str | None = None
    workflow_run_id: str | None = None
    checkpoint_id: str | None = None
    artifact_versions: dict[str, str] = field(default_factory=dict)
    engineering_rule_ids: tuple[str, ...] = ()
    legal_rule_ids: tuple[str, ...] = ()
    idempotency_key: str | None = None


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

    if context.engineering_rule_ids:
        lines.append("engineering_rule_ids=" + ",".join(context.engineering_rule_ids))
    if context.legal_rule_ids:
        lines.append("legal_rule_ids=" + ",".join(context.legal_rule_ids))
    if context.artifact_versions:
        versions = ",".join(
            f"{key}:{value}" for key, value in sorted(context.artifact_versions.items())
        )
        lines.append(f"artifact_versions={versions}")
    return tuple(lines)
