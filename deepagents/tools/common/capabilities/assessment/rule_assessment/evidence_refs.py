"""Runtime-minted evidence refs: the model never manufactures a citation.

Governed tools (``cite_repository_source``, ``get_code_snippet``) mint a ref during the
current rule execution after live-verifying the range. The ref carries an HMAC bound to
{assessmentId, engineeringRuleId, ruleExecutionId}, keyed by a per-process secret, so a
ref cannot be forged by a model or replayed from another rule/execution. Persisted refs are
canonical (mac stripped).

    minted:    source:{commitSha}:{path}#L{start}-L{end}~{mac24}
    canonical: source:{commitSha}:{path}#L{start}-L{end}
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from typing import Any

_KEY = os.urandom(32)  # per-process secret; never logged or persisted
_CANONICAL = re.compile(r"^source:([^:~]+):(.+)#L(\d+)-L(\d+)$")
_MINTED = re.compile(r"^(?P<canonical>.+)~(?P<mac>[0-9a-f]{24})$")


def _mac(context: Any, canonical: str) -> str:
    message = "|".join(
        (
            str(getattr(context, "assessment_id", None) or ""),
            str((tuple(getattr(context, "engineering_rule_ids", ()) or ()) or ("",))[0]),
            str(getattr(context, "rule_execution_id", None) or ""),
            canonical,
        )
    )
    return hmac.new(_KEY, message.encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def parse_canonical_ref(ref: str) -> dict[str, Any] | None:
    match = _CANONICAL.match(str(ref))
    if not match:
        return None
    return {
        "ref": str(ref),
        "commitSha": match.group(1),
        "path": match.group(2),
        "startLine": int(match.group(3)),
        "endLine": int(match.group(4)),
    }


def mint_evidence_ref(context: Any, path: str, start: int, end: int) -> str:
    """Mint a ref for an ALREADY live-verified range in the current rule execution."""
    canonical = f"source:{getattr(context, 'commit_sha', None)}:{path}#L{start}-L{end}"
    return f"{canonical}~{_mac(context, canonical)}"


def parse_verified_evidence_ref(ref: str, context: Any) -> dict[str, Any] | None:
    """The canonical entry when the mac verifies for this context and commit, else None.

    Callers must still re-verify the source itself against the live repository.
    """
    minted = _MINTED.match(str(ref))
    if not minted:
        return None
    entry = parse_canonical_ref(minted.group("canonical"))
    if entry is None or entry["commitSha"] != getattr(context, "commit_sha", None):
        return None
    if not hmac.compare_digest(minted.group("mac"), _mac(context, minted.group("canonical"))):
        return None
    return entry


def has_rule_execution(context: Any) -> bool:
    return bool(
        context is not None
        and getattr(context, "rule_execution_id", None)
        and getattr(context, "commit_sha", None)
        and len(tuple(getattr(context, "engineering_rule_ids", ()) or ())) == 1
    )


def cite_verified_source(
    context: Any,
    path: str,
    start: int,
    end: int,
    repository_root: str | None = None,
) -> dict[str, Any]:
    """Live-verify a range (fail closed) and mint its ref. Raises EvidenceClaimValidationError."""
    from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
        EvidenceClaimValidationError,
        normalize_source_path,
        verify_repository_source,
    )

    if not has_rule_execution(context):
        raise EvidenceClaimValidationError("no rule execution context: citations are unavailable")
    path = normalize_source_path(path)
    start, end = int(start), int(end)
    if start < 1 or end < start:
        raise EvidenceClaimValidationError("source location line range is invalid")
    verify_repository_source(path, start, end, repository_root, required=True)
    return {
        "evidenceRef": mint_evidence_ref(context, path, start, end),
        "path": path,
        "startLine": start,
        "endLine": end,
    }


__all__ = ["cite_verified_source", "has_rule_execution", "mint_evidence_ref", "parse_canonical_ref", "parse_verified_evidence_ref"]
