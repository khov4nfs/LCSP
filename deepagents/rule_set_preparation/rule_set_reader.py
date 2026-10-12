"""The single Python reader of the ACTIVE compliance rule set.

Assessments only read and pin the rule_set the API reports as ACTIVE. There is no
compile, recovery, cache or bundle path: a missing rule_set is a preparation state,
never inline compilation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tools.common.capabilities.platform.api_client import WorkerCallbackError

ACTIVE_RULE_SET_NOT_FOUND = "ACTIVE_COMPLIANCE_RULE_SET_NOT_FOUND"


@dataclass(frozen=True)
class ActiveRuleSet:
    """The pinned, immutable ACTIVE rule set as served by the API."""

    rule_set_version_id: str
    version: str
    legal_source_version_id: str
    rule_set_digest: str
    legal_requirements: tuple[dict[str, Any], ...]
    assessment_rules: tuple[dict[str, Any], ...]
    context_relations: tuple[dict[str, Any], ...]


def read_active_rule_set(api: Any) -> ActiveRuleSet | None:
    """Return the ACTIVE rule_set, or ``None`` when none exists (not an error)."""
    try:
        data = api.get_active_compliance_rule_set()
    except WorkerCallbackError as error:
        if getattr(error, "error_code", None) == ACTIVE_RULE_SET_NOT_FOUND:
            return None
        raise
    return ActiveRuleSet(
        rule_set_version_id=str(data["ruleSetVersionId"]),
        version=str(data["version"]),
        legal_source_version_id=str(data["legalSourceVersionId"]),
        rule_set_digest=str(data["ruleSetDigest"]),
        legal_requirements=tuple(data.get("legalRequirements") or ()),
        assessment_rules=tuple(data.get("assessmentRules") or ()),
        context_relations=tuple(data.get("contextRelations") or ()),
    )
