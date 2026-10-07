"""Consume the canonical Legal Preparation command and run the single agent."""

from __future__ import annotations

from typing import Any

from tools.common.capabilities.agent_runtime.boundary import (
    AgentBoundaryBase,
    NonRetryableAgentBoundaryError,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient

from legal_preparation.runner import run_legal_preparation

LEGAL_PREPARATION_COMMAND = "command.legal-portfolio.preparation.requested.v1"
LEGAL_PREPARATION_BOUNDARY_SOURCE = "legal.legal-portfolio-preparation"


class LegalPreparationBoundary(AgentBoundaryBase):
    """One queue message starts one run; the API owns every state transition."""

    boundary_source = LEGAL_PREPARATION_BOUNDARY_SOURCE
    source_event = LEGAL_PREPARATION_COMMAND
    requires_rbac = False

    def __init__(self, config, rbac_client=None, api_client: Any | None = None, runner=None) -> None:
        super().__init__(config, rbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url, config.worker_api_key
        )
        self._runner = runner or run_legal_preparation

    def handle(self, message: dict[str, Any], correlationId: str) -> dict[str, Any]:
        run_id = message.get("preparationRunId")
        if not isinstance(run_id, str) or not run_id.strip():
            # A malformed command can never become valid by redelivery.
            raise NonRetryableAgentBoundaryError("legal preparation command has no preparationRunId")
        return self._runner(self._api_client, run_id.strip())
