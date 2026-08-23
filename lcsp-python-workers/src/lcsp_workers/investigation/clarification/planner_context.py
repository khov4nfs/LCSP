"""Merge answered clarification questions into planner context."""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from lcsp_workers.investigation.clarification.models import AgentClarificationAnswer

MAX_ANSWER_TEXT_LENGTH = 2_000


def merge_clarification_answers_into_wizard_context(
    wizard_context: Mapping[str, Any] | None,
    answers: Sequence[AgentClarificationAnswer | Mapping[str, Any]],
) -> dict[str, Any]:
    """Return planner context enriched with user clarification answers.

    The canonical Wizard answers remain untouched. Clarifications are stored in
    a separate namespace so planner/investigation can use them without
    accidentally treating them as original questionnaire answers.
    """
    result: dict[str, Any] = dict(wizard_context or {})
    normalized_answers = [
        normalized
        for answer in answers
        if (normalized := _normalize_answer(answer)) is not None
    ]
    if not normalized_answers:
        return result

    existing_answers = result.get("clarificationAnswers")
    merged_answers: list[dict[str, Any]] = []
    if isinstance(existing_answers, list):
        merged_answers.extend(
            item for item in existing_answers if isinstance(item, dict)
        )
    merged_answers.extend(normalized_answers)
    result["clarificationAnswers"] = _dedupe_answers(merged_answers)

    by_field: dict[str, list[dict[str, Any]]] = {}
    existing_by_field = result.get("clarificationsByField")
    if isinstance(existing_by_field, Mapping):
        for field_name, field_answers in existing_by_field.items():
            if isinstance(field_name, str) and isinstance(field_answers, list):
                by_field[field_name] = [
                    item for item in field_answers if isinstance(item, dict)
                ]

    for answer in normalized_answers:
        target_field_name = answer.get("targetFieldName")
        if isinstance(target_field_name, str) and target_field_name:
            by_field.setdefault(target_field_name, []).append(answer)

    if by_field:
        result["clarificationsByField"] = {
            field_name: _dedupe_answers(field_answers)
            for field_name, field_answers in by_field.items()
        }
    return result


def _normalize_answer(
    answer: AgentClarificationAnswer | Mapping[str, Any],
) -> dict[str, Any] | None:
    if isinstance(answer, AgentClarificationAnswer):
        question_id = answer.question_id
        question_text = answer.question_text
        answer_text = answer.answer_text
        target_field_name = answer.target_field_name
        severity = answer.severity
        reason_code = answer.reason_code
        evidence_refs = answer.evidence_refs
    elif isinstance(answer, Mapping):
        question_id = str(answer.get("questionId") or answer.get("question_id") or "")
        question_text = str(
            answer.get("questionText") or answer.get("question_text") or ""
        )
        answer_text = str(answer.get("answerText") or answer.get("answer_text") or "")
        target_field_name = answer.get("targetFieldName") or answer.get(
            "target_field_name"
        )
        severity = str(answer.get("severity") or "")
        reason_code = str(answer.get("reasonCode") or answer.get("reason_code") or "")
        evidence_refs = answer.get("evidenceRefs") or answer.get("evidence_refs") or ()
    else:
        return None

    question_id = question_id.strip()
    answer_text = answer_text.strip()
    if not question_id or not answer_text:
        return None

    payload: dict[str, Any] = {
        "questionId": question_id,
        "questionText": question_text.strip(),
        "answerText": answer_text[:MAX_ANSWER_TEXT_LENGTH],
        "severity": severity.strip(),
        "reasonCode": reason_code.strip(),
        "evidenceRefs": _normalize_evidence_refs(evidence_refs),
    }
    if isinstance(target_field_name, str) and target_field_name.strip():
        payload["targetFieldName"] = target_field_name.strip()
    return payload


def _normalize_evidence_refs(value: Any) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
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
    return refs


def _dedupe_answers(answers: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for answer in answers:
        question_id = answer.get("questionId")
        if isinstance(question_id, str) and question_id:
            deduped[question_id] = answer
    return list(deduped.values())
