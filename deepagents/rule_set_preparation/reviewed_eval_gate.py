"""Strict, provider-free preflight for independently approved semantic eval evidence.

This cannot establish legal correctness or authentic model execution on its own.
The expected gold digest MUST come from an independently controlled release
approval, not from the candidate output or gold JSON being scored.
"""
from __future__ import annotations

from hashlib import sha256
import json
from math import isfinite
import re
from typing import Any

from evals.run_manifest import stable_hash


_HASH = re.compile(r"^[0-9a-f]{64}$")
_REQUIRED_GOLD_FIELDS = (
    "normativeClaims", "contextClaims", "developmentClaimIds",
    "nonDevelopmentClaimIds", "unresolvedClaimIds",
    "materialContextClaimIds", "materialRelations",
)
_REQUIRED_USAGE = ("physicalAttempts", "failedAttempts", "inputTokens",
                   "cachedInputTokens", "outputTokens", "providerCost")


def reviewed_eval_preflight(
    gold: dict[str, Any],
    gold_bytes: bytes,
    candidate: dict[str, Any],
    manifest: dict[str, Any],
    expected_gold_sha256: str,
) -> list[str]:
    """Business purpose: Reject misleading 'approved' semantic eval receipts before release scoring.

    Business rules:
    - Independent release configuration must pin the exact gold file hash.
    - Gold must include source-reviewed content dimensions and a reviewer revision.
    - A candidate must bind an immutable model-facing prompt manifest with measured usage.
    - A synthetically perfect fixture cannot satisfy the reviewed-gold gate.

    Execution flow:
    1. Compare the file digest against the external approval hash and review metadata.
    2. Verify all required score dimensions and frozen candidate/manifest/source pins.
    3. Verify manifest integrity, configured model, resolved tools/prompts and usage.
    4. Return stable rejection codes; absence of reasons only validates input provenance.

    Failure cases:
    - Missing, synthetic, stale or conflicting evidence returns explicit blocking codes.

    Side effects:
    - Pure validation; does not call a model, grant legal approval or write files.
    """
    failures: list[str] = []
    # A caller must not combine reviewed bytes with an independently edited
    # in-memory gold object (for example a forged HUMAN_APPROVED marker).
    try:
        if json.loads(gold_bytes) != gold:
            failures.append("REVIEWED_EVAL_GOLD_OBJECT_BYTES_MISMATCH")
    except (UnicodeError, ValueError, TypeError):
        failures.append("REVIEWED_EVAL_GOLD_BYTES_INVALID")
    if not isinstance(expected_gold_sha256, str) or _HASH.fullmatch(expected_gold_sha256) is None:
        failures.append("REVIEWED_EVAL_EXPECTED_HASH_INVALID")
    elif sha256(gold_bytes).hexdigest() != expected_gold_sha256:
        failures.append("REVIEWED_EVAL_GOLD_HASH_MISMATCH")

    if gold.get("goldApprovalStatus") != "HUMAN_APPROVED":
        failures.append("REVIEWED_EVAL_GOLD_NOT_APPROVED")
    revision = gold.get("goldReviewerRevision")
    if not isinstance(revision, str) or not revision.strip():
        failures.append("REVIEWED_EVAL_GOLD_REVIEW_REVISION_MISSING")
    if any(key not in gold for key in _REQUIRED_GOLD_FIELDS):
        failures.append("REVIEWED_EVAL_GOLD_COVERAGE_INCOMPLETE")
    elif (
        not isinstance(gold["normativeClaims"], list)
        or not gold["normativeClaims"]
        or any(not isinstance(row, dict) or not
               {"claimId", "actor", "action", "modality", "claimType", "sourceNodeIds", "frame"} <= row.keys()
               for row in gold["normativeClaims"])
    ):
        failures.append("REVIEWED_EVAL_GOLD_NORMATIVE_FRAME_MISSING")
    if "contextClaims" in gold and (
        not isinstance(gold["contextClaims"], list)
        or any(not isinstance(row, dict) or not
               {"claimId", "claimType", "semanticAuthority", "legalSourceVersionId", "sourceNodeIds", "frame"}
               <= row.keys() for row in gold["contextClaims"])
    ):
        failures.append("REVIEWED_EVAL_GOLD_CONTEXT_FRAME_MISSING")

    if manifest.get("schemaVersion") != "LCSP_MODEL_FACING_MANIFEST_V1":
        failures.append("REVIEWED_EVAL_MANIFEST_SCHEMA_INVALID")
    if manifest.get("component") != "rule-set-preparation":
        failures.append("REVIEWED_EVAL_MANIFEST_WRONG_COMPONENT")
    if (not isinstance(manifest.get("runId"), str)
            or candidate.get("runId") != manifest.get("runId")
            or manifest.get("responseLanguage") not in {"vi", "en"}
            or candidate.get("responseLanguage") != manifest.get("responseLanguage")):
        failures.append("REVIEWED_EVAL_RUN_OR_LOCALE_MISMATCH")
    identity = manifest.get("manifestSha256")
    if not isinstance(identity, str) or _HASH.fullmatch(identity) is None:
        failures.append("REVIEWED_EVAL_MANIFEST_DIGEST_INVALID")
    elif stable_hash({key: value for key, value in manifest.items() if key != "manifestSha256"}) != identity:
        failures.append("REVIEWED_EVAL_MANIFEST_INTEGRITY_FAILED")
    if candidate.get("promptManifestSha256") != identity or not identity:
        failures.append("REVIEWED_EVAL_CANDIDATE_MANIFEST_MISMATCH")
    pins = manifest.get("sourcePins")
    if not isinstance(pins, dict) or pins.get("legalSourceVersionId") != gold.get("legalSourceVersionId"):
        failures.append("REVIEWED_EVAL_LEGAL_SOURCE_PIN_MISMATCH")
    if manifest.get("goldReviewerRevision") != revision or not revision:
        failures.append("REVIEWED_EVAL_GOLD_REVISION_MISMATCH")

    model = manifest.get("model")
    if not isinstance(model, dict) or not model.get("configuredModelId"):
        failures.append("REVIEWED_EVAL_MODEL_ID_MISSING")
    if any(not isinstance(manifest.get(key), dict)
           or not manifest[key]
           or any(not isinstance(value, str) or _HASH.fullmatch(value) is None
                  for value in manifest[key].values())
           for key in ("promptsSha256", "toolDescriptionsSha256")):
        failures.append("REVIEWED_EVAL_EXECUTION_HASHES_MISSING")

    usage = manifest.get("usage")
    if not isinstance(usage, dict) or any(
        not isinstance(usage.get(key), int) or isinstance(usage.get(key), bool)
        or usage[key] < 0
        for key in _REQUIRED_USAGE if key != "providerCost"
    ):
        failures.append("REVIEWED_EVAL_USAGE_INCOMPLETE")
    else:
        if usage["physicalAttempts"] == 0 or usage["failedAttempts"] > usage["physicalAttempts"]:
            failures.append("REVIEWED_EVAL_USAGE_INCONSISTENT")
    if not isinstance(usage, dict) or (
        not isinstance(usage.get("providerCost"), (int, float))
        or isinstance(usage.get("providerCost"), bool)
        or not isfinite(usage["providerCost"])
        or usage["providerCost"] < 0
        or not isinstance(usage.get("costCurrency"), str)
        or not usage["costCurrency"].strip()
    ):
        failures.append("REVIEWED_EVAL_BILLING_NOT_RECONCILED")

    # Even a clean preflight is only a frozen input/metadata contract. It does
    # not authenticate the source of the externally supplied trusted hash.
    return failures
