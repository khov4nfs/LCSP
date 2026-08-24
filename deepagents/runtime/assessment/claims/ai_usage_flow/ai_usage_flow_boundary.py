"""Consume technical-profile events and orchestrate AI usage flow construction."""

from __future__ import annotations

from typing import Any

from tools.common.agentic_evidence import AgenticToolResolver
from structlog import get_logger

from tools.common.llm import LLMClientProtocol
from tools.common.platform.api_client import WorkerApiClient
from tools.common.managed.boundary import AgentBoundaryBase

from .ai_usage_flow_graph import AIUsageFlowGraph
from .ai_usage_flow_rule_engine import AIUsageFlowRuleEngine
from .ai_usage_flow_proposer import AIUsageFlowModelAssistedProposer
from .engineering_claim_adapter import EngineeringAwareAIUsageFlowRuleEngine


logger = get_logger(__name__)


class AIUsageFlowBoundary(AgentBoundaryBase):
    """Bridge a ready TechnicalProfile into the governed AIUsageFlow graph."""

    boundary_source = "intelligence.technical-profile-ready"
    source_event = "event.technical-profile.ready.v1"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        rule_engine: AIUsageFlowRuleEngine | None = None,
        llm_client: LLMClientProtocol | None = None,
        agentic_tool_resolver: AgenticToolResolver | None = None,
    ) -> None:
        """Create the boundary with deterministic rules and optional model assistance.

        Args:
            config: Managed Agent runtime configuration.
            pbac_client: Optional base-boundary PBAC dependency.
            api_client: Optional internal API client override.
            rule_engine: Optional deterministic AI-usage rule engine override.
            llm_client: Optional LLM client used for bounded proposals only.
            agentic_tool_resolver: Optional read-only agentic evidence resolver made
                available to the model-assisted proposer.
        """
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._rule_engine = EngineeringAwareAIUsageFlowRuleEngine(
            rule_engine or AIUsageFlowRuleEngine()
        )
        self._graph = AIUsageFlowGraph(
            api_client=self._api_client,
            rule_engine=self._rule_engine,
            proposer=AIUsageFlowModelAssistedProposer(
                llm_client,
                agentic_tool_resolver=agentic_tool_resolver,
            )
            if llm_client
            else None,
            checkpoint_url=config.langgraph_checkpoint_database_url,
            logger=logger,
        )

    def handle(self, message: dict, correlationId: str) -> None:
        """Run the AI usage flow graph and log the persisted artifact result.

        Args:
            message: Technical-profile-ready event payload.
            correlationId: End-to-end trace identifier for this delivery.
        """
        result = self._graph.run(message=message, correlationId=correlationId)
        logger.info(
            "AI_USAGE_FLOW_CALLBACK_SUBMITTED",
            technical_profile_id=result.flow.technical_profile_id,
            assessment_id=result.flow.assessment_id,
            status=result.flow.status,
            workflow_run_id=result.workflow_run_id,
            correlationId=correlationId,
        )

    def _required_message_id(self, message: dict[str, Any], key: str) -> str:
        """Delegate required event-identifier normalization to the graph contract."""
        return self._graph.required_message_id(message, key)
