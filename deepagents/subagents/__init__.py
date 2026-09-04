"""LCSP Deep Agents subagent registry.

Each specialist owns its definition under ``subagents/<name>/definition.py`` so model,
prompt and tool boundaries remain reviewable independently. Legal Triage is a proactive
legal-intelligence specialist and is intentionally not an assessment pipeline node.
"""

from subagents.interview.definition import SUBAGENT as INTERVIEW_SUBAGENT
from subagents.interview.definition import TOOLS as INTERVIEW_TOOLS
from subagents.investigator.definition import SUBAGENT as INVESTIGATOR_SUBAGENT
from subagents.investigator.definition import TOOLS as INVESTIGATOR_TOOLS
from subagents.planner.definition import SUBAGENT as PLANNER_SUBAGENT
from subagents.planner.definition import TOOLS as PLANNER_TOOLS
from subagents.triage.definition import SUBAGENT as TRIAGE_SUBAGENT
from subagents.triage.definition import TOOLS as TRIAGE_TOOLS

FLOW_SUBAGENTS = [
    TRIAGE_SUBAGENT,
    INTERVIEW_SUBAGENT,
    PLANNER_SUBAGENT,
    INVESTIGATOR_SUBAGENT,
]

__all__ = [
    "FLOW_SUBAGENTS",
    "INTERVIEW_SUBAGENT",
    "INTERVIEW_TOOLS",
    "INVESTIGATOR_SUBAGENT",
    "INVESTIGATOR_TOOLS",
    "PLANNER_SUBAGENT",
    "PLANNER_TOOLS",
    "TRIAGE_SUBAGENT",
    "TRIAGE_TOOLS",
]
