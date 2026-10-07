"""Consume ``command.assessment.root.requested.v1`` and run the assessment's one Root."""

from __future__ import annotations

import contextlib
import os
from typing import Any

from assessment_root.client import AssessmentApiError, AssessmentRuntimeClient
from assessment_root.runner import run_assessment_root
from tools.common.capabilities.agent_runtime.boundary import (
    AgentBoundaryBase,
    NonRetryableAgentBoundaryError,
)

ASSESSMENT_ROOT_COMMAND = "command.assessment.root.requested.v1"
ASSESSMENT_ROOT_BOUNDARY_SOURCE = "assessment.root-run"
# The API owns lease/duplicate semantics: a held lease means the Root is already running.
_LEASE_HELD = "ASSESSMENT_EXECUTION_LEASE_HELD"
_NOT_ACTIVE = "ASSESSMENT_NOT_ACTIVE"


def sandbox_backend_factory(claim: dict[str, Any], context: dict[str, Any]):
    """Hydrate the pinned snapshot into the assessment's thread sandbox (deterministic runtime)."""
    from tools.common.capabilities.platform.repository_sandbox import (
        activate_repository_backend,
        hydrate_repository,
        resolve_repository_thread_backend,
        RuntimeRepositoryBackend,
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
    )
    return RuntimeRepositoryBackend(), activate_repository_backend(thread_backend)


@contextlib.contextmanager
def postgres_checkpointer():
    """The LangGraph checkpointer keyed by the server thread; absent URL => no persistence."""
    url = os.getenv("LANGGRAPH_CHECKPOINT_DATABASE_URL")
    if not url:
        yield None
        return
    from langgraph.checkpoint.postgres import PostgresSaver

    with PostgresSaver.from_conn_string(url) as saver:
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
        assessment_id = message.get("assessmentId")
        if not isinstance(assessment_id, str) or not assessment_id.strip():
            # A malformed command can never become valid by redelivery.
            raise NonRetryableAgentBoundaryError("assessment root command has no assessmentId")
        try:
            with postgres_checkpointer() as saver:
                return self._runner(
                    self._client_factory(),
                    assessment_id.strip(),
                    backend_factory=sandbox_backend_factory,
                    checkpointer=saver,
                )
        except AssessmentApiError as error:
            if error.code in {_LEASE_HELD, _NOT_ACTIVE}:
                # Already running, or no longer ACTIVE: a duplicate/stale delivery, not an error.
                return {"state": "SKIPPED", "reason": error.code}
            if error.retryable:
                raise
            raise NonRetryableAgentBoundaryError(f"assessment root rejected: {error.code}") from error
