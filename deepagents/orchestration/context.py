"""Per-run context contract for the LCSP root orchestrator.

Only stable identifiers and pinned artifact metadata belong here. Repository,
Customer context and legal contents stay behind governed LCSP tools and are
hydrated by the runtime stages that own those data boundaries.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class RepositoryRelationContext:
    """A confirmed directed edge used for evidence traversal only."""

    from_snapshot_id: str
    to_snapshot_id: str
    relation_type: str


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
    artifact_versions: dict[str, str] = field(default_factory=dict)
    engineering_rule_ids: tuple[str, ...] = ()
    legal_rule_ids: tuple[str, ...] = ()
    idempotency_key: str | None = None
    correlation_id: str | None = None
    system_boundary_name: str | None = None
    system_deadline_at: float | None = None
    system_event: dict[str, Any] = field(default_factory=dict)
    repository_path: str | None = None
    repository_relations: tuple[RepositoryRelationContext, ...] = ()
    # One repository-analyst task = one EngineeringRule. Trusted, set by the runtime loop.
    engineering_rule_version: str | None = None  # runtime contract contentHash
    criterion_ids: tuple[str, ...] = ()  # the rule's requiredEvidence
    context_revision: int = 0
    prior_evidence_refs: tuple[str, ...] = ()  # accepted refs from a previous result (resume)
    rule_execution_id: str | None = None  # fresh per analyze_rule attempt; scopes minted evidence refs


def coerce_run_context(value: Any) -> LCSPRunContext | None:
    """The trusted run context from a tool runtime's ``context`` (object or mapping)."""
    if isinstance(value, LCSPRunContext):
        return value
    if isinstance(value, dict):
        try:
            payload = dict(value)
            if not payload.get("repository_relations"):
                payload["repository_relations"] = repository_relations_from_event(
                    payload.get("system_event")
                )
            return LCSPRunContext(**payload)
        except TypeError:
            return None
    return None


def repository_relations_from_event(value: Any) -> tuple[RepositoryRelationContext, ...]:
    """Decode only confirmed relation edges carried by a trusted scan event."""
    if not isinstance(value, dict):
        return ()
    raw = value.get("repositoryRelations") or value.get("repository_relations")
    if not isinstance(raw, (list, tuple)):
        return ()
    relations: list[RepositoryRelationContext] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        from_snapshot_id = item.get("fromSnapshotId") or item.get("from_snapshot_id")
        to_snapshot_id = item.get("toSnapshotId") or item.get("to_snapshot_id")
        relation_type = item.get("relationType") or item.get("relation_type") or item.get("type")
        if all(isinstance(field, str) and field.strip() for field in (from_snapshot_id, to_snapshot_id, relation_type)):
            if from_snapshot_id != to_snapshot_id:
                relations.append(
                    RepositoryRelationContext(
                        from_snapshot_id=from_snapshot_id,
                        to_snapshot_id=to_snapshot_id,
                        relation_type=relation_type,
                    )
                )
    return tuple(relations)


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
