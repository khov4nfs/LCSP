"""LCSP Deep Agents subagent registry.

Each specialist owns its definition under ``subagents/<name>/definition.py`` so model,
prompt and tool boundaries remain reviewable independently. Legal authoring is not a
subagent: the Legal Preparation Deep Agent in ``legal_preparation/`` owns it.
"""

from subagents.interview.definition import SUBAGENT as INTERVIEW_SUBAGENT
from subagents.interview.definition import TOOLS as INTERVIEW_TOOLS
from subagents.repository_analyst.definition import SUBAGENT as REPOSITORY_ANALYST_SUBAGENT
from subagents.repository_analyst.definition import TOOLS as REPOSITORY_ANALYST_TOOLS

FLOW_SUBAGENTS = [
    INTERVIEW_SUBAGENT,
    REPOSITORY_ANALYST_SUBAGENT,
]

__all__ = [
    "FLOW_SUBAGENTS",
    "INTERVIEW_SUBAGENT",
    "INTERVIEW_TOOLS",
    "REPOSITORY_ANALYST_SUBAGENT",
    "REPOSITORY_ANALYST_TOOLS",
]
