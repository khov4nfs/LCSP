"""LCSP Deep Agents subagent registry.

Each specialist owns its definition under ``subagents/<name>/definition.py`` so model,
prompt and tool boundaries remain reviewable independently. Legal Triage is a proactive
legal-intelligence specialist and is intentionally not an assessment pipeline node.
"""

from orchestration.pipeline import NODE_TOOL_NAMES
from subagents.context_wizard.definition import SUBAGENT as CONTEXT_WIZARD_SUBAGENT
from subagents.context_wizard.definition import TOOLS as CONTEXT_WIZARD_TOOLS
from subagents.investigator.definition import SUBAGENT as INVESTIGATOR_SUBAGENT
from subagents.investigator.definition import TOOLS as INVESTIGATOR_TOOLS
from subagents.planner.definition import SUBAGENT as PLANNER_SUBAGENT
from subagents.planner.definition import TOOLS as PLANNER_TOOLS
from subagents.resolver.definition import SUBAGENT as RESOLVER_SUBAGENT
from subagents.resolver.definition import TOOLS as RESOLVER_TOOLS
from subagents.triage.definition import SUBAGENT as TRIAGE_SUBAGENT
from subagents.triage.definition import TOOLS as TRIAGE_TOOLS


def _tool_names(tools: list[object]) -> tuple[str, ...]:
    return tuple(str(getattr(tool, "name")) for tool in tools)


_ASSESSMENT_ROLE_TOOLS = {
    "context_wizard": CONTEXT_WIZARD_TOOLS,
    "planner": PLANNER_TOOLS,
    "investigator": INVESTIGATOR_TOOLS,
    "resolver": RESOLVER_TOOLS,
}
for role, tools in _ASSESSMENT_ROLE_TOOLS.items():
    if _tool_names(tools) != NODE_TOOL_NAMES[role]:
        raise RuntimeError(f"{role} tools drifted from the canonical assessment pipeline manifest")

if _tool_names(TRIAGE_TOOLS) != ("maintain_legal_catalog",):
    raise RuntimeError("triage tools drifted from the proactive legal-maintenance contract")


FLOW_SUBAGENTS = [
    TRIAGE_SUBAGENT,
    CONTEXT_WIZARD_SUBAGENT,
    PLANNER_SUBAGENT,
    INVESTIGATOR_SUBAGENT,
    RESOLVER_SUBAGENT,
]

__all__ = [
    "CONTEXT_WIZARD_SUBAGENT",
    "CONTEXT_WIZARD_TOOLS",
    "FLOW_SUBAGENTS",
    "INVESTIGATOR_SUBAGENT",
    "INVESTIGATOR_TOOLS",
    "PLANNER_SUBAGENT",
    "PLANNER_TOOLS",
    "RESOLVER_SUBAGENT",
    "RESOLVER_TOOLS",
    "TRIAGE_SUBAGENT",
    "TRIAGE_TOOLS",
]
