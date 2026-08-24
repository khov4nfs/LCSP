"""Shared LangGraph execution state and durable checkpoint/resume helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Generic, TypeVar


PayloadT = TypeVar("PayloadT")
StateT = TypeVar("StateT")


@dataclass(frozen=True)
class GraphNodeContext:
    """Identifiers propagated into optional LLM/tool work performed by a node."""

    workflow_run_id: str
    node_name: str
    correlationId: str | None = None
    request_id: str | None = None


@dataclass(frozen=True)
class GraphNodeResult:
    """Recorded status and metadata for one completed/skipped graph node."""

    node_name: str
    status: str
    request_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class GraphRunState:
    """Mutable audit state accumulated across one governed graph execution."""

    graph_name: str
    workflow_run_id: str
    assessment_id: str | None = None
    artifact_id: str | None = None
    correlationId: str | None = None
    input_versions: dict[str, str] = field(default_factory=dict)
    attempt: int = 0
    current_node: str | None = None
    sanitized_inputs: dict[str, Any] = field(default_factory=dict)
    guardrail_status: str | None = None
    llm_run_refs: list[str] = field(default_factory=list)
    blocked_or_degraded_reason: str | None = None
    node_results: list[GraphNodeResult] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def artifact_versions(self) -> dict[str, str]:
        """Alias retained for the authoritative runtime state contract."""
        return self.input_versions

    def record_input_version(self, name: str, value: str) -> None:
        """Pin an input artifact/version used by this workflow run."""
        self.input_versions[name] = value

    def record_guardrail(self, status: str, reason: str | None = None) -> None:
        """Record guardrail status and preserve a reason only for degraded/blocked runs."""
        self.guardrail_status = status
        self.blocked_or_degraded_reason = (
            reason if status in {"blocked", "degraded"} else None
        )

    def record_node(
        self,
        *,
        node_name: str,
        status: str,
        request_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Append node execution metadata and deduplicate associated LLM request IDs."""
        self.current_node = node_name
        if request_id and request_id not in self.llm_run_refs:
            self.llm_run_refs.append(request_id)
        self.node_results.append(
            GraphNodeResult(
                node_name=node_name,
                status=status,
                request_id=request_id,
                metadata=metadata or {},
            )
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize the graph execution state for diagnostics/audit persistence."""
        return {
            "graph_name": self.graph_name,
            "workflow_run_id": self.workflow_run_id,
            "assessment_id": self.assessment_id,
            "artifact_id": self.artifact_id,
            "correlationId": self.correlationId,
            "artifact_versions": dict(self.input_versions),
            "attempt": self.attempt,
            "node_name": self.current_node,
            "sanitized_inputs": dict(self.sanitized_inputs),
            "guardrail_status": self.guardrail_status,
            "llm_run_refs": list(self.llm_run_refs),
            "blocked_or_degraded_reason": self.blocked_or_degraded_reason,
            "node_results": [
                {
                    "node_name": result.node_name,
                    "status": result.status,
                    "request_id": result.request_id,
                    "metadata": dict(result.metadata),
                }
                for result in self.node_results
            ],
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class GraphRunResult(Generic[PayloadT]):
    """Generic graph payload bundled with workflow and execution state."""

    graph_name: str
    workflow_run_id: str
    state: GraphRunState
    payload: PayloadT


def checkpoint_database_url(value: object) -> str | None:
    """Return a configured Postgres checkpoint URL or disable checkpointing.

    Raises:
        ValueError: If a non-empty URL does not use a Postgres scheme.
    """
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if not cleaned.startswith(("postgresql://", "postgres://")):
        raise ValueError(
            "LANGGRAPH_CHECKPOINT_DATABASE_URL must use postgres:// or postgresql://"
        )
    return cleaned


def invoke_graph(
    *,
    build_graph: Callable[[Any], Any],
    initial_state: StateT,
    workflow_run_id: str,
    checkpoint_url: str | None,
) -> StateT:
    """Invoke a graph and resume/checkpoint its workflow thread when configured.

    A failed thread resumes from its last successful LangGraph checkpoint. A
    completed thread returns the checkpointed terminal state, preventing broker
    redelivery from repeating optional LLM calls or persistence nodes.

    Args:
        build_graph: Factory accepting an optional checkpointer and returning a graph app.
        initial_state: State used only when no prior checkpoint exists.
        workflow_run_id: Stable thread identifier for checkpoint lookup.
        checkpoint_url: Optional validated Postgres checkpoint connection URL.

    Returns:
        Terminal or resumed graph state.
    """
    if not checkpoint_url:
        return build_graph(None).invoke(initial_state)

    from langgraph.checkpoint.postgres import PostgresSaver

    config = {"configurable": {"thread_id": workflow_run_id}}
    with PostgresSaver.from_conn_string(checkpoint_url) as checkpointer:
        checkpointer.setup()
        app = build_graph(checkpointer)
        snapshot = app.get_state(config)
        if snapshot.next:
            return app.invoke(None, config)
        if snapshot.values:
            return snapshot.values
        return app.invoke(initial_state, config)
