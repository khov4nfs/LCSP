from __future__ import annotations

from dataclasses import dataclass
from typing import Any


UNKNOWN_FACT_VALUES = {
    "UNKNOWN",
    "UNCLEAR",
    "NOT_DETERMINABLE_FROM_CODE",
}


@dataclass(slots=True)
class RuleEvaluationResult:
    rule_id: str
    status: str
    confidence: float
    rationale: list[str]
    matched_required_facts: list[str]
    blocking_facts: list[str]


class RuleApplicabilityEvaluator:
    """Deterministic evaluation of legal rules against verified profile facts."""

    def evaluate_rule(
        self,
        *,
        rule: dict[str, Any],
        verified_profile: dict[str, Any],
    ) -> RuleEvaluationResult:
        rule_id = str(rule.get("legalRuleId") or "unknown")
        merged_profile = verified_profile.get("mergedProfile") or {}
        if not isinstance(merged_profile, dict):
            return blocked_invalid_rule(rule_id, "merged profile missing or invalid")

        raw_fact_evidence_refs = (
            verified_profile.get("factEvidenceRefs")
            or verified_profile.get("fact_evidence_refs")
            or {}
        )
        fact_evidence_refs = (
            raw_fact_evidence_refs
            if isinstance(raw_fact_evidence_refs, dict)
            else {}
        )

        raw_required_facts = rule.get("requiredFacts")
        if not isinstance(raw_required_facts, list) or not raw_required_facts:
            return blocked_invalid_rule(rule_id, "required facts missing or invalid")
        if any(not is_valid_fact_definition(fact) for fact in raw_required_facts):
            return blocked_invalid_rule(rule_id, "required fact definition invalid")
        required_facts = raw_required_facts

        raw_blocking_facts = rule.get("blockingFacts")
        if raw_blocking_facts is None:
            blocking_facts: list[dict[str, Any]] = []
        elif isinstance(raw_blocking_facts, list) and all(
            is_valid_fact_definition(fact, expected_value_optional=True)
            for fact in raw_blocking_facts
        ):
            blocking_facts = raw_blocking_facts
        else:
            return blocked_invalid_rule(rule_id, "blocking fact definition invalid")

        unknown_fact_policy = str(
            rule.get("unknownFactPolicy") or "BLOCK_ON_UNKNOWN"
        )

        matched_required_facts: list[str] = []
        unknown_required_facts: list[str] = []
        unbacked_required_facts: list[str] = []
        mismatched_required_facts: list[str] = []
        rationale: list[str] = []

        for fact in required_facts:
            field = str(fact["field"])
            expected_value = fact["expectedValue"]
            actual_value = merged_profile.get(field)

            if is_unknown_fact(actual_value):
                unknown_required_facts.append(field)
                rationale.append(f"required fact {field} is unknown")
            elif not has_evidence_refs(fact_evidence_refs.get(field)):
                # An unbacked value may not prove either applicability or
                # non-applicability. Treat it as unresolved before comparing it
                # with the authored expectation.
                unbacked_required_facts.append(field)
                rationale.append(
                    f"required fact {field} lacks eligible evidence refs"
                )
            elif not fact_matches(actual_value, expected_value):
                mismatched_required_facts.append(field)
                rationale.append(f"required fact {field} did not match")
            else:
                matched_required_facts.append(field)
                rationale.append(f"required fact {field} matched")

        blocking_present: list[str] = []
        unresolved_blocking_facts: list[str] = []
        for item in blocking_facts:
            field = str(item["field"])
            if field not in merged_profile:
                continue
            actual_value = merged_profile.get(field)
            if is_unknown_fact(actual_value) or not has_evidence_refs(
                fact_evidence_refs.get(field)
            ):
                unresolved_blocking_facts.append(field)
                rationale.append(f"blocking fact {field} is unknown or unbacked")
                continue
            if "expectedValue" not in item or fact_matches(
                actual_value,
                item.get("expectedValue"),
            ):
                blocking_present.append(field)

        if blocking_present:
            return RuleEvaluationResult(
                rule_id=rule_id,
                status="NOT_APPLICABLE",
                confidence=0.0,
                rationale=rationale + ["blocking fact matched"],
                matched_required_facts=matched_required_facts,
                blocking_facts=blocking_present,
            )

        if unresolved_blocking_facts and unknown_fact_policy == "BLOCK_ON_UNKNOWN":
            return RuleEvaluationResult(
                rule_id=rule_id,
                status="BLOCKED_UNKNOWN_FACT",
                confidence=0.0,
                rationale=rationale,
                matched_required_facts=matched_required_facts,
                blocking_facts=[],
            )

        if unbacked_required_facts:
            return RuleEvaluationResult(
                rule_id=rule_id,
                status="BLOCKED_UNKNOWN_FACT",
                confidence=0.0,
                rationale=rationale,
                matched_required_facts=matched_required_facts,
                blocking_facts=blocking_present,
            )

        if unknown_required_facts:
            status = (
                "BLOCKED_UNKNOWN_FACT"
                if unknown_fact_policy == "BLOCK_ON_UNKNOWN"
                else "NOT_APPLICABLE"
            )
            return RuleEvaluationResult(
                rule_id=rule_id,
                status=status,
                confidence=0.0,
                rationale=rationale,
                matched_required_facts=matched_required_facts,
                blocking_facts=blocking_present,
            )

        if mismatched_required_facts:
            return RuleEvaluationResult(
                rule_id=rule_id,
                status="NOT_APPLICABLE",
                confidence=0.0,
                rationale=rationale,
                matched_required_facts=matched_required_facts,
                blocking_facts=blocking_present,
            )

        if len(matched_required_facts) != len(required_facts):
            return blocked_invalid_rule(rule_id, "required fact evaluation incomplete")

        return RuleEvaluationResult(
            rule_id=rule_id,
            status="MATCHED",
            confidence=0.95,
            rationale=rationale,
            matched_required_facts=matched_required_facts,
            blocking_facts=blocking_present,
        )


def blocked_invalid_rule(rule_id: str, reason: str) -> RuleEvaluationResult:
    return RuleEvaluationResult(
        rule_id=rule_id,
        status="BLOCKED_UNKNOWN_FACT",
        confidence=0.0,
        rationale=[reason],
        matched_required_facts=[],
        blocking_facts=[],
    )


def is_valid_fact_definition(
    value: Any,
    *,
    expected_value_optional: bool = False,
) -> bool:
    if not isinstance(value, dict):
        return False
    field = value.get("field")
    if not isinstance(field, str) or not field.strip():
        return False
    return expected_value_optional or "expectedValue" in value


def has_evidence_refs(value: Any) -> bool:
    return isinstance(value, list) and any(
        isinstance(ref, str) and bool(ref.strip()) for ref in value
    )


def is_unknown_fact(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        normalized = value.strip().upper()
        return not normalized or normalized in UNKNOWN_FACT_VALUES
    if isinstance(value, list):
        return any(is_unknown_fact(item) for item in value)
    return False


def fact_matches(actual_value: Any, expected_value: Any) -> bool:
    """Match rule facts without requiring exact list equality.

    Legal profile list fields are additive (for example harm categories), so a
    rule requiring one category must still match when the verified profile has
    other categories as well. Scalar expectations also match membership in an
    actual list. No coercion between unrelated scalar types is performed.
    """

    if isinstance(expected_value, list):
        if not isinstance(actual_value, list):
            return False
        return all(expected in actual_value for expected in expected_value)
    if isinstance(actual_value, list):
        return expected_value in actual_value
    return actual_value == expected_value
