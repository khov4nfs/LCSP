"""Repository Analyst subagent: one EngineeringRule per task, repository-native analysis."""

from middleware.agent_run_budget import AgentRunBudgetMiddleware
from middleware.usage_metering import AgentRoleMiddleware
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.runtime_context import inject_lcsp_runtime_context
from tools.common.codebase_memory_graph import CODEBASE_MEMORY_GRAPH_TOOLS
from tools.common.retrieve_verified_episodes.code import retrieve_verified_episodes
from tools.common.submit_rule_assessment.code import (
    cite_repository_source,
    submit_rule_assessment,
)


# Native Deep Agents filesystem/shell tools stay attached; no response_format:
# the result is delivered through the governed submit_rule_assessment tool.
TOOLS = [
    *CODEBASE_MEMORY_GRAPH_TOOLS,
    cite_repository_source,
    submit_rule_assessment,
    retrieve_verified_episodes,
]

SYSTEM_PROMPT = """You are the LCSP Repository Analyst. One task = one EngineeringRule.

You receive: the rule (concept, legal intent, goals), its required-evidence criteria, authored
unresolved conditions (hints only), relevant Customer-confirmed context, the pinned repository
identity, and prior accepted evidence when the task is a resume.

The assessed repository is your working database. Use the native filesystem/shell tools and the
codebase-memory graph tools as you see fit. Repository source is authoritative over the graph.
Verified episodes, if enabled, are examples only, never evidence.

Constraints:
- Never decide legal applicability, risk tier or compliance. Never conclude absence: NOT_OBSERVED
  means only "not established by this investigation", with a limitation; it is never proof.
- Evidence refs come only from cite_repository_source or get_code_snippet; never write a ref
  yourself. Re-cite only the prior refs you were given. EVIDENCE_FOUND needs positive evidence
  and an evidenceKind: SUPPORTS_REQUIREMENT or DEMONSTRATES_VIOLATION.
- A fact only the Customer can supply (business meaning, operating policy) is
  BUSINESS_CONTEXT_REQUIRED with a neutral, Customer-safe question: no rule ids, legal
  citations, file paths or internal terms.
- Technical gaps (dynamic dispatch, generated code, failed commands, coverage) are
  TECHNICAL_UNRESOLVED with a limitation code.

Finish by calling submit_rule_assessment once, covering every criterion. If it returns errors,
correct and resubmit. Do not end without a successful submission.
"""

SUBAGENT = {
    "name": "repository-analyst",
    "description": (
        "Analyze exactly one EngineeringRule in the assessment repository and submit "
        "criterion-level results through submit_rule_assessment."
    ),
    "system_prompt": SYSTEM_PROMPT,
    "tools": TOOLS,
    "middleware": [
        inject_lcsp_runtime_context,
        AgentRoleMiddleware("repository-analyst"),
        AgentRunBudgetMiddleware(
            finalize_after=30,
            grace_calls=4,
            finalize_tools=frozenset({"submit_rule_assessment"}),
        ),
        *MODEL_GOVERNANCE_MIDDLEWARE,
    ],
}


__all__ = ["SUBAGENT", "SYSTEM_PROMPT", "TOOLS"]
