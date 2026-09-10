"""Managed Deep Agents entry point for LCSP.

The root agent is the supervisor. Managed Deep Agents injects the project
``instructions.md`` system prompt and thread checkpointer; this definition adds
per-run context, TodoList planning and the bounded LCSP subagent pipeline.
"""

import os

from langsmith_bootstrap import disable_langsmith_tracing_by_default

disable_langsmith_tracing_by_default()

from langchain.agents.middleware import TodoListMiddleware
from managed_deepagents import define_deep_agent

from harness import LCSP_FILESYSTEM_PERMISSIONS, LCSP_MODEL_SPEC, configure_lcsp_harness
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.runtime_context import inject_lcsp_runtime_context
from middleware.specialist_handoff_validation import validate_lcsp_specialist_task_handoff
from middleware.triage_singleton import guard_triage_singleton_task
from model_policy import effective_model_configs
from orchestration.context import LCSPRunContext
from subagents import FLOW_SUBAGENTS
from tools.common.capabilities.platform.logging import (
    get_logger,
    suppress_langgraph_heartbeat_logs,
)
from tools.orchestration.request_targeted_reanalysis.code import (
    request_targeted_reanalysis,
)


ROOT_TOOLS = [request_targeted_reanalysis]


# Register provider-aware model construction plus the same restricted harness
# profile for the root and every child before Managed Deep Agents resolves specs.
configure_lcsp_harness()
suppress_langgraph_heartbeat_logs()
logger = get_logger(__name__)
for model_config in effective_model_configs():
    logger.info(
        "LCSP_EFFECTIVE_MODEL_CONFIG",
        role=model_config.role,
        provider=model_config.provider,
        model=model_config.model,
        source=model_config.source,
        client=model_config.client,
        router=model_config.router,
        tools=model_config.tools,
        reasoning_effort=model_config.reasoning_effort,
        reasoning_policy=model_config.reasoning_policy,
        output_version=model_config.output_version,
    )

if os.environ.get("MDA_LOCAL_DEV") == "1":
    # LangGraph dev's blocking-call detector rejects deepagents' editable-version
    # filesystem scan while Studio requests graph metadata.
    import deepagents._version as deepagents_version
    import deepagents.graph as deepagents_graph

    deepagents_version._lc_version = lambda: deepagents_version.__version__
    deepagents_graph._lc_version = deepagents_version._lc_version


agent = define_deep_agent(
    name="lcsp-agent",
    model=LCSP_MODEL_SPEC,
    tools=ROOT_TOOLS,
    middleware=[
        guard_triage_singleton_task,
        validate_lcsp_specialist_task_handoff,
        inject_lcsp_runtime_context,
        *MODEL_GOVERNANCE_MIDDLEWARE,
        TodoListMiddleware(),
    ],
    context_schema=LCSPRunContext,
    subagents=FLOW_SUBAGENTS,
    permissions=LCSP_FILESYSTEM_PERMISSIONS,
    interrupt_on={
        "request_targeted_reanalysis": True,
    },
)
