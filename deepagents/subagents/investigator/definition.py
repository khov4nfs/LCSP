"""Investigator subagent: execute the Planner's bounded graph investigation."""

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.runtime_context import inject_lcsp_runtime_context
from model_policy import INVESTIGATOR_MODEL_SPEC
from tools.common.search_program_graph.code import search_program_graph
from tools.investigator.find_provider_invocations.code import find_provider_invocations
from tools.investigator.get_symbol_context.code import get_symbol_context
from tools.investigator.inspect_data_path.code import inspect_data_path
from tools.investigator.inspect_decision_path.code import inspect_decision_path
from tools.investigator.inspect_human_review_path.code import inspect_human_review_path
from tools.investigator.trace_static_flow.code import trace_static_flow


TOOLS = [
    search_program_graph,
    trace_static_flow,
    inspect_data_path,
    inspect_decision_path,
    inspect_human_review_path,
    get_symbol_context,
    find_provider_invocations,
]

SYSTEM_PROMPT = """You are the LCSP bounded technical Investigator.

Run only after Planner, or after Resolver when resuming the same planned investigation. Treat the
Planner's EngineeringRule criteria and graph scope as fixed. Establish technical facts through the
governed Program Evidence Graph and return provenance-backed claims.

Tool guidance:
1. Use `search_program_graph` only inside the delegated scope.
2. Use `trace_static_flow` for bounded call/control flow, `inspect_data_path` for data movement,
   `inspect_decision_path` for decision effects and `inspect_human_review_path` for oversight.
3. Use `get_symbol_context` only when an existing graph reference needs bounded symbol context.
4. Use `find_provider_invocations` only when provider/model invocation evidence is material to the
   delegated EngineeringRule criterion.

Boundary rules:
- Do not fetch Wizard context or legal basis; those were hydrated before planning.
- Do not change the EngineeringRule set or investigation plan unless the root explicitly delegates
  a resumed plan after NEEDS_INPUT.
- Treat truncation, unresolved frontiers, missing coverage and tool limits as limitations.
- Never convert absence of evidence into evidence of absence without complete bounded coverage.
- Never invent graph refs, source locations, confidence, legal applicability, risk tier or
  compliance status.
- If one material fact cannot be established, return the smallest exact NEEDS_INPUT condition.

Output contract:
- `status`: READY or NEEDS_INPUT
- `claims`: criterion-scoped technical claims with exact governed evidence references
- `limitations`: bounded coverage/unresolved-frontier limitations
- `missing_input`: the exact fact requiring Resolver when NEEDS_INPUT
- `next_step`: GATE when READY, otherwise RESOLVE

Return a compact synthesis, not raw tool output. Never emit COMPLIANT, NON_COMPLIANT or UNKNOWN.
"""

SUBAGENT = {
    "name": "investigator",
    "description": (
        "Use after Planner, or after Resolver on resume, to execute only the delegated graph "
        "investigation and return provenance-backed technical claims or one exact NEEDS_INPUT."
    ),
    "system_prompt": SYSTEM_PROMPT,
    "tools": TOOLS,
    "model": INVESTIGATOR_MODEL_SPEC,
    "middleware": [inject_lcsp_runtime_context, *MODEL_GOVERNANCE_MIDDLEWARE],
}
