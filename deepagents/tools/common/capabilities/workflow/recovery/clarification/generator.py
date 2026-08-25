"""Generate and validate autonomous clarification questions.

The LLM may propose free-form questions, but this module owns the contract:
questions are bounded, routed to approved targets, normalized, and emitted with
UI control metadata before they reach runtime events or the Wizard.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from tools.common.capabilities.workflow.recovery.clarification.models import (
    CLARIFICATION_REASONS,
    CLARIFICATION_REQUESTERS,
    CLARIFICATION_SCOPES,
    CLARIFICATION_SEVERITIES,
    AgentClarificationQuestion,
    ClarificationGenerationResult,
    RoutedClarificationQuestion,
    VALID_REASONS,
    VALID_SEVERITIES,
)
from tools.common.capabilities.workflow.recovery.clarification.question_router import (
    ClarificationQuestionRouter,
)

MAX_QUESTION_TEXT_LENGTH = 320
MAX_EVIDENCE_REFS = 8
DEFAULT_LANGUAGE = "vi"


class AgentClarificationQuestionGenerator:
    """Normalize agent-generated questions into the shared clarification schema."""

    def __init__(
        self,
        *,
        question_router: ClarificationQuestionRouter | None = None,
        max_questions: int = 5,
    ) -> None:
        self._question_router = question_router or ClarificationQuestionRouter()
        self._max_questions = max(1, max_questions)

    def generate_from_agent_questions(
        self,
        questions: Sequence[AgentClarificationQuestion | Mapping[str, Any]],
    ) -> ClarificationGenerationResult:
        """Validate and route raw agent questions.

        The input may come from a model tool call, a deterministic policy, or a
        test fixture. Invalid entries are dropped rather than passed through.
        """
        routed_questions: list[RoutedClarificationQuestion] = []
        diagnostics: list[str] = []
        seen_texts: set[str] = set()
        dropped_count = 0

        for raw_question in questions:
            if len(routed_questions) >= self._max_questions:
                dropped_count += 1
                continue
            question = self._normalize_raw_question(raw_question)
            if question is None:
                dropped_count += 1
                diagnostics.append("INVALID_QUESTION")
                continue

            dedupe_key = question.text.casefold()
            if dedupe_key in seen_texts:
                dropped_count += 1
                diagnostics.append("DUPLICATE_QUESTION")
                continue
            seen_texts.add(dedupe_key)

            target, method, confidence = self._question_router.route(
                question.text,
                suggested_field_name=question.suggested_field_name,
            )
            routed_questions.append(
                RoutedClarificationQuestion(
                    question_id=f"agent-clarification-{len(routed_questions) + 1}",
                    text=question.text,
                    language=question.language,
                    target_kind=target.target_kind,
                    target_field_name=target.field_name,
                    severity=question.severity,
                    reason_code=question.reason_code,
                    evidence_refs=question.evidence_refs,
                    routing_method=method,
                    routing_confidence=confidence,
                    answer_control=target.answer_control,
                    option_set=target.option_set,
                )
            )

        return ClarificationGenerationResult(
            questions=tuple(routed_questions),
            fallback_used=False,
            dropped_question_count=dropped_count,
            diagnostics=tuple(diagnostics),
        )

    def fallback_for_missing_rule_source(self) -> ClarificationGenerationResult:
        """Produce bounded questions when planner cannot select rule sources."""
        result = self.generate_from_agent_questions(
            (
                AgentClarificationQuestion(
                    text=(
                        "Cần áp dụng nhóm điều khoản hoặc rule kỹ thuật nào cho "
                        "assessment này trước khi planner tiếp tục?"
                    ),
                    language="vi",
                    suggested_field_name="postGraphRuleScope",
                    severity=CLARIFICATION_SEVERITIES["high"],
                    reason_code=CLARIFICATION_REASONS["rule_scope_ambiguous"],
                ),
                AgentClarificationQuestion(
                    text=(
                        "Code graph đang thiếu thông tin, missing context hoặc "
                        "evidence gap nào cần bổ sung để hiểu bằng chứng kỹ thuật?"
                    ),
                    language="vi",
                    suggested_field_name="postGraphContext",
                    severity=CLARIFICATION_SEVERITIES["medium"],
                    reason_code=CLARIFICATION_REASONS["graph_context_missing"],
                ),
                AgentClarificationQuestion(
                    text=(
                        "Human review boundary nằm ở đâu: điểm nào cần người "
                        "kiểm soát, phê duyệt hoặc override quyết định của AI?"
                    ),
                    language="vi",
                    suggested_field_name="postGraphHumanReviewBoundary",
                    severity=CLARIFICATION_SEVERITIES["medium"],
                    reason_code=CLARIFICATION_REASONS["missing_business_context"],
                ),
            )
        )
        return ClarificationGenerationResult(
            questions=result.questions,
            fallback_used=True,
            dropped_question_count=result.dropped_question_count,
            diagnostics=result.diagnostics,
        )

    def fallback_contract_summary_for_missing_rule_source(
        self,
        *,
        generated_at: str,
    ) -> dict[str, Any]:
        """Return a runtime-event summary for the missing-rule-source fallback."""
        return self.fallback_for_missing_rule_source().to_contract_dict(
            scope=CLARIFICATION_SCOPES["post_graph"],
            requested_by=CLARIFICATION_REQUESTERS["planner"],
            generated_at=generated_at,
        )

    @staticmethod
    def _normalize_raw_question(
        raw_question: AgentClarificationQuestion | Mapping[str, Any],
    ) -> AgentClarificationQuestion | None:
        if isinstance(raw_question, AgentClarificationQuestion):
            candidate = raw_question
        elif isinstance(raw_question, Mapping):
            text = str(raw_question.get("text") or "").strip()
            candidate = AgentClarificationQuestion(
                text=text,
                language=str(raw_question.get("language") or DEFAULT_LANGUAGE).strip()
                or DEFAULT_LANGUAGE,
                suggested_field_name=_optional_string(
                    raw_question.get("suggestedFieldName")
                    or raw_question.get("suggested_field_name")
                    or raw_question.get("targetFieldName")
                    or raw_question.get("target_field_name")
                ),
                severity=_normalize_value(
                    raw_question.get("severity"),
                    valid_values=VALID_SEVERITIES,
                    default_value=CLARIFICATION_SEVERITIES["medium"],
                ),
                reason_code=_normalize_value(
                    raw_question.get("reasonCode")
                    or raw_question.get("reason_code"),
                    valid_values=VALID_REASONS,
                    default_value=CLARIFICATION_REASONS[
                        "missing_business_context"
                    ],
                ),
                evidence_refs=_normalize_evidence_refs(
                    raw_question.get("evidenceRefs")
                    or raw_question.get("evidence_refs")
                ),
            )
        else:
            return None

        text = candidate.text.strip()
        if not text:
            return None
        return AgentClarificationQuestion(
            text=text[:MAX_QUESTION_TEXT_LENGTH],
            language=candidate.language.strip() or DEFAULT_LANGUAGE,
            suggested_field_name=candidate.suggested_field_name,
            severity=_normalize_value(
                candidate.severity,
                valid_values=VALID_SEVERITIES,
                default_value=CLARIFICATION_SEVERITIES["medium"],
            ),
            reason_code=_normalize_value(
                candidate.reason_code,
                valid_values=VALID_REASONS,
                default_value=CLARIFICATION_REASONS["missing_business_context"],
            ),
            evidence_refs=_normalize_evidence_refs(candidate.evidence_refs),
        )


def _normalize_value(
    value: Any,
    *,
    valid_values: frozenset[str],
    default_value: str,
) -> str:
    if isinstance(value, str):
        normalized = value.strip().upper()
        if normalized in valid_values:
            return normalized
    return default_value


def _optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _normalize_evidence_refs(value: Any) -> tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    refs: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        ref = item.strip()
        if not ref or ref in seen:
            continue
        refs.append(ref)
        seen.add(ref)
        if len(refs) >= MAX_EVIDENCE_REFS:
            break
    return tuple(refs)
