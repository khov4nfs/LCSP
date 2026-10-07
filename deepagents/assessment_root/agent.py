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

from assessment_root.researcher import researcher_subagent
from assessment_root.tools import RootRun, build_root_tools
from legal_preparation.agent import _lookup_profile_key, _without_general_purpose_subagent

ROOT_INSTRUCTIONS = (Path(__file__).with_name("instructions.md")).read_text(encoding="utf-8")
ASSESSMENT_ROOT_ROLE = "assessment-root"
# Search-only graph tools (get_code_snippet mints legacy per-rule refs, so it is excluded).
_GRAPH_TOOL_NAMES = {"search_code_graph", "trace_call_path", "search_code_text", "get_repository_architecture"}


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
            middleware=[*governance, *middleware],
            checkpointer=checkpointer,
            store=store,
        )
