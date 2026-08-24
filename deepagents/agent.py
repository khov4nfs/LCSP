"""Managed Deep Agents entry point for LCSP.

The root agent is the supervisor. Managed Deep Agents injects the project
``instructions.md`` system prompt and thread checkpointer; this definition adds
per-run context, TodoList planning and the bounded LCSP subagent pipeline.
"""

from managed_deepagents import define_deep_agent

from harness import LCSP_FILESYSTEM_PERMISSIONS, LCSP_MODEL_SPEC, configure_lcsp_harness
from middleware.runtime_context import inject_lcsp_runtime_context
from orchestration.context import LCSPRunContext
from orchestration.pipeline import ORCHESTRATION_TOOL_NAMES
from orchestration.todos import ROOT_TODO_MIDDLEWARE
from subagents import FLOW_SUBAGENTS
from tools.orchestration.request_targeted_reanalysis.code import (
    request_targeted_reanalysis,
)


ROOT_TOOLS = [request_targeted_reanalysis]

if tuple(tool.name for tool in ROOT_TOOLS) != ORCHESTRATION_TOOL_NAMES:
    raise RuntimeError("root orchestration tools drifted from the canonical pipeline manifest")


# Register the same restricted harness profile for the root and every child model.
configure_lcsp_harness()


agent = define_deep_agent(
    name="lcsp-agent",
    model=LCSP_MODEL_SPEC,
    tools=ROOT_TOOLS,
    middleware=[
        inject_lcsp_runtime_context,
        ROOT_TODO_MIDDLEWARE,
    ],
    context_schema=LCSPRunContext,
    subagents=FLOW_SUBAGENTS,
    permissions=LCSP_FILESYSTEM_PERMISSIONS,
    interrupt_on={
        "request_targeted_reanalysis": True,
    },
)
