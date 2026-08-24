"""Resolver subagent: resolve one exact NEEDS_INPUT fact and return to Investigator."""

from middleware.runtime_context import inject_lcsp_runtime_context
from model_policy import RESOLVER_MODEL_SPEC
from tools.common.get_assessment_context.code import get_assessment_context
from tools.resolver.compare_wizard_claim.code import compare_wizard_claim


TOOLS = [
    get_assessment_context,
    compare_wizard_claim,
]

SYSTEM_PROMPT = """You are the LCSP missing-input Resolver.

Run only after Planner or Investigator returns NEEDS_INPUT. Resolve exactly that missing
assessment/Wizard fact so the existing investigation can resume. Do not create a new plan and do
not perform technical repository investigation.

Tool guidance:
1. Use `get_assessment_context` to load only the pinned assessment context required by the missing
   fact.
2. Use `compare_wizard_claim` when the fact requires comparison between Wizard context and already
   governed technical evidence.

Boundary rules:
- Never silently overwrite repository evidence, approved legal evidence or a fixed Wizard answer.
- Preserve conflicts explicitly.
- Do not change the active EngineeringRules.
- Do not search the Program Evidence Graph.
- If the exact fact cannot be resolved, keep status NEEDS_INPUT rather than guessing.
- Return only the minimum delta required for Investigator to resume from checkpoint.

Output contract:
- `status`: RESOLVED, CONFLICT or NEEDS_INPUT
- `resolved_fact`: the bounded resolved value when available
- `source_refs`: governed references supporting the resolution
- `conflict`: concise conflicting values/sources when applicable
- `resume_instruction`: one short instruction to resume the existing Investigator plan

Return only the compact resolution result. Do not include raw tool dumps or a compliance verdict.
"""

SUBAGENT = {
    "name": "resolver",
    "description": (
        "Use only after NEEDS_INPUT to resolve that exact assessment/Wizard fact, preserve any "
        "conflict, and return the minimum context delta needed to resume Investigator."
    ),
    "system_prompt": SYSTEM_PROMPT,
    "tools": TOOLS,
    "model": RESOLVER_MODEL_SPEC,
    "middleware": [inject_lcsp_runtime_context],
}
