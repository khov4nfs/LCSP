"""``create_assessment_root_agent``: the ONLY assessment reasoning entrypoint.

One Deep Agent per assessment, bound to the server-owned Root thread. It plans natively, may
delegate to the bounded read-only ``repository-researcher`` via native ``task()``, and reaches the
assessment domain only through the governed tools of :mod:`assessment_root.tools`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Sequence

from deepagents import create_deep_agent
from deepagents.middleware.filesystem import FilesystemPermission
from langchain.agents.middleware import AgentMiddleware, AgentState, TracePolicy, hook_config, omit_payload
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.runtime import Runtime

from assessment_root.researcher import researcher_subagent
from assessment_root.tools import RootRun, build_root_tools
from rule_set_preparation.agent import _lookup_profile_key, _without_general_purpose_subagent
from orchestration.graph_execution import agent_graph_config
from tools.common.capabilities.platform.logging import get_logger

ROOT_INSTRUCTIONS = (Path(__file__).with_name("instructions.md")).read_text(encoding="utf-8")
ASSESSMENT_ROOT_ROLE = "assessment-root"
# Graph tools search; governed Root tools mint accepted source references.
_GRAPH_TOOL_NAMES = {"search_code_graph", "trace_call_path", "search_code_text", "get_repository_architecture"}
logger = get_logger(__name__)


class AssessmentCompletionMiddleware(AgentMiddleware):
    """Only API-owned COMPLETE ends the persistent workflow without an interrupt."""

    # Native response_format validates response shape, not API lifecycle; native hooks route on that predicate.

    trace_policy = TracePolicy(process_inputs=omit_payload, process_outputs=omit_payload)

    def __init__(self, run: RootRun) -> None:
        self.run = run

    @hook_config(can_jump_to=["end"])
    def before_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        if self.run.client.context()["lifecycleState"] == "COMPLETE":
            return {"jump_to": "end"}
        return None

    @hook_config(can_jump_to=["model"])
    def after_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        response = state["messages"][-1]
        if not isinstance(response, AIMessage) or response.tool_calls:
            return None
        context = self.run.client.context()
        if context["lifecycleState"] == "COMPLETE":
            return None
        if context["openHumanRequestIds"]:
            raise RuntimeError("open human blockers without a native interrupt")
        logger.info("ASSESSMENT_ROOT_CONTINUING", assessment_id=self.run.assessment_id,
                    execution_id=self.run.execution_id, lifecycle_state=context["lifecycleState"])
        return {
            "messages": [HumanMessage(content=(
                "The API has not confirmed this assessment COMPLETE. Continue this same "
                "assessment and preserve accepted evidence and decisions. Reload governed "
                "context, resolve remaining pinned rules, request_finalization, then "
                "submit_final_report when the Completion Gate permits it. Use native tools, "
                "not tool-call text. Use the native human request interrupt for missing "
                "customer facts; do not infer lifecycle completion from your response."
            ))],
            "jump_to": "model",
        }


def root_permissions() -> list[FilesystemPermission]:
    """The pinned repository is read-only; only the scratch area is writable."""
    return [
        FilesystemPermission(["write"], ["/.lcsp/**"], mode="allow"),
        FilesystemPermission(["read"], ["/**"], mode="allow"),
        FilesystemPermission(["write"], ["/**"], mode="deny"),
    ]


def _graph_tools() -> list[Any]:
    from tools.common.codebase_memory_graph import CODEBASE_MEMORY_GRAPH_TOOLS

    return [tool for tool in CODEBASE_MEMORY_GRAPH_TOOLS if tool.name in _GRAPH_TOOL_NAMES]


def create_assessment_root_agent(
    *,
    run: RootRun,
    model: Any | None = None,
    checkpointer: Any | None = None,
    store: Any | None = None,
    governance: Sequence[Any] | None = None,
    graph_tools: list[Any] | None = None,
    middleware: Sequence[Any] = (),
):
    """Build the Root for one execution of one assessment.

    ``run.backend`` is the pinned repository database (read-only view); ``checkpointer`` must be
    keyed by the server thread (``run.thread_id``) at invoke time.
    """
    if model is None:
        from model_policy import resolve_agent_model

        model = resolve_agent_model(ASSESSMENT_ROOT_ROLE)
    if governance is None:
        from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
        from middleware.usage_metering import AgentRoleMiddleware

        governance = [AgentRoleMiddleware(ASSESSMENT_ROOT_ROLE), *MODEL_GOVERNANCE_MIDDLEWARE]
    from middleware.localization import ResponseLocalizationMiddleware
    from orchestration.context import LCSPRunContext

    tools = graph_tools if graph_tools is not None else _graph_tools()
    # The default general-purpose subagent would inherit the governed tools; disable it so the
    # researcher is the only delegate and it holds none of them.
    with _without_general_purpose_subagent(_lookup_profile_key(model)):
        return create_deep_agent(
            name="lcsp-assessment-root",
            model=model,
            backend=run.backend,
            system_prompt=ROOT_INSTRUCTIONS,
            tools=[*build_root_tools(run), *tools],
            subagents=[researcher_subagent(tools)],
            permissions=root_permissions(),
            middleware=[ResponseLocalizationMiddleware(), *governance, AssessmentCompletionMiddleware(run), *middleware],
            context_schema=LCSPRunContext,
            checkpointer=checkpointer,
            store=store,
        ).with_config(agent_graph_config())
