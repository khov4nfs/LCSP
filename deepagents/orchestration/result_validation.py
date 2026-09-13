"""Deterministic validation for structured specialist handoffs."""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, ValidationError

from contracts.handoffs import (
    InvestigatorClaim,
    InvestigatorRequirementMetClaim,
    InvestigatorRequirementNotMetClaim,
    InvestigatorResult,
    InvestigatorScopeNotApplicableClaim,
    InvestigatorUnresolvedClaim,
    ResolverResult,
    SPECIALIST_RESPONSE_FORMATS,
)
from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
    EvidenceClaimValidationError,
    EvidenceClaimValidator,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
)


class SpecialistHandoffValidationError(RuntimeError):
    """Raised when a specialist returns an unsafe or invalid handoff."""


_CAUSE_DETAIL_LIMIT = 500
_LOGGER = logging.getLogger(__name__)
_INTERVIEW_TARGETED_FRONTIER_REPAIRED = "INTERVIEW_TARGETED_FRONTIER_REPAIRED"

# `InvestigatorClaim` is a plain `Union` (anyOf, not a discriminated oneOf — see
# contracts/handoffs.py for why). Pydantic's "smart union" validates a claim against every
# variant and reports every variant's failures, so a real error (e.g. the UNRESOLVED
# variant's empty `limitations`) arrives buried under 3 irrelevant "this isn't a MET claim"
# reports. _filter_union_variant_noise below narrows to the one variant whose claim_type
# actually matched before rendering.
_INVESTIGATOR_CLAIM_VARIANT_NAMES = tuple(
    cls.__name__
    for cls in (
        InvestigatorRequirementMetClaim,
        InvestigatorRequirementNotMetClaim,
        InvestigatorUnresolvedClaim,
        InvestigatorScopeNotApplicableClaim,
    )
)


def _union_variant_in_segment(segment: Any) -> str | None:
    text = str(segment)
    for name in _INVESTIGATOR_CLAIM_VARIANT_NAMES:
        if name in text:
            return name
    return None


def _filter_union_variant_noise(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    generic: list[dict[str, Any]] = []
    variant_groups: dict[str, list[dict[str, Any]]] = {}
    for error in errors:
        variant = next(
            (v for v in map(_union_variant_in_segment, error.get("loc", ())) if v),
            None,
        )
        (generic if variant is None else variant_groups.setdefault(variant, [])).append(
            error
        )
    if not variant_groups:
        return errors
    # A variant whose own errors include a `claim_type` mismatch never matched the input at
    # all; its other field errors ("criterion required", etc.) are artifacts of the smart
    # union trying every shape, not real problems with the claim the caller sent.
    matched = {
        variant: group
        for variant, group in variant_groups.items()
        if not any(error.get("loc", ())[-1:] == ("claim_type",) for error in group)
    }
    if len(matched) == 1:
        (group,) = matched.values()
        return [*generic, *group]
    return errors


def _bounded_cause(exc: Exception) -> str:
    """Render a bounded, PII-safe summary of the underlying validation failure.

    Callers (structured logs, ``_recovery_instruction``) need the actual field/rule that
    failed, not just the generic outer message, or the model has nothing concrete to
    self-correct against. ``ValidationError.errors(include_input=False)`` keeps this safe:
    it surfaces ``loc``/``msg`` only, never the model's raw field values.
    """
    if isinstance(exc, ValidationError):
        errors = exc.errors(include_url=False, include_context=False, include_input=False)
        errors = _filter_union_variant_noise(errors)
        parts = []
        for error in errors:
            loc = ".".join(
                str(segment)
                for segment in error.get("loc", ())
                if _union_variant_in_segment(segment) is None
            )
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


def _validate_customer_context_claim_refs(
    claims: list[InvestigatorClaim],
    *,
    confirmed_statement_refs: tuple[str, ...],
) -> None:
    known = {str(ref) for ref in confirmed_statement_refs if str(ref).strip()}
    for claim in claims:
        if (
            claim.claim_type
            != ENGINEERING_EVIDENCE_CLAIM_TYPES["rule_scope_not_applicable"]
        ):
            continue
        missing = [ref for ref in claim.customer_context_refs if ref not in known]
        if missing or not known:
            raise SpecialistHandoffValidationError(
                "RULE_SCOPE_NOT_APPLICABLE customer_context_refs must reference confirmed statements"
            )


def _normalize_investigator_payload(
    payload: Any,
    *,
    allow_fail_closed_recovery: bool = False,
) -> Any:
    """Remove provider-added customer refs from non-customer-context claim variants.

    Gemini's native responseSchema currently does not reliably enforce
    ``additionalProperties: false`` inside the Investigator claim ``anyOf``. The field is
    meaningful only for RULE_SCOPE_NOT_APPLICABLE, where it remains required and fully
    validated against confirmed customer statements. On MET/NOT_MET/UNRESOLVED variants it
    is an inert extra key that would otherwise mask the actual evidence/value guard being
    evaluated by Pydantic and EvidenceClaimValidator.
    """
    if not isinstance(payload, dict):
        return payload
    claims = payload.get("claims")
    if not isinstance(claims, list):
        return payload
    normalized = dict(payload)
    normalized_claims: list[Any] = []
    for claim in claims:
        if not isinstance(claim, dict):
            normalized_claims.append(claim)
            continue
        if allow_fail_closed_recovery:
            claim = _fail_closed_investigator_claim(claim)
        if (
            claim.get("claim_type")
            != ENGINEERING_EVIDENCE_CLAIM_TYPES["rule_scope_not_applicable"]
            and "customer_context_refs" in claim
        ):
            claim = dict(claim)
            claim.pop("customer_context_refs", None)
        normalized_claims.append(claim)
    normalized["claims"] = normalized_claims
    return normalized


def _fail_closed_investigator_claim(claim: dict[str, Any]) -> dict[str, Any]:
    """Canonicalize unsafe Gemini claim shapes to unresolved, never to decided.

    Gemini may ignore per-variant ``required``/``const`` constraints inside the
    Investigator ``anyOf``. Filling a missing decided value/ref would fabricate a closed
    compliance-relevant claim. Downgrading an unprovable decided claim to
    UNRESOLVED_ENGINEERING_FACT preserves the strict evidence guard: downstream receives a
    non-decision with an explicit limitation instead of an unsupported MET/NOT_MET.
    """
    claim_type = claim.get("claim_type")
    unresolved_type = ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
    if claim_type == unresolved_type:
        normalized = dict(claim)
        normalized["value"] = None
        refs = _investigator_claim_refs(normalized)
        if not refs:
            normalized["confidence"] = 0.0
        limitations = normalized.get("limitations")
        if not isinstance(limitations, list) or not limitations:
            normalized["limitations"] = [
                ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
            ]
        return normalized

    if claim_type not in {
        ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"],
        ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"],
    }:
        return claim

    refs = _investigator_claim_refs(claim)
    if refs and isinstance(claim.get("value"), bool) and claim.get("criterion"):
        return claim

    normalized = dict(claim)
    normalized["claim_type"] = unresolved_type
    normalized["value"] = None
    normalized["limitations"] = [
        ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
    ]
    normalized.setdefault("evidence_refs", [])
    normalized.setdefault("graph_path_refs", [])
    normalized.setdefault("source_anchor_refs", [])
    normalized["confidence"] = 0.0
    return normalized


def _investigator_claim_refs(claim: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    for key in ("evidence_refs", "graph_path_refs", "source_anchor_refs"):
        value = claim.get(key)
        if isinstance(value, list):
            refs.extend(str(item).strip() for item in value if str(item).strip())
    return refs


def _is_fail_closed_unresolved_without_refs(claim: InvestigatorClaim) -> bool:
    return (
        claim.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
        and claim.confidence == 0.0
        and not (claim.evidence_refs or claim.graph_path_refs or claim.source_anchor_refs)
        and ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
        in claim.limitations
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


def validate_specialist_handoff(
    subagent_type: str,
    payload: Any,
    *,
    graph: Any | None = None,
    pinned_rule_ids: tuple[str, ...] | list[str] | None = None,
    pinned_versions: dict[str, str] | None = None,
    confirmed_statement_refs: tuple[str, ...] | list[str] | None = None,
    allow_fail_closed_recovery: bool = False,
) -> BaseModel:
    """Validate a specialist handoff before root or deterministic gates consume it."""
    model = _response_model(subagent_type)
    if subagent_type == "investigator":
        payload = _normalize_investigator_payload(
            payload,
            allow_fail_closed_recovery=allow_fail_closed_recovery,
        )
    try:
        handoff = payload if isinstance(payload, model) else model.model_validate(payload)
    except ValidationError as exc:
        raise SpecialistHandoffValidationError(
            f"{subagent_type} handoff failed schema validation: {_bounded_cause(exc)}"
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
                confirmed_statement_refs=confirmed_statement_refs,
                allow_fail_closed_recovery=allow_fail_closed_recovery,
            )
        elif investigator.status == "READY":
            raise SpecialistHandoffValidationError(
                "READY investigator handoff requires graph, pinned_rule_ids, and pinned_versions"
            )

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


def validate_investigator_handoff(
    result: InvestigatorResult | dict[str, Any],
    *,
    pinned_rule_ids: tuple[str, ...],
    pinned_versions: dict[str, str],
    program_graph: Any,
    confirmed_statement_refs: tuple[str, ...] | list[str] | None = None,
    allow_fail_closed_recovery: bool = False,
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

    _validate_customer_context_claim_refs(
        handoff.claims,
        confirmed_statement_refs=tuple(confirmed_statement_refs or ()),
    )

    validator = EvidenceClaimValidator()
    validated_claims: list[Any] = []
    try:
        for claim in handoff.claims:
            if (
                claim.claim_type
                == ENGINEERING_EVIDENCE_CLAIM_TYPES["rule_scope_not_applicable"]
            ):
                validated_claims.append(claim.to_evidence_claim())
                continue
            if allow_fail_closed_recovery and _is_fail_closed_unresolved_without_refs(claim):
                validated_claims.append(claim.to_evidence_claim())
                continue
            validated_claims.append(validator.validate(claim.to_evidence_claim(), program_graph))
    except EvidenceClaimValidationError as exc:
        raise SpecialistHandoffValidationError(
            "investigator handoff failed evidence-claim validation "
            f"(claim_id={claim.claim_id!r}, criterion={claim.criterion!r}): "
            f"{_bounded_cause(exc)}"
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
