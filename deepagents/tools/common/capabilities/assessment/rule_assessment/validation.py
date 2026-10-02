"""Deterministic acceptance of one Repository Analyst rule assessment.

A model submits observations; LCSP decides what is accepted. Identity, evidence
provenance, statuses, limitation vocabulary and need provenance are enforced here, with
no model in the loop. The model never manufactures refs: it passes runtime-minted
``evidenceRefs`` (see evidence_refs.py) or re-cites a ref in ``prior_evidence_refs``.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
    EvidenceClaimValidationError,
    is_implementation_evidence_path,
    verify_repository_source,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
    MODEL_SELECTABLE_LIMITATION_CODES,
)

from .neutral_text import assert_neutral_customer_text
from .evidence_refs import parse_canonical_ref, parse_verified_evidence_ref
from .values import (
    RULE_ANALYSIS_STATUSES,
    RULE_ASSESSMENT_VALIDATOR_ID,
    RULE_CRITERION_STATUSES,
    RULE_EVIDENCE_KINDS,
)

MAX_TECHNICAL_FACTS = 10
MAX_TECHNICAL_FACT_CHARS = 500

_STATUS_VALUES = frozenset(RULE_CRITERION_STATUSES.values())
_KIND_VALUES = frozenset(RULE_EVIDENCE_KINDS.values())


class RuleAssessmentValidationError(ValueError):
    """Submission rejected; ``problems`` are model-readable and safe to return."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = list(problems)


@dataclass(frozen=True)
class AcceptedRuleAssessment:
    """The persisted body (camelCase wire shape) for one rule."""

    payload: dict[str, Any]

    def to_payload(self) -> dict[str, Any]:
        return json.loads(json.dumps(self.payload))


def derive_rule_status(criteria: list[Mapping[str, Any]]) -> str:
    statuses = {c["status"] for c in criteria}
    if RULE_CRITERION_STATUSES["businessContextRequired"] in statuses:
        return RULE_ANALYSIS_STATUSES["needsContext"]
    if statuses & {
        RULE_CRITERION_STATUSES["technicalUnresolved"],
        RULE_CRITERION_STATUSES["notObserved"],
    }:
        return RULE_ANALYSIS_STATUSES["unresolved"]
    return RULE_ANALYSIS_STATUSES["completed"]


def validate_rule_assessment(
    submission: Mapping[str, Any],
    context: Any,
    repository_root: str | None,
    *,
    execution: Mapping[str, Any] | None = None,
) -> AcceptedRuleAssessment:
    """Validate ``submission`` against the trusted ``context``; raise with all problems."""
    problems: list[str] = []
    rule_ids = tuple(getattr(context, "engineering_rule_ids", ()) or ())
    rule_id = rule_ids[0] if len(rule_ids) == 1 else None
    version = getattr(context, "engineering_rule_version", None)
    commit_sha = getattr(context, "commit_sha", None)
    criterion_ids = tuple(getattr(context, "criterion_ids", ()) or ())
    prior_refs = frozenset(getattr(context, "prior_evidence_refs", ()) or ())
    if rule_id is None or not version or not commit_sha or not criterion_ids:
        raise RuleAssessmentValidationError(
            ["trusted runtime context does not identify exactly one rule, version, repository and criteria"]
        )
    if submission.get("engineeringRuleId") != rule_id:
        problems.append("engineeringRuleId does not match the assigned rule")
    if submission.get("engineeringRuleVersion") != version:
        problems.append("engineeringRuleVersion does not match the assigned rule version")
    if submission.get("repositoryVersion") != commit_sha:
        problems.append("repositoryVersion does not match the pinned repository")

    accepted: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(submission.get("criteria") or ()):
        criterion_id = raw.get("criterionId") if isinstance(raw, Mapping) else None
        label = f"criteria[{index}] {criterion_id}"
        if criterion_id not in criterion_ids:
            problems.append(f"{label}: unknown criterionId; allowed: {list(criterion_ids)}")
            continue
        if criterion_id in accepted:
            problems.append(f"{label}: duplicate criterionId")
            continue
        criterion, errors = _accept_criterion(
            raw, context, label, criterion_ids, commit_sha, prior_refs, repository_root, rule_id
        )
        problems.extend(errors)
        if criterion is not None:
            accepted[criterion_id] = criterion
    if problems:
        raise RuleAssessmentValidationError(problems)

    criteria = [
        accepted.get(cid)
        or {
            "criterionId": cid,
            "status": RULE_CRITERION_STATUSES["technicalUnresolved"],
            "evidenceRefs": [],
            "evidence": [],
            "technicalFacts": [],
            "limitations": [ENGINEERING_LIMITATION_CODES["agent_did_not_submit_criterion"]],
        }
        for cid in criterion_ids
    ]
    limitations = list(dict.fromkeys(code for c in criteria for code in c["limitations"]))
    revision = int(getattr(context, "context_revision", 0) or 0)
    identity = json.dumps(
        [getattr(context, "assessment_id", None), rule_id, version, commit_sha, revision, criteria],
        sort_keys=True,
        separators=(",", ":"),
    )
    payload = {
        "resultId": "rar_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24],
        "assessmentId": getattr(context, "assessment_id", None),
        "engineeringRuleId": rule_id,
        "engineeringRuleVersion": version,
        "repositoryVersion": commit_sha,
        "contextRevision": revision,
        "status": derive_rule_status(criteria),
        "criteria": criteria,
        "limitations": limitations,
        "execution": {"attempt": 1, **(dict(execution) if execution else {})},
    }
    return AcceptedRuleAssessment(payload)


def _accept_criterion(
    raw: Mapping[str, Any],
    context: Any,
    label: str,
    criterion_ids: tuple[str, ...],
    commit_sha: str,
    prior_refs: frozenset[str],
    repository_root: str | None,
    rule_id: str,
) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    criterion_id = raw["criterionId"]
    status = raw.get("status")
    if status not in _STATUS_VALUES:
        return None, [f"{label}: status must be one of {sorted(_STATUS_VALUES)}"]

    evidence: list[dict[str, Any]] = []
    for ref in raw.get("evidenceRefs") or ():
        ref = str(ref)
        entry = parse_verified_evidence_ref(ref, context)
        if entry is not None:
            try:
                verify_repository_source(
                    entry["path"], entry["startLine"], entry["endLine"], repository_root, required=True
                )
            except EvidenceClaimValidationError as error:
                errors.append(f"{label}: evidence rejected: {error}")
                continue
        else:
            canonical = parse_canonical_ref(ref)
            # A prior ref is re-citable only for the criterion and evidenceKind it was
            # accepted under (trusted binding from the dispatcher), and must still verify.
            if (
                canonical is None
                or canonical["commitSha"] != commit_sha
                or f"{criterion_id}|{raw.get('evidenceKind') or ''}|{ref}" not in prior_refs
            ):
                errors.append(
                    f"{label}: evidenceRefs must come from cite_repository_source / get_code_snippet in this task, or be a ref accepted earlier for this same criterion and evidenceKind"
                )
                continue
            try:
                verify_repository_source(
                    canonical["path"], canonical["startLine"], canonical["endLine"], repository_root, required=True
                )
            except EvidenceClaimValidationError as error:
                errors.append(f"{label}: evidence rejected: {error}")
                continue
            entry = canonical
        # The only place provenance is stamped: after live validation in this call.
        evidence.append(
            {
                **{k: entry[k] for k in ("ref", "path", "startLine", "endLine")},
                "provenance": {
                    "assessmentId": getattr(context, "assessment_id", None),
                    "repositoryVersion": commit_sha,
                    "engineeringRuleId": rule_id,
                    "criterionId": criterion_id,
                    "validator": RULE_ASSESSMENT_VALIDATOR_ID,
                },
            }
        )
    evidence = list({e["ref"]: e for e in evidence}.values())

    kind = raw.get("evidenceKind")
    if status == RULE_CRITERION_STATUSES["evidenceFound"]:
        if kind not in _KIND_VALUES:
            errors.append(f"{label}: EVIDENCE_FOUND requires evidenceKind in {sorted(_KIND_VALUES)}")
    elif kind:
        errors.append(f"{label}: evidenceKind is only allowed with EVIDENCE_FOUND")

    facts = [str(f).strip() for f in raw.get("technicalFacts") or () if str(f).strip()]
    if len(facts) > MAX_TECHNICAL_FACTS or any(len(f) > MAX_TECHNICAL_FACT_CHARS for f in facts):
        errors.append(
            f"{label}: technicalFacts allows at most {MAX_TECHNICAL_FACTS} facts of {MAX_TECHNICAL_FACT_CHARS} characters"
        )
    limitations = list(dict.fromkeys(str(c) for c in raw.get("limitations") or ()))
    invalid = [c for c in limitations if c not in MODEL_SELECTABLE_LIMITATION_CODES]
    if invalid:
        errors.append(f"{label}: limitations must be from {list(MODEL_SELECTABLE_LIMITATION_CODES)}")

    if status == RULE_CRITERION_STATUSES["evidenceFound"] and not evidence:
        errors.append(f"{label}: EVIDENCE_FOUND requires at least one verified evidence item")
    if status == RULE_CRITERION_STATUSES["evidenceFound"] and any(
        not is_implementation_evidence_path(e["path"]) for e in evidence
    ):
        errors.append(
            f"{label}: EVIDENCE_FOUND must cite production source; test, fixture, script, example, generated and documentation files cannot close a criterion"
        )
    if (
        status
        in (RULE_CRITERION_STATUSES["notObserved"], RULE_CRITERION_STATUSES["technicalUnresolved"])
        and not limitations
    ):
        errors.append(f"{label}: {status} requires at least one limitation code")

    need_raw = raw.get("businessContextNeed")
    need: dict[str, Any] | None = None
    if status == RULE_CRITERION_STATUSES["businessContextRequired"]:
        if not isinstance(need_raw, Mapping):
            errors.append(f"{label}: BUSINESS_CONTEXT_REQUIRED requires businessContextNeed")
        else:
            need, need_errors = _accept_need(need_raw, label, criterion_id, criterion_ids, rule_id)
            errors.extend(need_errors)
    elif need_raw:
        errors.append(f"{label}: businessContextNeed is only allowed with BUSINESS_CONTEXT_REQUIRED")
    if errors:
        return None, errors

    criterion: dict[str, Any] = {
        "criterionId": criterion_id,
        "status": status,
        "evidenceRefs": [e["ref"] for e in evidence],
        "evidence": evidence,
        "technicalFacts": facts,
        "limitations": limitations,
    }
    if status == RULE_CRITERION_STATUSES["evidenceFound"]:
        criterion["evidenceKind"] = kind
    if need is not None:
        criterion["businessContextNeed"] = need
    return criterion, []


def _accept_need(
    need: Mapping[str, Any],
    label: str,
    criterion_id: str,
    criterion_ids: tuple[str, ...],
    rule_id: str,
) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    question = str(need.get("question") or "").strip()
    observation = str(need.get("observation") or "").strip()
    if not question or not observation:
        errors.append(f"{label}: businessContextNeed requires question and observation")
    try:
        assert_neutral_customer_text(question, observation)
    except RuntimeError:
        errors.append(
            f"{label}: businessContextNeed text must be customer-safe: no rule ids, legal citations, file paths or internal terms"
        )
    resolves = list(dict.fromkeys(need.get("resolutionCriterionIds") or [criterion_id]))
    if not resolves or any(c not in criterion_ids for c in resolves):
        errors.append(f"{label}: resolutionCriterionIds must be assigned criterion ids")
    index = need.get("authoredConditionIndex")
    if index is not None and (isinstance(index, bool) or not isinstance(index, int) or index < 0):
        errors.append(f"{label}: authoredConditionIndex must be a non-negative integer")
    if errors:
        return None, errors
    body: dict[str, Any] = {
        "needId": f"need:{rule_id}:{criterion_id}:{hashlib.sha256(question.encode('utf-8')).hexdigest()[:12]}",
        "question": question,
        "observation": observation,
        "resolutionCriterionIds": resolves,
    }
    if index is not None:
        body["authoredConditionIndex"] = index
    return body, []


__all__ = [
    "AcceptedRuleAssessment",
    "RuleAssessmentValidationError",
    "derive_rule_status",
    "validate_rule_assessment",
]
