"""Managed Deep Agents entry point for LCSP.

This file is intentionally at the project root because Managed Deep Agents
requires a root-level `agent.py` exporting a named `agent`.
"""

from managed_deepagents import define_deep_agent

from tools.lcsp_context import (
    compare_wizard_claim,
    get_assessment_context,
    get_classification_baseline,
    get_gap_requirements,
    get_legal_corpus_readiness,
    get_legal_rule_match,
    get_verified_profile,
    retrieve_legal_basis,
    validate_citation_set,
)
from tools.lcsp_control import (
    request_targeted_reanalysis,
    resume_waiting_runs,
    submit_classification_for_independent_review,
)
from tools.lcsp_invocations import (
    invoke_lcsp_boundary,
    list_lcsp_invocation_boundaries,
)


agent = define_deep_agent(
    name="lcsp-agent",
    model="openai:gpt-5",
    tools=[
        get_assessment_context,
        get_verified_profile,
        compare_wizard_claim,
        get_classification_baseline,
        get_gap_requirements,
        get_legal_corpus_readiness,
        retrieve_legal_basis,
        get_legal_rule_match,
        validate_citation_set,
        request_targeted_reanalysis,
        resume_waiting_runs,
        submit_classification_for_independent_review,
        list_lcsp_invocation_boundaries,
        invoke_lcsp_boundary,
    ],
    interrupt_on={
        "request_targeted_reanalysis": True,
        "resume_waiting_runs": True,
        "submit_classification_for_independent_review": True,
        "invoke_lcsp_boundary": True,
    },
)
