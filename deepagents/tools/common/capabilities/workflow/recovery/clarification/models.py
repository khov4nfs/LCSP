"""Value sets and dataclasses for the autonomous clarification layer.

Values mirror ``packages/contracts/src/evidence/assessment-interview.ts`` exactly; the
contract file is the canonical source and these constants must never drift.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

CLARIFICATION_TARGET_KINDS = {
    "customer_context_field": "CUSTOMER_CONTEXT_FIELD",
    "post_graph_context": "POST_GRAPH_CONTEXT",
    "planner_scope": "PLANNER_SCOPE",
    "general_context": "GENERAL_CONTEXT",
}

CLARIFICATION_SEVERITIES = {
    "low": "LOW",
    "medium": "MEDIUM",
    "high": "HIGH",
}

CLARIFICATION_REASONS = {
    "missing_business_context": "MISSING_BUSINESS_CONTEXT",
    "conflicts_with_source_evidence": "CONFLICTS_WITH_SOURCE_EVIDENCE",
    "doubtful_answer": "DOUBTFUL_ANSWER",
    "rule_scope_ambiguous": "RULE_SCOPE_AMBIGUOUS",
    "graph_context_missing": "GRAPH_CONTEXT_MISSING",
    "business_semantics_unclear": "BUSINESS_SEMANTICS_UNCLEAR",
}

CLARIFICATION_ROUTING_METHODS = {
    "transformer_embedding": "TRANSFORMER_EMBEDDING",
    "keyword_fallback": "KEYWORD_FALLBACK",
    "agent_hint": "AGENT_HINT",
}

CLARIFICATION_REQUEST_KIND = "SOURCE_CONTEXT_REQUEST"

CLARIFICATION_REQUESTERS = {
    "interview": "INTERVIEW",
    "scanner": "SCANNER",
    "planner": "PLANNER",
}

CLARIFICATION_SCOPES = {
    "pre_scan": "PRE_SCAN",
    "post_graph": "POST_GRAPH",
}

VALID_SEVERITIES = frozenset(CLARIFICATION_SEVERITIES.values())
VALID_REASONS = frozenset(CLARIFICATION_REASONS.values())
VALID_TARGET_KINDS = frozenset(CLARIFICATION_TARGET_KINDS.values())


@dataclass(frozen=True)
class ClarificationRoutingTarget:
    """One canonical location a free-form question can be routed to."""

    target_kind: str
    field_name: str
    display_name: str
    descriptor: str
    keywords: tuple[str, ...] = ()
    answer_control: str = "textarea"
    option_set: str | None = None

    def matches_field(self, field_name: str) -> bool:
        return self.field_name == field_name


@dataclass(frozen=True)
class RoutedClarificationQuestion:
    """A generated question after deterministic routing to a canonical target."""

    question_id: str
    text: str
    language: str
    target_kind: str
    target_field_name: str | None
    severity: str
    reason_code: str
    evidence_refs: tuple[str, ...]
    routing_method: str
    routing_confidence: float
    answer_control: str = "textarea"
    option_set: str | None = None

    def to_contract_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.question_id,
            "text": self.text,
            "language": self.language,
            "targetKind": self.target_kind,
            "severity": self.severity,
            "reasonCode": self.reason_code,
            "evidenceRefs": list(self.evidence_refs),
            "status": "PENDING",
            "routingMethod": self.routing_method,
            "routingConfidence": round(self.routing_confidence, 4),
            "answerControl": self.answer_control,
        }
        if self.target_field_name:
            payload["targetFieldName"] = self.target_field_name
        if self.option_set:
            payload["optionSet"] = self.option_set
        return payload


@dataclass(frozen=True)
class AgentClarificationQuestion:
    """Raw agent-proposed question before routing."""

    text: str
    language: str
    suggested_field_name: str | None
    severity: str
    reason_code: str
    evidence_refs: tuple[str, ...] = ()


@dataclass(frozen=True)
class AgentClarificationAnswer:
    """One answered clarification question merged into planner context."""

    question_id: str
    target_field_name: str | None
    question_text: str
    answer_text: str
    severity: str
    reason_code: str
    evidence_refs: tuple[str, ...] = ()


@dataclass(frozen=True)
class ClarificationGenerationResult:
    """Outcome of one clarification generation round."""

    questions: tuple[RoutedClarificationQuestion, ...]
    fallback_used: bool
    dropped_question_count: int = 0
    diagnostics: tuple[str, ...] = field(default=())

    def to_contract_dict(
        self,
        *,
        scope: str,
        requested_by: str,
        generated_at: str,
    ) -> dict[str, Any]:
        return {
            "kind": CLARIFICATION_REQUEST_KIND,
            "scope": scope,
            "requestedBy": requested_by,
            "questions": [
                question.to_contract_dict() for question in self.questions
            ],
            "fallbackUsed": self.fallback_used,
            "generatedAt": generated_at,
        }
