"""Deterministic validation for structured specialist handoffs."""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, ValidationError

from contracts.handoffs import ResolverResult, SPECIALIST_RESPONSE_FORMATS


class SpecialistHandoffValidationError(RuntimeError):
    """Raised when a specialist returns an unsafe or invalid handoff."""


_CAUSE_DETAIL_LIMIT = 500
_LOGGER = logging.getLogger(__name__)
_INTERVIEW_TARGETED_FRONTIER_REPAIRED = "INTERVIEW_TARGETED_FRONTIER_REPAIRED"


def _bounded_cause(exc: Exception) -> str:
    """Render a bounded, PII-safe summary of the underlying validation failure.

    ``ValidationError.errors(include_input=False)`` surfaces ``loc``/``msg`` only, never
    the model's raw field values.
    """
    if isinstance(exc, ValidationError):
        errors = exc.errors(include_url=False, include_context=False, include_input=False)
        parts = []
        for error in errors:
            loc = ".".join(str(segment) for segment in error.get("loc", ()))
            msg = str(error.get("msg") or "")
            parts.append(f"{loc}: {msg}" if loc else msg)
        text = "; ".join(parts)
    else:
        text = str(exc)
    text = text.strip()
    if len(text) > _CAUSE_DETAIL_LIMIT:
        text = text[:_CAUSE_DETAIL_LIMIT].rstrip() + "..."
    return text


FORBIDDEN_FINAL_VERDICTS = frozenset({"COMPLIANT", "NON_COMPLIANT"})
CONTROLLED_NON_VERDICT_PATHS = frozenset(
    {
        ("status",),
        ("coverage_state",),
        ("coverageState",),
        ("next_step",),
        ("nextStep",),
    }
)


def _response_model(subagent_type: str) -> type[BaseModel]:
    if subagent_type == "resolver":
        return ResolverResult
    try:
        return SPECIALIST_RESPONSE_FORMATS[subagent_type]
    except KeyError as exc:
        raise SpecialistHandoffValidationError(
            f"unknown LCSP specialist handoff type: {subagent_type}"
        ) from exc


def _is_controlled_non_verdict_path(path: tuple[str, ...]) -> bool:
    if path in CONTROLLED_NON_VERDICT_PATHS:
        return True
    if path[-1:] in {("claim_type",), ("claimType",)} and "claims" in path:
        return True
    if path[-1:] in {("source",)} and "conflicting_values" in path:
        return True
    if path[-1:] in {("source_kind",), ("sourceKind",)}:
        return True
    return False


def _assert_no_final_verdict(value: Any, *, path: tuple[str, ...] = ()) -> None:
    if path and _is_controlled_non_verdict_path(path):
        return
    if isinstance(value, str):
        tokens = {
            token.strip(".,:;()[]{}").upper()
            for token in value.replace("-", "_").split()
        }
        verdicts = sorted(tokens & FORBIDDEN_FINAL_VERDICTS)
        if verdicts:
            raise SpecialistHandoffValidationError(
                f"specialist handoff contains forbidden compliance verdict: {verdicts}"
        )
        return
    if isinstance(value, dict):
        for key, child in value.items():
            _assert_no_final_verdict(child, path=(*path, str(key)))
        return
    if isinstance(value, (list, tuple, set)):
        for child in value:
            _assert_no_final_verdict(child, path=path)


def validate_specialist_handoff(subagent_type: str, payload: Any) -> BaseModel:
    """Validate a specialist handoff before boundaries consume it."""
    model = _response_model(subagent_type)
    try:
        handoff = payload if isinstance(payload, model) else model.model_validate(payload)
    except ValidationError as exc:
        raise SpecialistHandoffValidationError(
            f"{subagent_type} handoff failed schema validation: {_bounded_cause(exc)}"
        ) from exc

    _assert_no_final_verdict(handoff.model_dump(mode="json"))
    return handoff


def repair_targeted_interview_frontier(
    payload: Any,
    *,
    targeted_need: Any,
) -> Any:
    """Derive a missing targeted Interview frontier from API-trusted need metadata.

    This is intentionally narrow: it only repairs a model-authored
    WAITING_FOR_CUSTOMER question when targeted need registration has already
    persisted trusted customer-facing need metadata. Non-targeted missing
    frontiers still fail closed in InterviewResult validation.
    """
    if not isinstance(payload, dict) or not isinstance(targeted_need, dict):
        return payload
    if payload.get("outcome") != "WAITING_FOR_CUSTOMER":
        return payload
    question = payload.get("activeQuestion")
    if not isinstance(question, dict):
        return payload
    if isinstance(question.get("frontier"), dict):
        return payload

    need_id = str(targeted_need.get("needId") or "").strip()
    description = str(targeted_need.get("businessContextNeed") or "").strip()
    if not need_id or not description:
        return payload

    raw_materiality = targeted_need.get("materiality")
    materiality = str(raw_materiality).strip().upper() if raw_materiality else ""
    materiality_source = "targeted_need"
    if not materiality:
        # The safe compliance default is MATERIAL: a false positive asks an
        # extra bounded customer question, while a false negative can hide a
        # real missing customer-owned fact from the compliance assessment.
        materiality = "MATERIAL"
        materiality_source = "default_material_compliance_safe"

    raw_refs = targeted_need.get("governedEvidenceRefs")
    evidence_refs = (
        [
            ref.strip()
            for ref in raw_refs
            if isinstance(ref, str) and ref.strip()
        ]
        if isinstance(raw_refs, list)
        else []
    )

    repaired = dict(payload)
    repaired_question = dict(question)
    repaired_question["frontier"] = {
        "owner": "CUSTOMER",
        "materiality": materiality,
        "description": description,
        "evidenceRefs": evidence_refs,
    }
    repaired_question.setdefault("needId", need_id)
    repaired["activeQuestion"] = repaired_question

    _LOGGER.warning(
        "%s targeted_need_id=%s reason=missing_frontier "
        "materiality_source=%s evidence_ref_count=%s",
        _INTERVIEW_TARGETED_FRONTIER_REPAIRED,
        need_id,
        materiality_source,
        len(evidence_refs),
    )
    return repaired


__all__ = [
    "FORBIDDEN_FINAL_VERDICTS",
    "SpecialistHandoffValidationError",
    "validate_specialist_handoff",
]
