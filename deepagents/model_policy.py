"""Role-specific model policy for the LCSP Managed Deep Agents graph."""

from __future__ import annotations

import os


DEFAULT_ROOT_MODEL_SPEC = "openai:gpt-5.6-terra"
DEFAULT_TRIAGE_MODEL_SPEC = "openai:gpt-5.6-sol"
DEFAULT_CONTEXT_WIZARD_MODEL_SPEC = "openai:gpt-5.6-luna"
DEFAULT_PLANNER_MODEL_SPEC = "openai:gpt-5.6-sol"
DEFAULT_INVESTIGATOR_MODEL_SPEC = "openai:gpt-5.6-terra"
DEFAULT_RESOLVER_MODEL_SPEC = "openai:gpt-5.6-luna"


def _model_spec(env_name: str, default: str) -> str:
    """Resolve one LangChain ``provider:model`` spec with a fail-closed shape check."""
    value = os.getenv(env_name, default).strip()
    if not value or ":" not in value:
        raise RuntimeError(f"{env_name} must use LangChain provider:model format")
    return value


ROOT_MODEL_SPEC = _model_spec("LCSP_ROOT_AGENT_MODEL", DEFAULT_ROOT_MODEL_SPEC)
TRIAGE_MODEL_SPEC = _model_spec("LCSP_TRIAGE_MODEL", DEFAULT_TRIAGE_MODEL_SPEC)
CONTEXT_WIZARD_MODEL_SPEC = _model_spec(
    "LCSP_CONTEXT_WIZARD_MODEL", DEFAULT_CONTEXT_WIZARD_MODEL_SPEC
)
PLANNER_MODEL_SPEC = _model_spec("LCSP_PLANNER_MODEL", DEFAULT_PLANNER_MODEL_SPEC)
INVESTIGATOR_MODEL_SPEC = _model_spec(
    "LCSP_INVESTIGATOR_MODEL", DEFAULT_INVESTIGATOR_MODEL_SPEC
)
RESOLVER_MODEL_SPEC = _model_spec("LCSP_RESOLVER_MODEL", DEFAULT_RESOLVER_MODEL_SPEC)

SUBAGENT_MODEL_SPECS = {
    "triage": TRIAGE_MODEL_SPEC,
    "context_wizard": CONTEXT_WIZARD_MODEL_SPEC,
    "planner": PLANNER_MODEL_SPEC,
    "investigator": INVESTIGATOR_MODEL_SPEC,
    "resolver": RESOLVER_MODEL_SPEC,
}

# Every model used by this graph receives the same LCSP harness restrictions.
ALL_LCSP_MODEL_SPECS = tuple(
    dict.fromkeys(
        (
            ROOT_MODEL_SPEC,
            TRIAGE_MODEL_SPEC,
            CONTEXT_WIZARD_MODEL_SPEC,
            PLANNER_MODEL_SPEC,
            INVESTIGATOR_MODEL_SPEC,
            RESOLVER_MODEL_SPEC,
        )
    )
)
