"""Deterministic validation for structured specialist handoffs."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ValidationError

from contracts.handoffs import (
    InvestigatorResult,
    SPECIALIST_RESPONSE_FORMATS,
)
from subagents.context_wizard.definition import ContextWizardQuestionRound
from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
    EvidenceClaimValidationError,
    EvidenceClaimValidator,
)


class SpecialistHandoffValidationError(RuntimeError):
    """Raised when a specialist returns an unsafe or invalid handoff."""


FORBIDDEN_FINAL_VERDICTS = frozenset({"COMPLIANT", "NON_COMPLIANT", "UNKNOWN"})
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
    if subagent_type == "context_wizard":
        return ContextWizardQuestionRound
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


def validate_specialist_handoff(
    subagent_type: str,
    payload: Any,
    *,
    graph: Any | None = None,
    pinned_rule_ids: tuple[str, ...] | list[str] | None = None,
    pinned_versions: dict[str, str] | None = None,
) -> BaseModel:
    """Validate a specialist handoff before root or deterministic gates consume it."""
    model = _response_model(subagent_type)
    try:
        handoff = payload if isinstance(payload, model) else model.model_validate(payload)
    except ValidationError as exc:
        raise SpecialistHandoffValidationError(
            f"{subagent_type} handoff failed schema validation"
        ) from exc

    _assert_no_final_verdict(handoff.model_dump(mode="json"))

    if subagent_type == "investigator":
        investigator = InvestigatorResult.model_validate(handoff)
        if (
            graph is not None
            and pinned_rule_ids is not None
            and pinned_versions is not None
        ):
            validate_investigator_handoff(
                investigator,
                pinned_rule_ids=tuple(pinned_rule_ids),
                pinned_versions=pinned_versions,
                program_graph=graph,
            )
        elif investigator.status == "READY":
            raise SpecialistHandoffValidationError(
                "READY investigator handoff requires graph, pinned_rule_ids, and pinned_versions"
            )

    return handoff


def validate_investigator_handoff(
    result: InvestigatorResult | dict[str, Any],
    *,
    pinned_rule_ids: tuple[str, ...],
    pinned_versions: dict[str, str],
    program_graph: Any,
) -> tuple[Any, ...]:
    """Validate an Investigator handoff against immutable run pins."""
    handoff = (
        result if isinstance(result, InvestigatorResult) else InvestigatorResult.model_validate(result)
    )
    expected_versions = {str(key): str(value) for key, value in pinned_versions.items()}
    if handoff.artifact_versions != expected_versions:
        raise SpecialistHandoffValidationError(
            "investigator handoff artifact_versions do not match pinned versions"
        )

    pinned_rules = set(pinned_rule_ids)
    changed_rules = sorted(
        {
            claim.engineering_rule_id
            for claim in handoff.claims
            if claim.engineering_rule_id not in pinned_rules
        }
    )
    if changed_rules:
        raise SpecialistHandoffValidationError(
            f"investigator handoff contains unpinned engineering_rule_ids: {changed_rules}"
        )

    if handoff.status != "READY":
        return ()

    validator = EvidenceClaimValidator()
    validated_claims: list[Any] = []
    try:
        for claim in handoff.claims:
            validated_claims.append(validator.validate(claim.to_evidence_claim(), program_graph))
    except EvidenceClaimValidationError as exc:
        raise SpecialistHandoffValidationError(
            "investigator handoff failed evidence-claim validation"
        ) from exc

    if not validated_claims:
        raise SpecialistHandoffValidationError(
            "READY investigator handoff requires validated claims"
        )
    return tuple(validated_claims)


__all__ = [
    "FORBIDDEN_FINAL_VERDICTS",
    "SpecialistHandoffValidationError",
    "validate_investigator_handoff",
    "validate_specialist_handoff",
]
