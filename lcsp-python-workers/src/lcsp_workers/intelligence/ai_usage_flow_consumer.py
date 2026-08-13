from __future__ import annotations

from typing import Any

from lcsp_workers.agentic_evidence import AgenticToolResolver
from structlog import get_logger

from lcsp_workers.llm.gateway_client import LLMGatewayClient
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.queue_consumer import ConsumerBase

from .ai_usage_flow_graph import AIUsageFlowGraph
from .ai_usage_flow_rule_engine import AIUsageFlowRuleEngine
from .ai_usage_flow_proposer import AIUsageFlowModelAssistedProposer


logger = get_logger(__name__)


class AIUsageFlowConsumer(ConsumerBase):
    queue_name = "intelligence.technical-profile-ready"
    routing_key = "event.technical-profile.ready.v1"
    requires_pbac = False

    def __init__(
        self,
        config,
        pbac_client=None,
        api_client: WorkerApiClient | None = None,
        rule_engine: AIUsageFlowRuleEngine | None = None,
        llm_client: LLMGatewayClient | None = None,
        agentic_tool_resolver: AgenticToolResolver | None = None,
    ) -> None:
        super().__init__(config, pbac_client)
        self._api_client = api_client or WorkerApiClient(
            config.nestjs_api_base_url,
            config.worker_api_key,
        )
        self._rule_engine = rule_engine or AIUsageFlowRuleEngine()
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
        return self._graph.required_message_id(message, key)
