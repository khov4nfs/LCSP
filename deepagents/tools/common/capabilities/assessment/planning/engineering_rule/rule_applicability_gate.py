"""Legal applicability as a real gate, decided by ``RuleApplicabilityEvaluator``.

Two different things are established by two different authorities and must not be
confused:

- the repository graph establishes what the *product does* (RuleEvidenceIndex);
- the authored legal facts establish whether the *law applies* (this module).

A graph path never makes a rule applicable. This module asks the existing deterministic
evaluator, with no model in the loop, whether a LegalRule's authored ``requiredFacts`` /
``blockingFacts`` are satisfied by evidence-backed facts, and reports one of

    MATCHED               the rule applies: the Repository Analyst may analyse it
    NOT_APPLICABLE        the rule does not apply: it is never analysed
    BLOCKED_UNKNOWN_FACT  an ordinary fact is unknown or unbacked: nothing is analysed yet
    UPSTREAM_FACT_PENDING a fact that an upstream authority settles (for example
                          ``aiDetected``, settled by AI discovery) is unknown or unbacked:
                          nothing is analysed yet, and it is NOT applicability either way

plus ``NOT_GATED``, which means exactly one thing: the LegalRule authors no
``requiredFacts`` / ``blockingFacts``, so there is nothing to evaluate. It is never a
fallback for a fact that could not be established.

Facts come from explicit providers only. A fact the platform has no provider for is
unknown, and a blocked fact whose owner is not declared in ``FACT_OWNERS`` stays blocked
without being routed anywhere: ownership is never guessed. A blocked fact is returned as
a typed fact need routed to its declared owner.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from tools.common.capabilities.assessment.rule_assessment.absence_policy import (
    legal_rule_id_of,
)
from tools.legal.retrieval.legal_basis.rule_applicability_evaluator import (
    RULE_APPLICABILITY_STATUSES,
    RuleApplicabilityEvaluator,
)
from tools.common.capabilities.platform.logging import get_logger

logger = get_logger(__name__)

APPLICABILITY_GATE_VERSION = "1.0.0"

APPLICABILITY_STATUSES = {
    **RULE_APPLICABILITY_STATUSES,
    # Only "the rule authors no facts". Never a substitute for an unestablished fact.
    "not_gated": "NOT_GATED",
    # A settled-upstream fact is unknown/unbacked: non-terminal, blocks investigation.
    "upstream_fact_pending": "UPSTREAM_FACT_PENDING",
}

# Who can supply each fact. Declared, never inferred from the field name. A fact that is
# not listed here has no owner: if it blocks a rule the rule stays blocked and nothing is
# asked of anyone.
FACT_OWNERS: Mapping[str, str] = {
    # The Scanner establishes it from source; an unclear (dynamic/outbound) AI call is
    # then a customer clarification, so the owner is both.
    "aiDetected": "HYBRID",
    "nationalDataSourceReuse": "BUSINESS_CONTEXT",
}

# Facts an upstream authority settles, and the authority that owns each. A rule whose
# authored facts are ALL in this set and unestablished is UPSTREAM_FACT_PENDING: the fact
# is neither established nor refuted, so the rule is neither investigated nor excluded, and
# the need is routed to the authority that can settle it. ``aiDetected`` is decided by the
# Scanner's AI-discovery gate (and, when that is unclear, by the initial Interview); its
# recovery runs before rule analysis on every dispatch, so a rule that still sees it
# unestablished waits for the next accepted evidence rather than guessing.
UPSTREAM_FACT_AUTHORITIES: Mapping[str, str] = {
    "aiDetected": "AI_DISCOVERY",
}
SETTLED_UPSTREAM_FACTS = frozenset(UPSTREAM_FACT_AUTHORITIES)

# A confirmed statement's topic -> the authored fact fields it can supply. Narrow on
# purpose (same bridge targeted Interview already uses): only a topic declared here
# ever becomes a fact.
STATEMENT_FACT_FIELDS: Mapping[str, tuple[str, ...]] = {
    "national_data_source_reuse": ("nationalDataSourceReuse", "national_data_source_reuse"),
}

# Where a blocked fact goes, by its declared owner. No owner means it stays blocked and
# nothing is asked of anyone.
FACT_NEED_ROUTES: Mapping[str | None, str] = {
    "TECHNICAL": "SCANNER",
    "BUSINESS_CONTEXT": "INTERVIEW",
    "HYBRID": "INTERVIEW_THEN_REANALYSIS",
    None: "STAY_BLOCKED",
}
# A settled-upstream fact is routed to the authority that owns it, not to a question.
UPSTREAM_RECOVERY_ROUTE = "UPSTREAM_RECOVERY"

_CONFIRMED_AI_STATE = "CONFIRMED_AI_CALL"


def evaluate_applicability(
    legal_rules: Iterable[Mapping[str, Any]],
    *,
    ai_discovery: Mapping[str, Any] | None,
    confirmed_statements: Sequence[Mapping[str, Any]] = (),
    engineering_rule_ids_by_legal: Mapping[str, Sequence[str]] | None = None,
) -> dict[str, dict[str, Any]]:
    """One result per LegalRule, keyed by ``legalRuleId``. Deterministic for equal input."""
    evaluator = RuleApplicabilityEvaluator()
    by_legal = engineering_rule_ids_by_legal or {}
    results: dict[str, dict[str, Any]] = {}
    for rule in legal_rules or ():
        legal_rule_id = str(rule.get("legalRuleId") or rule.get("legal_rule_id") or "")
        if not legal_rule_id:
            continue
        required = [f for f in rule.get("requiredFacts") or () if isinstance(f, Mapping)]
        blocking = [f for f in rule.get("blockingFacts") or () if isinstance(f, Mapping)]
        rule_ids = sorted(str(r) for r in by_legal.get(legal_rule_id, ()))
        if not required and not blocking:
            results[legal_rule_id] = _result(
                legal_rule_id, APPLICABILITY_STATUSES["not_gated"], rule_ids, profile={},
                reason="NO_AUTHORED_FACTS",
            )
            continue
        profile = build_verified_profile(
            rule, ai_discovery=ai_discovery, confirmed_statements=confirmed_statements
        )
        outcome = evaluator.evaluate_rule(rule=dict(rule), verified_profile=profile)
        if outcome.status == APPLICABILITY_STATUSES["blocked_unknown_fact"]:
            blocked_fields = {
                need["factField"]
                for need in _fact_needs(legal_rule_id, rule_ids, rule, profile)
            }
            if blocked_fields and blocked_fields <= SETTLED_UPSTREAM_FACTS:
                results[legal_rule_id] = _result(
                    legal_rule_id,
                    APPLICABILITY_STATUSES["upstream_fact_pending"],
                    rule_ids,
                    profile=profile,
                    rule=rule,
                    reason="UPSTREAM_FACT_UNESTABLISHED:" + ",".join(sorted(blocked_fields)),
                )
                logger.info(
                    "RULE_APPLICABILITY_EVALUATED",
                    legalRuleId=legal_rule_id,
                    status=APPLICABILITY_STATUSES["upstream_fact_pending"],
                    engineeringRuleCount=len(rule_ids),
                    matchedFactCount=0,
                    unknownFactCount=len(blocked_fields),
                )
                continue
        results[legal_rule_id] = _result(
            legal_rule_id,
            outcome.status,
            rule_ids,
            profile=profile,
            matched=list(outcome.matched_required_facts),
            blocking=list(outcome.blocking_facts),
            rule=rule,
        )
        logger.info(
            "RULE_APPLICABILITY_EVALUATED",
            legalRuleId=legal_rule_id,
            status=outcome.status,
            engineeringRuleCount=len(rule_ids),
            matchedFactCount=len(outcome.matched_required_facts),
            unknownFactCount=len(results[legal_rule_id]["factNeeds"]),
        )
    return results


def build_verified_profile(
    rule: Mapping[str, Any],
    *,
    ai_discovery: Mapping[str, Any] | None,
    confirmed_statements: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """Evidence-backed facts for one rule from explicit providers, layered over its own."""
    raw = rule.get("verifiedProfile") or rule.get("verified_profile") or {}
    merged = dict((raw.get("mergedProfile") or raw.get("merged_profile") or {}) if isinstance(raw, Mapping) else {})
    refs = dict((raw.get("factEvidenceRefs") or raw.get("fact_evidence_refs") or {}) if isinstance(raw, Mapping) else {})
    wanted = {
        str(f.get("field"))
        for key in ("requiredFacts", "blockingFacts")
        for f in rule.get(key) or ()
        if isinstance(f, Mapping) and f.get("field")
    }
    if "aiDetected" in wanted:
        value, ai_refs = _ai_detected(ai_discovery)
        merged["aiDetected"] = value
        refs["aiDetected"] = ai_refs
    for statement in confirmed_statements or ():
        topic = str(statement.get("topic") or "")
        target = next((f for f in STATEMENT_FACT_FIELDS.get(topic, ()) if f in wanted), None)
        if target is None:
            continue
        merged[target] = statement.get("normalizedValue", statement.get("normalized_value"))
        refs[target] = [str(statement.get("statementId") or statement.get("statement_id") or "")]
    return {"mergedProfile": merged, "factEvidenceRefs": refs}


def _ai_detected(ai_discovery: Mapping[str, Any] | None) -> tuple[str, list[str]]:
    """``confirmed`` only for a Scanner-confirmed AI call that has source anchors.

    An absent-AI gate deliberately yields an unbacked fact: it can never turn into
    NOT_APPLICABLE here, because absence is not proven by this gate (FINAL_ABSENCE
    stays disabled). Anything else is unknown.
    """
    if not isinstance(ai_discovery, Mapping):
        return "UNKNOWN", []
    gate = str(ai_discovery.get("gate") or "")
    findings = [f for f in ai_discovery.get("findings") or () if isinstance(f, Mapping)]
    if gate == "AI_CONFIRMED":
        anchors = sorted(
            {
                str(ref)
                for f in findings
                if f.get("state") == _CONFIRMED_AI_STATE
                for ref in (f.get("evidence_refs") or f.get("evidenceRefs") or ())
                if str(ref).strip()
            }
        )
        return ("confirmed", anchors) if anchors else ("UNKNOWN", [])
    if gate == "AI_ABSENT_CONFIRMED":
        return "absent", []
    return "UNKNOWN", []


def _result(
    legal_rule_id: str,
    status: str,
    rule_ids: list[str],
    *,
    profile: Mapping[str, Any],
    matched: Sequence[str] = (),
    blocking: Sequence[str] = (),
    rule: Mapping[str, Any] | None = None,
    reason: str = "",
) -> dict[str, Any]:
    needs = (
        _fact_needs(legal_rule_id, rule_ids, rule or {}, profile)
        if status
        in (
            APPLICABILITY_STATUSES["blocked_unknown_fact"],
            APPLICABILITY_STATUSES["upstream_fact_pending"],
        )
        else []
    )
    body = {
        "legalRuleId": legal_rule_id,
        "status": status,
        "engineeringRuleIds": rule_ids,
        "matchedFacts": sorted(matched),
        "blockingFacts": sorted(blocking),
        "factNeeds": needs,
        "reason": reason,
        "gateVersion": APPLICABILITY_GATE_VERSION,
    }
    facts = (profile or {}).get("mergedProfile") or {}
    refs = (profile or {}).get("factEvidenceRefs") or {}
    body["identity"] = "sha256:" + hashlib.sha256(
        json.dumps(
            {**body, "facts": facts, "refs": refs}, sort_keys=True, separators=(",", ":"), default=str
        ).encode("utf-8")
    ).hexdigest()
    return body


def _fact_needs(
    legal_rule_id: str,
    rule_ids: list[str],
    rule: Mapping[str, Any],
    profile: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Typed needs for the facts that blocked the rule; owner only if declared."""
    merged = profile.get("mergedProfile") or {}
    refs = profile.get("factEvidenceRefs") or {}
    needs: list[dict[str, Any]] = []
    for key in ("requiredFacts", "blockingFacts"):
        for fact in rule.get(key) or ():
            if not isinstance(fact, Mapping) or not fact.get("field"):
                continue
            field = str(fact["field"])
            value = merged.get(field)
            unknown = value is None or (
                isinstance(value, str) and value.strip().upper() in {"", "UNKNOWN", "UNCLEAR", "NOT_DETERMINABLE_FROM_CODE"}
            )
            unbacked = not any(str(r).strip() for r in (refs.get(field) or ()))
            if key == "blockingFacts" and field not in merged:
                continue
            if unknown or unbacked:
                authority = UPSTREAM_FACT_AUTHORITIES.get(field)
                needs.append(
                    {
                        "factField": field,
                        "legalRuleId": legal_rule_id,
                        "engineeringRuleIds": list(rule_ids),
                        "owner": FACT_OWNERS.get(field),
                        "route": (
                            UPSTREAM_RECOVERY_ROUTE
                            if authority
                            else FACT_NEED_ROUTES[FACT_OWNERS.get(field)]
                        ),
                        "authority": authority,
                        "reason": "UNKNOWN" if unknown else "UNBACKED",
                    }
                )
    return sorted(
        {(n["factField"], n["reason"]): n for n in needs}.values(),
        key=lambda n: (n["factField"], n["reason"]),
    )


def applicability_by_engineering_rule(
    results: Mapping[str, Mapping[str, Any]],
) -> dict[str, Mapping[str, Any]]:
    """engineeringRuleId -> the applicability result of its LegalRule."""
    mapping: dict[str, Mapping[str, Any]] = {}
    for result in results.values():
        for rule_id in result.get("engineeringRuleIds") or ():
            mapping[str(rule_id)] = result
    return mapping


def applicability_identity(results: Mapping[str, Mapping[str, Any]]) -> str:
    """One identity for the whole applicability decision set (part of the plan key)."""
    body = {lid: r.get("identity") for lid, r in sorted(results.items())}
    return "sha256:" + hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def legal_rule_id_index(engineering_rule_ids: Iterable[str]) -> dict[str, list[str]]:
    """Group runtime engineering rule ids by their LegalRule (``{legal}::PRECOMPILED::x``)."""
    grouped: dict[str, list[str]] = {}
    for rule_id in engineering_rule_ids:
        grouped.setdefault(legal_rule_id_of(str(rule_id)), []).append(str(rule_id))
    return grouped


__all__ = [
    "APPLICABILITY_GATE_VERSION",
    "APPLICABILITY_STATUSES",
    "FACT_NEED_ROUTES",
    "FACT_OWNERS",
    "SETTLED_UPSTREAM_FACTS",
    "UPSTREAM_FACT_AUTHORITIES",
    "UPSTREAM_RECOVERY_ROUTE",
    "STATEMENT_FACT_FIELDS",
    "applicability_by_engineering_rule",
    "applicability_identity",
    "build_verified_profile",
    "evaluate_applicability",
    "legal_rule_id_index",
]
