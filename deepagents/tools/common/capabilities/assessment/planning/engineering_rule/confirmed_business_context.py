"""Confirmed structured business context accepted by EngineeringRule Planner."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


CONFIRMED_CONTEXT_AUTHORITY = "CUSTOMER_CONFIRMED_CONFIRMED_ONLY"
CONFIRMED_CONTEXT_SOURCE = "CUSTOMER_CONFIRMED"
CONFIRMED_CONTEXT_RESOLUTION_STATE = "CONFIRMED"


@dataclass(frozen=True)
class ConfirmedBusinessContextStatement:
    """One current Customer-confirmed context statement.

    ``respondent_ref`` is copied only from persisted runtime provenance. Customer
    statement text and model output are never trusted as actor identity.
    """

    statement_id: str
    topic: str
    statement: str
    normalized_value: Any | None
    scope: dict[str, Any]
    evidence_refs: tuple[str, ...]
    respondent_ref: str
    created_at: str
    supersedes_statement_id: str | None
    source: Literal["CUSTOMER_CONFIRMED"] = CONFIRMED_CONTEXT_SOURCE
    resolution_state: Literal["CONFIRMED"] = CONFIRMED_CONTEXT_RESOLUTION_STATE

    def to_prompt_dict(self) -> dict[str, Any]:
        return {
            "statementId": self.statement_id,
            "topic": self.topic,
            "statement": self.statement,
            "normalizedValue": self.normalized_value,
            "scope": dict(self.scope),
            "evidenceRefs": list(self.evidence_refs),
            "respondentRef": self.respondent_ref,
            "createdAt": self.created_at,
            "supersedesStatementId": self.supersedes_statement_id,
            "source": self.source,
            "resolutionState": self.resolution_state,
        }


@dataclass(frozen=True)
class ConfirmedStructuredBusinessContext:
    """Planner input envelope for authoritative business context."""

    assessment_id: str
    context_revision: int
    statements: tuple[ConfirmedBusinessContextStatement, ...]
    limitations: tuple[str, ...] = ()
    policy_decision_ref: str | None = None
    source_version_ref: str | None = None
    pge_version: str | None = None
    guidance_version: str | None = None
    created_by_actor_ref: str | None = None
    authority: Literal[
        "CUSTOMER_CONFIRMED_CONFIRMED_ONLY"
    ] = CONFIRMED_CONTEXT_AUTHORITY

    def __post_init__(self) -> None:
        if not self.assessment_id:
            raise ValueError("confirmed structured context is missing assessment_id")
        if self.context_revision <= 0:
            raise ValueError("confirmed structured context is missing valid contextRevision")
        if not self.statements:
            raise ValueError("confirmed structured context has no confirmed statements")
        if self.authority != CONFIRMED_CONTEXT_AUTHORITY:
            raise ValueError("confirmed structured context authority is invalid")

    @property
    def confirmed_statement_refs(self) -> tuple[str, ...]:
        return tuple(statement.statement_id for statement in self.statements)

    def to_prompt_dict(self) -> dict[str, Any]:
        return {
            "assessmentId": self.assessment_id,
            "contextRevision": self.context_revision,
            "authority": self.authority,
            "statements": [statement.to_prompt_dict() for statement in self.statements],
            "limitations": list(self.limitations),
            "policyDecisionRef": self.policy_decision_ref,
            "sourceVersionRef": self.source_version_ref,
            "pgeVersion": self.pge_version,
            "guidanceVersion": self.guidance_version,
            "createdByActorRef": self.created_by_actor_ref,
        }

    def to_legacy_customer_context(self) -> dict[str, Any]:
        """Return a bounded compatibility view for non-Planner deterministic code."""
        answers = {
            statement.topic: statement.normalized_value
            if statement.normalized_value is not None
            else statement.statement
            for statement in self.statements
        }
        return {
            "assessmentId": self.assessment_id,
            "contextRevision": self.context_revision,
            "authority": self.authority,
            "answers": answers,
            "statements": [statement.to_prompt_dict() for statement in self.statements],
            "limitations": list(self.limitations),
            "policyDecisionRef": self.policy_decision_ref,
            "sourceVersionRef": self.source_version_ref,
            "pgeVersion": self.pge_version,
            "guidanceVersion": self.guidance_version,
        }


def normalize_confirmed_structured_business_context(
    state: dict[str, Any],
    *,
    assessment_id: str,
) -> ConfirmedStructuredBusinessContext:
    """Convert guarded Interview state into Planner's confirmed-only envelope."""
    if str(state.get("outcome") or "") not in {"CONTEXT_READY", "CONTEXT_RESOLVED"}:
        raise ValueError("Planner requires guarded confirmed Interview context")
    raw = (
        state.get("confirmedStructuredBusinessContext")
        or state.get("currentConfirmedBusinessContext")
        or state.get("confirmedContext")
    )
    if not isinstance(raw, dict):
        raise ValueError("CONTEXT_READY is missing confirmed structured business context")
    state_revision = _required_positive_int(
        state.get("contextRevision")
        or raw.get("contextRevision")
        or raw.get("context_revision"),
        "contextRevision",
    )

    envelope_assessment_id = str(
        raw.get("assessmentId")
        or raw.get("assessment_id")
        or state.get("assessmentId")
        or assessment_id
    )
    if envelope_assessment_id != assessment_id:
        raise ValueError("confirmed structured context assessmentId does not match")
    envelope_revision = _required_positive_int(
        raw.get("contextRevision")
        or raw.get("context_revision")
        or state_revision,
        "confirmedContext.contextRevision",
    )
    if envelope_revision != state_revision:
        raise ValueError("confirmed structured context revision does not match Interview state")

    raw_statements = raw.get("statements") or raw.get("currentConfirmedBusinessContext")
    if not isinstance(raw_statements, list):
        raise ValueError("confirmed structured context statements must be an array")

    statements = tuple(
        _normalize_statement(item, assessment_id=assessment_id)
        for item in raw_statements
        if isinstance(item, dict)
        and item.get("source") == CONFIRMED_CONTEXT_SOURCE
        and (item.get("resolutionState") or item.get("resolution_state"))
        == CONFIRMED_CONTEXT_RESOLUTION_STATE
    )
    if not statements:
        raise ValueError("CONTEXT_READY has no usable confirmed structured statements")

    return ConfirmedStructuredBusinessContext(
        assessment_id=assessment_id,
        context_revision=envelope_revision,
        statements=statements,
        limitations=_string_tuple(raw.get("limitations")),
        policy_decision_ref=_optional_string(
            raw.get("policyDecisionRef") or raw.get("policy_decision_ref")
        ),
        source_version_ref=_optional_string(
            raw.get("sourceVersionRef")
            or raw.get("source_version_ref")
            or state.get("sourceVersionRef")
            or state.get("sourceVersion")
        ),
        pge_version=_optional_string(
            raw.get("pgeVersion") or raw.get("pge_version") or state.get("pgeVersion")
        ),
        guidance_version=_optional_string(
            raw.get("guidanceVersion") or raw.get("guidance_version")
        ),
        created_by_actor_ref=_optional_string(
            raw.get("createdByActorRef") or raw.get("created_by_actor_ref")
        ),
    )


def coerce_confirmed_structured_business_context(
    value: ConfirmedStructuredBusinessContext | dict[str, Any] | None,
) -> ConfirmedStructuredBusinessContext:
    if isinstance(value, ConfirmedStructuredBusinessContext):
        return value
    if isinstance(value, dict):
        assessment_id = str(value.get("assessmentId") or value.get("assessment_id") or "")
        return normalize_confirmed_structured_business_context(
            {
                "outcome": "CONTEXT_READY",
                "contextRevision": value.get("contextRevision")
                or value.get("context_revision"),
                "confirmedContext": value,
            },
            assessment_id=assessment_id,
        )
    raise ValueError("Planner requires confirmed structured business context")


def _normalize_statement(
    item: dict[str, Any],
    *,
    assessment_id: str,
) -> ConfirmedBusinessContextStatement:
    statement_assessment_id = str(
        item.get("assessmentId") or item.get("assessment_id") or assessment_id
    )
    if statement_assessment_id != assessment_id:
        raise ValueError("confirmed statement assessmentId does not match")
    statement_id = _required_string(
        item.get("statementId") or item.get("statement_id"),
        "statementId",
    )
    respondent_ref = _required_string(
        item.get("respondentRef") or item.get("respondent_ref"),
        "respondentRef",
    )
    return ConfirmedBusinessContextStatement(
        statement_id=statement_id,
        topic=_required_string(item.get("topic"), "topic"),
        statement=_required_string(item.get("statement"), "statement"),
        normalized_value=(
            item.get("normalizedValue")
            if "normalizedValue" in item
            else item.get("normalized_value")
        ),
        scope=dict(item.get("scope") or {}),
        evidence_refs=_string_tuple(item.get("evidenceRefs") or item.get("evidence_refs")),
        respondent_ref=respondent_ref,
        created_at=_required_string(item.get("createdAt") or item.get("created_at"), "createdAt"),
        supersedes_statement_id=_optional_string(
            item.get("supersedesStatementId") or item.get("supersedes_statement_id")
        ),
    )


def _required_positive_int(value: Any, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a positive integer") from error
    if parsed <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return parsed


def _required_string(value: Any, label: str) -> str:
    parsed = str(value or "").strip()
    if not parsed:
        raise ValueError(f"confirmed structured context is missing {label}")
    return parsed


def _optional_string(value: Any) -> str | None:
    parsed = str(value or "").strip()
    return parsed or None


def _string_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(str(item) for item in value if str(item or "").strip())


__all__ = [
    "CONFIRMED_CONTEXT_AUTHORITY",
    "ConfirmedBusinessContextStatement",
    "ConfirmedStructuredBusinessContext",
    "coerce_confirmed_structured_business_context",
    "normalize_confirmed_structured_business_context",
]
