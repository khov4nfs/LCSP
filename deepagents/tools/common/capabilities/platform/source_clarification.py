"""Bounded source-clarification request payloads for runtime events."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from tools.common.capabilities.workflow.recovery.clarification import (
    AgentClarificationQuestionGenerator,
)

SOURCE_CLARIFICATION_REQUEST_KIND = "SOURCE_CONTEXT_REQUEST"

SOURCE_CLARIFICATION_SCOPES = {
    "pre_scan": "PRE_SCAN",
    "post_graph": "POST_GRAPH",
}

SOURCE_CLARIFICATION_REQUESTERS = {
    "interview": "INTERVIEW",
    "scanner": "SCANNER",
    "planner": "PLANNER",
}

SOURCE_CLARIFICATION_QUESTION_IDS = {
    "missing_graph_context": "MISSING_GRAPH_CONTEXT",
    "missing_rule_scope": "MISSING_RULE_SCOPE",
    "missing_human_review_boundary": "MISSING_HUMAN_REVIEW_BOUNDARY",
}

SOURCE_CLARIFICATION_AGENT_TARGET_KINDS = {
    "customer_context_field": "CUSTOMER_CONTEXT_FIELD",
    "post_graph_context": "POST_GRAPH_CONTEXT",
    "planner_scope": "PLANNER_SCOPE",
    "general_context": "GENERAL_CONTEXT",
}

SOURCE_CLARIFICATION_AGENT_REASON_CODES = {
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
            scope=SOURCE_CLARIFICATION_SCOPES["post_graph"],
            requested_by=SOURCE_CLARIFICATION_REQUESTERS["planner"],
            generated_at=datetime.now(UTC).isoformat(),
        )
    )
    return {
        **base_summary,
        "kind": SOURCE_CLARIFICATION_REQUEST_KIND,
        "scope": SOURCE_CLARIFICATION_SCOPES["post_graph"],
        "requestedBy": SOURCE_CLARIFICATION_REQUESTERS["planner"],
        "reasonCode": "NO_ENGINEERING_RULE_SOURCE_RULES",
        "questionIds": [
            SOURCE_CLARIFICATION_QUESTION_IDS["missing_rule_scope"],
            SOURCE_CLARIFICATION_QUESTION_IDS["missing_graph_context"],
            SOURCE_CLARIFICATION_QUESTION_IDS["missing_human_review_boundary"],
        ],
        "questions": generated["questions"],
        "fallbackUsed": generated["fallbackUsed"],
        "generatedAt": generated["generatedAt"],
    }
