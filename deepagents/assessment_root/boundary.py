"""Consume ``command.assessment.root.requested.v1`` and run the assessment's one Root."""

from __future__ import annotations

import contextlib
import os
from typing import Any
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


def sandbox_backend_factory(claim: dict[str, Any], context: dict[str, Any]):
    """Business purpose: Mount the Assessment's pinned source on its durable Root thread for native investigation.

    Business rules:
    - Hydrate only the API-issued snapshot/job/commit and immutable source prefix for this Assessment and server-owned thread.
    - Scope filtering preserves original source paths and excludes sibling projects before graph indexing.
    - Source and runtime identity metadata are read-only; writes are limited to the existing agent scratch subtree.
    - Graph lookup is an investigation aid indexed from this same hydrated source, not a legal authority.

    Execution flow:
    1. Resolve the thread sandbox and hydrate its pinned repository with source-view limitations.
    2. Ensure the source graph index is current and activate the repository backend for nested native tools.
    3. Return the file-only backend with its repository-write boundary enabled.

    Failure cases:
    - Missing or mismatched pins, hydration and indexing failures propagate before model investigation begins.

    Side effects:
    - Materializes the guarded source view and graph index in the thread sandbox; invokes no model or decision write.
    """
    from tools.common.capabilities.platform.codebase_memory import ensure_codebase_memory_index
    from tools.common.capabilities.platform.repository_sandbox import (
        activate_repository_backend,
        hydrate_repository,
        resolve_repository_thread_backend,
        RuntimeRepositoryFilesystemBackend,
    )

    thread_backend = resolve_repository_thread_backend(
        {"configurable": {"thread_id": claim["threadId"]}}
    )
    hydrate_repository(
        thread_backend,
        snapshot_id=context["repositorySnapshotId"],
        scan_job_id=context["repositoryScanJobId"],
        commit_sha=context["repositoryCommit"],
        assessment_id=context["assessmentId"],
        source_path_prefix=context.get("sourcePathPrefix"),
    )
    # The Root's graph tools query the Codebase Memory index of the hydrated snapshot; index it
    # before the Root starts (reused when current) so a run never silently lacks the graph.
    ensure_codebase_memory_index(thread_backend)
    from tools.common.capabilities.platform.repository_scanner import ensure_repository_profile
    ensure_repository_profile(
        thread_backend,
        repository_id=context.get("repositoryId") or context.get("repositoryFullName") or context["assessmentId"],
        commit_sha=context["repositoryCommit"],
        source_path_prefix=context.get("sourcePathPrefix"),
    )
    return RuntimeRepositoryFilesystemBackend(read_only_repository=True), activate_repository_backend(thread_backend)


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
        self._client_factory = lambda: client or AssessmentRuntimeClient(
            config.nestjs_api_base_url, config.worker_api_key
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

                client = self._client_factory()
                runner_options = {"backend_factory": sandbox_backend_factory}
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