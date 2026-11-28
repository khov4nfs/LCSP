"""Consume ``command.assessment.root.requested.v1`` and run the assessment's one Root."""

from __future__ import annotations

import contextlib
import os
from functools import partial
from typing import Any, Callable
from langgraph.config import get_store

from assessment_root.client import AssessmentApiError, AssessmentRuntimeClient
from assessment_root.runner import run_assessment_root, NativeRootRecoveryRequired
from tools.common.capabilities.agent_runtime.boundary import (
    AgentBoundaryBase,
    NonRetryableAgentBoundaryError,
)
from tools.common.capabilities.platform.graph_runtime import checkpoint_database_url

ASSESSMENT_ROOT_COMMAND = "command.assessment.root.requested.v1"
ASSESSMENT_ROOT_BOUNDARY_SOURCE = "assessment.root-run"
# The API owns lease/duplicate semantics: a held lease means the Root is already running.
_LEASE_HELD = "ASSESSMENT_EXECUTION_LEASE_HELD"
_NOT_ACTIVE = "ASSESSMENT_NOT_ACTIVE"


def sandbox_backend_factory(
    claim: dict[str, Any],
    context: dict[str, Any],
    *,
    discovery_sink: Callable[[dict[str, Any]], Any] | None = None,
    discovery_lookup: Callable[[], dict[str, Any]] | None = None,
):
    """Business purpose: Mount the Assessment's pinned source on its durable Root thread for native investigation.

    Business rules:
    - Hydrate only the API-issued snapshot/job/commit and immutable source prefix of every repository pinned to this Assessment and server-owned thread.
    - One pinned repository keeps the original sandbox layout; several repositories are mounted side by side, one directory per repository key.
    - Scope filtering preserves original source paths and excludes sibling projects before graph indexing.
    - Source and runtime identity metadata are read-only; writes are limited to the existing agent scratch subtree.
    - Graph lookup and versioned discovery are investigation aids bound to this same hydrated source, not legal authority.
    - A previously persisted discovery may be reused only after the API verifies its owner, immutable source coordinates and graph index version.
    - When supplied and no reusable discovery exists, the governed sink must durably accept the validated artifact before model investigation starts.

    Execution flow:
    1. Resolve the thread sandbox and hydrate every pinned repository with source-view limitations.
    2. Ensure each repository's source graph index and historical V1 pre-scan profile are current.
    3. Check any leased, API-verified Discovery summary against the pinned snapshot, repository, source scope and graph index.
    4. Reuse the exact matching artifact; otherwise scan and submit a new one through the governed API.
    5. Return the read-only repository backend without exposing source to model context.

    Failure cases:
    - Missing or mismatched pins, hydration, indexing, discovery, or durable submission failures propagate before model investigation begins.

    Side effects:
    - Hydrates the guarded source view and graph index; scans only on a cache miss and invokes no model or decision write.
    """
    from tools.common.capabilities.platform.codebase_memory import (
        active_codebase_memory_index,
        ensure_codebase_memory_index,
        ensure_codebase_memory_set_index,
    )
    from tools.common.capabilities.platform.repository_sandbox import (
        activate_repository_backend,
        hydrate_repository_set,
        repository_pins_from_context,
        resolve_repository_thread_backend,
        RuntimeRepositoryFilesystemBackend,
    )

    thread_backend = resolve_repository_thread_backend(
        {"configurable": {"thread_id": claim["threadId"]}}
    )
    pins = repository_pins_from_context(context)
    # One pinned repository keeps the original sandbox layout; several are mounted side by side, one directory
    # per repository key, and every one of them is hydrated before the Root starts.
    layout = hydrate_repository_set(
        thread_backend,
        pins,
        assessment_id=context["assessmentId"],
    )
    # The Root's graph tools query the Codebase Memory index of the hydrated snapshot; index it
    # before the Root starts (reused when current) so a run never silently lacks the graph.
    if layout.multi:
        graph_identity = ensure_codebase_memory_set_index(thread_backend, pins)
    else:
        ensure_codebase_memory_index(thread_backend)
        graph_identity = active_codebase_memory_index()
    from tools.common.capabilities.platform.repository_scanner import (
        ensure_repository_discovery,
        ensure_repository_profile,
    )

    def repository_id_of(pin) -> str:
        # The primary repository keeps the identity the API recorded for it; the others fall back to their key.
        """Business purpose: Name a pinned repository the way the API recorded it, so cached discovery and profile artifacts are matched to the right repository.

        Business rules:
        - The primary repository keeps the identity the API context carries for it.
        - Every other repository falls back to its recorded id, its full name, or an assessment-scoped key.

        Execution flow:
        1. Compare the pin with the primary pin.
        2. Return the recorded identity or the fallback.

        Failure cases:
        - An unknown pin simply falls back to the assessment-scoped key; nothing is rejected here.

        Side effects:
        - Pure computation: it reads no sandbox state and writes nothing.
        """
        if pin is pins[0]:
            return context.get("repositoryId") or context.get("repositoryFullName") or context["assessmentId"]
        return pin.repository_id or pin.full_name or f"{context['assessmentId']}:{pin.key}"

    def runtime_path(pin, name: str) -> str:
        """Business purpose: Choose where a repository's runtime artifacts (profile, discovery) live in the sandbox.

        Business rules:
        - One repository keeps the original shared runtime directory.
        - Several repositories each get a directory named by their repository key, so artifacts never overwrite each other.

        Execution flow:
        1. Check the sandbox layout.
        2. Return the shared path or the per-repository path.

        Failure cases:
        - No failure path: the layout is already validated by hydration.

        Side effects:
        - Pure computation: it reads no sandbox state and writes nothing.
        """
        return f"/workspace/runtime/{pin.key}/{name}" if layout.multi else f"/workspace/runtime/{name}"

    for pin in pins:
        profile_arguments: dict[str, Any] = {}
        if layout.multi:
            profile_arguments = {
                "workspace_path": pin.root,
                "profile_path": runtime_path(pin, "repository_profile.json"),
            }
        ensure_repository_profile(
            thread_backend,
            repository_id=repository_id_of(pin),
            commit_sha=pin.commit_sha,
            source_path_prefix=pin.source_path_prefix,
            **profile_arguments,
        )
    primary = pins[0]
    primary_repository_id = repository_id_of(primary)
    # A separate customer-authorized Discovery may already have completed on this
    # immutable snapshot. The server validates persisted integrity and Root lease
    # before returning its metadata; the worker independently checks every source
    # coordinate and current graph stamp before avoiding another content scan.
    graph_stamp = graph_identity.index_stamp if graph_identity is not None else "UNAVAILABLE"

    def reusable_discovery(pin, previous_summary) -> bool:
        """Business purpose: Decide whether a repository's earlier governed discovery can be reused instead of scanning it again.

        Business rules:
        - Only an available, well-formed summary can be reused; a malformed one fails the run.
        - Reuse requires the exact pinned snapshot, repository, commit, source scope and current graph index.

        Execution flow:
        1. Validate the summary shape.
        2. Compare every pinned coordinate and the graph index version.

        Failure cases:
        - A summary that is not an object, or is available without metadata, raises RuntimeError before model investigation.

        Side effects:
        - Pure comparison: nothing is scanned or submitted.
        """
        if not isinstance(previous_summary, dict):
            raise RuntimeError("governed discovery summary has invalid shape")
        if previous_summary.get("available") is not True:
            return False
        previous = previous_summary.get("discovery")
        if not isinstance(previous, dict):
            raise RuntimeError("governed discovery summary is missing metadata")
        return bool(
            previous.get("repositorySnapshotId") == pin.snapshot_id
            and previous.get("repositoryId") == repository_id_of(pin)
            and str(previous.get("repositoryCommit", "")).lower() == str(pin.commit_sha).lower()
            and previous.get("sourcePathPrefix") == pin.source_path_prefix
            and previous.get("graphIndexVersion") == graph_stamp
        )

    if not layout.multi:
        if discovery_lookup is not None and reusable_discovery(primary, discovery_lookup()):
            return RuntimeRepositoryFilesystemBackend(read_only_repository=True), activate_repository_backend(thread_backend, layout)
        discovery = ensure_repository_discovery(
            thread_backend,
            repository_id=primary_repository_id,
            commit_sha=context["repositoryCommit"],
            source_path_prefix=context.get("sourcePathPrefix"),
            graph_index_version=graph_stamp,
        )
        if discovery_sink is not None:
            discovery_sink(discovery)
        return RuntimeRepositoryFilesystemBackend(read_only_repository=True), activate_repository_backend(thread_backend, layout)

    # Several repositories: each one is discovered from its own directory. The shared graph names files by
    # repository directory, so a repository's relative paths need its key. The API files every artifact under
    # the pinned repository its coordinates identify.
    for pin in pins:
        if discovery_lookup is not None and reusable_discovery(pin, discovery_lookup(pin.key)):
            continue
        discovery = ensure_repository_discovery(
            thread_backend,
            repository_id=repository_id_of(pin),
            commit_sha=pin.commit_sha,
            source_path_prefix=pin.source_path_prefix,
            graph_index_version=graph_stamp,
            workspace_path=pin.root,
            discovery_path=runtime_path(pin, "repository_discovery.json"),
            graph_project=graph_identity.project_id if graph_identity is not None else None,
            graph_path_prefix=f"{pin.key}/",
        )
        if discovery_sink is not None:
            discovery_sink(discovery)
    return RuntimeRepositoryFilesystemBackend(read_only_repository=True), activate_repository_backend(thread_backend, layout)


@contextlib.contextmanager
def postgres_checkpointer():
    """Business purpose: Persist the Root's canonical checkpoints with measured database health.

    Business rules:
    - Production HITL uses the existing PostgreSQL saver and unchanged native thread/ancestry.
    Execution flow:
    1. Resolve the shared checkpoint URL and open/setup the measured native saver.
    2. Yield it for the Root lifetime and close it after execution drains.
    Failure cases:
    - Missing persistence or saver failure prevents native execution; failures never count as healthy metrics.
    Side effects:
    - Opens native persistence and records aggregate operation timing without copying checkpoint contents.
    """
    # The same normalization the Agent Server applies: production shares Prisma's DATABASE_URL, whose
    # `?schema=public` query parameter libpq/psycopg rejects ("invalid URI query parameter").
    url = checkpoint_database_url(os.getenv("LANGGRAPH_CHECKPOINT_DATABASE_URL"))
    if not url:
        raise RuntimeError("LANGGRAPH_CHECKPOINT_DATABASE_URL is required for Assessment Root")
    from tools.common.capabilities.agent_runtime.root_capacity import MeasuredPostgresSaver

    from psycopg.conninfo import make_conninfo
    with MeasuredPostgresSaver.from_conn_string(make_conninfo(url, application_name="lcsp-assessment-root-checkpoint")) as saver:
        saver.setup()
        yield saver


class AssessmentRootBoundary(AgentBoundaryBase):
    """One queue message starts one Root execution; the API owns every state transition."""

    boundary_source = ASSESSMENT_ROOT_BOUNDARY_SOURCE
    source_event = ASSESSMENT_ROOT_COMMAND
    requires_rbac = False

    def __init__(self, config, rbac_client=None, client: Any | None = None, runner=None) -> None:
        super().__init__(config, rbac_client)
        # Production creates one client per boundary execution and binds the canonical
        # outbox trace at construction, so every tool call and heartbeat keeps that identity.
        self._client_factory = lambda correlation_id: client or AssessmentRuntimeClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
            correlation_id=correlation_id,
        )
        self._runner = runner or run_assessment_root

    def handle(self, message: dict[str, Any], correlationId: str) -> dict[str, Any]:
        """Business purpose: Deliver one Root command through canonical API and checkpoint authority.

        Business rules:
        - Held/stale commands do not duplicate work; uncertain crash steps remain quarantined for explicit operator replay.
        - Legal decisions, paid admission and physical quiescence keep their existing independent guards.
        - Trusted process-local restrictions apply only to the exact audit command inside an admitted native scope.
        Execution flow:
        1. Validate Assessment identity and open the existing native saver/store.
        2. Execute or safely settle the Root; surface an operator-required recovery as terminal transport failure.
        Failure cases:
        - Invalid identity and unsafe recovery are non-retryable; transient API failures preserve durable retry.
        Side effects:
        - May execute the native Root and settle its API state; never creates another workflow authority.
        """
        assessment_id = message.get("assessmentId")
        if not isinstance(assessment_id, str) or not assessment_id.strip():
            # A malformed command can never become valid by redelivery.
            raise NonRetryableAgentBoundaryError("assessment root command has no assessmentId")
        try:
            with postgres_checkpointer() as saver:
                try:
                    store = get_store()
                except RuntimeError:
                    # Direct provider-free callers have no surrounding native runtime.
                    if os.getenv("LCSP_AGENT_RUNTIME_MODE") == "production":
                        raise
                    store = None
                from assessment_root.execution_policy import root_runner_options

                # The broker/invocation layer already resolved the canonical command
                # correlation ID; passing it through avoids starting a second Python trace.
                client = self._client_factory(correlationId)
                runner_options = {
                    "backend_factory": partial(
                        sandbox_backend_factory,
                        discovery_sink=client.post_repository_discovery,
                        discovery_lookup=client.repository_discovery_summary,
                    )
                }
                runner_options.update(root_runner_options(message, client))
                result = self._runner(
                    client,
                    assessment_id.strip(),
                    checkpointer=saver,
                    store=store,
                    **runner_options,
                )
                if result.get("errorType") == NativeRootRecoveryRequired.__name__:
                    raise NonRetryableAgentBoundaryError(NativeRootRecoveryRequired.__name__)
                return result
        except AssessmentApiError as error:
            if error.code in {_LEASE_HELD, _NOT_ACTIVE}:
                # Already running, or no longer ACTIVE: a duplicate/stale delivery, not an error.
                return {"state": "SKIPPED", "reason": error.code}
            if error.retryable:
                raise
            raise NonRetryableAgentBoundaryError(f"assessment root rejected: {error.code}") from error
