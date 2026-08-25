from __future__ import annotations

from tools.common.capabilities.workflow.recovery.clarification import (
    AgentClarificationQuestion,
    AgentClarificationQuestionGenerator,
    ClarificationQuestionRouter,
    merge_clarification_answers_into_wizard_context,
)


def _keyword_router() -> ClarificationQuestionRouter:
    router = ClarificationQuestionRouter()
    router._resolve_embedding_fn = lambda: None
    return router


def test_router_uses_keyword_fallback_for_vietnamese_question() -> None:
    router = _keyword_router()

    target, method, confidence = router.route(
        "Điều khoản pháp lý nào áp dụng cho phạm vi đánh giá này?"
    )

    assert target.field_name == "postGraphRuleScope"
    assert method == "KEYWORD_FALLBACK"
    assert confidence > 0


def test_generator_routes_agent_questions_to_contract_shape() -> None:
    generator = AgentClarificationQuestionGenerator(
        question_router=_keyword_router()
    )

    result = generator.generate_from_agent_questions(
        [
            AgentClarificationQuestion(
                text="Hệ thống tự động tới mức nào và ai phê duyệt?",
                language="vi",
                suggested_field_name="autonomyLevel",
                severity="HIGH",
                reason_code="DOUBTFUL_ANSWER",
            )
        ]
    )

    assert result.dropped_question_count == 0
    payload = result.questions[0].to_contract_dict()
    assert payload["targetFieldName"] == "autonomyLevel"
    assert payload["answerControl"] == "select"
    assert payload["optionSet"] == "autonomyLevel"


def test_generator_fallback_for_missing_rule_source_is_bounded() -> None:
    generator = AgentClarificationQuestionGenerator(
        question_router=_keyword_router()
    )

    result = generator.fallback_for_missing_rule_source()

    assert result.fallback_used is True
    assert [question.target_field_name for question in result.questions] == [
        "postGraphRuleScope",
        "postGraphContext",
        "postGraphHumanReviewBoundary",
    ]
    assert all(question.answer_control == "textarea" for question in result.questions)


def test_merge_clarification_answers_keeps_original_wizard_fields() -> None:
    context = {"useCase": "Original use case"}

    merged = merge_clarification_answers_into_wizard_context(
        context,
        [
            {
                "questionId": "agent-clarification-1",
                "targetFieldName": "useCase",
                "questionText": "Use case nào cần làm rõ?",
                "answerText": "Clarified use case",
                "severity": "MEDIUM",
                "reasonCode": "MISSING_BUSINESS_CONTEXT",
            }
        ],
    )

    assert merged["useCase"] == "Original use case"
    assert merged["clarificationAnswers"][0]["answerText"] == "Clarified use case"
    assert (
        merged["clarificationsByField"]["useCase"][0]["questionId"]
        == "agent-clarification-1"
    )
