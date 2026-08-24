"""Bounded Wizard clarification request payloads for runtime events."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from tools.clarification.investigation.clarification import (
    AgentClarificationQuestionGenerator,
)

WIZARD_CLARIFICATION_REQUEST_KIND = "WIZARD_CONTEXT_REQUEST"

WIZARD_CLARIFICATION_SCOPES = {
    "pre_scan": "PRE_SCAN",
    "post_graph": "POST_GRAPH",
}

WIZARD_CLARIFICATION_REQUESTERS = {
    "wizard": "WIZARD",
    "scanner": "SCANNER",
    "planner": "PLANNER",
}

WIZARD_CLARIFICATION_QUESTION_IDS = {
    "missing_graph_context": "MISSING_GRAPH_CONTEXT",
    "missing_rule_scope": "MISSING_RULE_SCOPE",
    "missing_human_review_boundary": "MISSING_HUMAN_REVIEW_BOUNDARY",
}

WIZARD_CLARIFICATION_AGENT_TARGET_KINDS = {
    "wizard_field": "WIZARD_FIELD",
    "post_graph_context": "POST_GRAPH_CONTEXT",
    "planner_scope": "PLANNER_SCOPE",
    "general_context": "GENERAL_CONTEXT",
}

WIZARD_CLARIFICATION_AGENT_REASON_CODES = {
    "missing_business_context": "MISSING_BUSINESS_CONTEXT",
    "rule_scope_ambiguous": "RULE_SCOPE_AMBIGUOUS",
    "graph_context_missing": "GRAPH_CONTEXT_MISSING",
}


def engineering_rule_source_clarification_summary(
    *,
    base_summary: dict[str, Any],
) -> dict[str, Any]:
    """Build the bounded post-graph context request for missing rule sources."""
    generated = (
        AgentClarificationQuestionGenerator()
        .fallback_for_missing_rule_source()
        .to_contract_dict(
            scope=WIZARD_CLARIFICATION_SCOPES["post_graph"],
            requested_by=WIZARD_CLARIFICATION_REQUESTERS["planner"],
            generated_at=datetime.now(UTC).isoformat(),
        )
    )
    return {
        **base_summary,
        "kind": WIZARD_CLARIFICATION_REQUEST_KIND,
        "scope": WIZARD_CLARIFICATION_SCOPES["post_graph"],
        "requestedBy": WIZARD_CLARIFICATION_REQUESTERS["planner"],
        "reasonCode": "NO_ENGINEERING_RULE_SOURCE_RULES",
        "questionIds": [
            WIZARD_CLARIFICATION_QUESTION_IDS["missing_rule_scope"],
            WIZARD_CLARIFICATION_QUESTION_IDS["missing_graph_context"],
            WIZARD_CLARIFICATION_QUESTION_IDS["missing_human_review_boundary"],
        ],
        "questions": generated["questions"],
        "fallbackUsed": generated["fallbackUsed"],
        "generatedAt": generated["generatedAt"],
    }
