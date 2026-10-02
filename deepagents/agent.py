"""Local Deep Agents entry point for LCSP.

The root agent is the supervisor. LangGraph hosts the graph locally while LCSP
owns repository sandboxing and event dispatch.
"""

import os
from pathlib import Path

from langsmith_bootstrap import disable_langsmith_tracing_by_default

disable_langsmith_tracing_by_default()

from deepagents import create_deep_agent
from langchain.agents.middleware import TodoListMiddleware

from harness import configure_lcsp_harness
from middleware.model_governance import (
    MODEL_GOVERNANCE_MIDDLEWARE,
    governed_general_purpose_subagent,
)
from middleware.usage_metering import AgentRoleMiddleware
from middleware.runtime_context import inject_lcsp_runtime_context
from middleware.specialist_handoff_validation import validate_lcsp_specialist_task_handoff
from middleware.system_event_dispatch import dispatch_agent_runtime_system_event
from middleware.triage_singleton import guard_triage_singleton_task
from model_policy import effective_model_configs, resolve_agent_model
from orchestration.context import LCSPRunContext
from subagents import TRIAGE_SUBAGENT
from tools.mcp import load_optional_mcp_tools
from tools.common.capabilities.platform.repository_sandbox import (
    REPOSITORY_SKILLS,
    RuntimeRepositoryBackend,
)
from tools.common.capabilities.platform.logging import (
    get_logger,
    suppress_langgraph_heartbeat_logs,
)


ROOT_TOOLS = [*load_optional_mcp_tools()]
SYSTEM_PROMPT = (Path(__file__).with_name("instructions.md")).read_text(
    encoding="utf-8"
)


# Register the same full harness profile for every configured model route; models
# themselves are built per role by model_policy.resolve_agent_model.
configure_lcsp_harness()
suppress_langgraph_heartbeat_logs()
logger = get_logger(__name__)
for model_config in effective_model_configs():
    logger.info(
        "LCSP_EFFECTIVE_MODEL_CONFIG",
        role=model_config["role"],
        route_id=model_config["routeId"],
        provider=model_config["provider"],
        model=model_config["model"],
        client=model_config["client"],
        option_keys=model_config["optionKeys"],
        fallback_route_ids=model_config["fallbackRouteIds"],
    )

if os.environ.get("LCSP_LOCAL_GRAPH_DEV") == "1":
    # LangGraph dev's blocking-call detector rejects deepagents' editable-version
    # filesystem scan while Studio requests graph metadata.
    import deepagents._version as deepagents_version
    import deepagents.graph as deepagents_graph

    deepagents_version._lc_version = lambda: deepagents_version.__version__
    deepagents_graph._lc_version = deepagents_version._lc_version


def create_root_agent(*, checkpointer=None, store=None):
    """Build the native LCSP Deep Agent graph for local or hosted runtimes."""
    root_model = resolve_agent_model("root")
    return create_deep_agent(
        name="lcsp-agent",
        model=root_model,
        tools=ROOT_TOOLS,
        backend=RuntimeRepositoryBackend(),
        skills=[(REPOSITORY_SKILLS, "LCSP Runtime")],
        system_prompt=SYSTEM_PROMPT,
        middleware=[
            dispatch_agent_runtime_system_event,
            guard_triage_singleton_task,
            validate_lcsp_specialist_task_handoff,
            inject_lcsp_runtime_context,
            AgentRoleMiddleware("root"),
            *MODEL_GOVERNANCE_MIDDLEWARE,
            TodoListMiddleware(),
        ],
        context_schema=LCSPRunContext,
        subagents=[
            # LEGAL_MAINTENANCE only. repository-analyst / interview are run by the
            # deterministic assessment loop through RootSubagentDispatcher, never `task`.
            {**TRIAGE_SUBAGENT, "model": resolve_agent_model("triage")},
            governed_general_purpose_subagent(root_model, role="root"),
        ],
        checkpointer=checkpointer,
        store=store,
    )


agent = create_root_agent()
