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
PM_REVIEW_CASE_IDS = (
    "RISK_CLASSIFICATION_BEFORE_USE", "DATA_PROCESSING_IMPACT_DOSSIER",
    "RISK_DOSSIER_CONTENT", "RISK_DOSSIER_RETENTION", "MATERIAL_CHANGE_REASSESSMENT",
    "OPERATIONAL_INFORMATION_MEASURES", "CHILD_PRIVACY_DISCLOSURE_CONSENT",
)
_CASE_EVIDENCE_FIELDS = (
    "legalSourceVersionId", "legalSourceVersion", "effectiveProvision", "locator",
    "sourceText", "sourceSha256", "effectStatus", "actor", "action", "trigger",
    "lifecycleStage", "repositoryVerifiableAspect", "proposedDisposition",
    "independentReviewerId", "goldRevision", "approvedGoldDigest",
)


def reviewed_case_package_preflight(package, raw, expected_sha256):
    """Business purpose: Reject an incomplete seven-case legal review package before comparison.

    Business rules:
    - Reported case titles are not gold; exact source evidence, independent review and externally pinned package bytes are mandatory.
    - Positive, mixed and unresolved controls are analytical fixtures, never new persisted stage enums or legal authority.
    Execution flow:
    1. Verify the external package digest, exact case coverage, source/gold hashes and independently reviewed controls.
    Failure cases:
    - Missing or inconsistent review inputs return explicit blocking codes without inferring legal labels.
    Side effects:
    - Pure validation; does not approve gold, activate rules or invoke a model.
    """
    errors = []
    if not isinstance(expected_sha256, str) or not _HASH.fullmatch(expected_sha256):
        errors.append("PM_REVIEW_PACKAGE_EXTERNAL_DIGEST_REQUIRED")
    elif sha256(raw).hexdigest() != expected_sha256:
        errors.append("PM_REVIEW_PACKAGE_DIGEST_MISMATCH")
    if json.loads(raw) != package:
        errors.append("PM_REVIEW_PACKAGE_BYTES_MISMATCH")
    if package.get("approvalStatus") != "HUMAN_APPROVED":
        errors.append("PM_REVIEW_PACKAGE_INDEPENDENT_APPROVAL_REQUIRED")
    authorization = package.get("evaluationAuthorization")
    if not isinstance(authorization, dict) or any(not authorization.get(key) for key in ("approvedBy", "budgetApprovalId", "modelConfigurationDigest", "holdoutSha256", "rubricSha256", "maximumProviderCost", "budgetCurrency")):
        errors.append("PM_MODEL_EVALUATION_AUTHORIZATION_REQUIRED")
    elif (any(not isinstance(authorization[key], str) or not _HASH.fullmatch(authorization[key]) for key in ("modelConfigurationDigest", "holdoutSha256", "rubricSha256"))
          or not isinstance(authorization["maximumProviderCost"], (int, float)) or isinstance(authorization["maximumProviderCost"], bool)
          or not isfinite(authorization["maximumProviderCost"]) or authorization["maximumProviderCost"] <= 0):
        errors.append("PM_MODEL_EVALUATION_AUTHORIZATION_INVALID")
    cases = package.get("cases", [])
    if (not isinstance(cases, list) or len(cases) != len(PM_REVIEW_CASE_IDS)
            or {row.get("caseId") for row in cases if isinstance(row, dict)} != set(PM_REVIEW_CASE_IDS)):
        errors.append("PM_REVIEW_PACKAGE_SEVEN_CASES_REQUIRED")
        return errors
    controls = package.get("controls", {})
    rows = list(cases)
    for kind in ("development", "mixed", "legalReviewRequired"):
        group = controls.get(kind) if isinstance(controls, dict) else None
        if not isinstance(group, list) or not group:
            errors.append("PM_REVIEW_CONTROL_REQUIRED:" + kind)
        else:
            rows.extend(group)
    for row in rows:
        identity = row.get("caseId", "CONTROL") if isinstance(row, dict) else "CONTROL"
        if not isinstance(row, dict):
            errors.append("PM_REVIEW_CASE_INVALID:" + identity)
            continue
        missing = [key for key in _CASE_EVIDENCE_FIELDS if not isinstance(row.get(key), str) or not row[key].strip()]
        if missing:
            errors.append("PM_REVIEW_CASE_EVIDENCE_REQUIRED:" + identity + ":" + ",".join(missing))
            continue
        if sha256(row["sourceText"].encode("utf-8")).hexdigest() != row["sourceSha256"]:
            errors.append("PM_REVIEW_SOURCE_TEXT_DIGEST_MISMATCH:" + identity)
        if not isinstance(row.get("sourceNodeIds"), list) or not row["sourceNodeIds"] or any(not isinstance(value, str) or not _HASH.fullmatch(value) for value in row["sourceNodeIds"]):
            errors.append("PM_REVIEW_SOURCE_NODE_PINS_REQUIRED:" + identity)
        gold = row.get("gold")
        if not isinstance(gold, dict) or stable_hash(gold) != row["approvedGoldDigest"]:
            errors.append("PM_REVIEW_CASE_GOLD_DIGEST_MISMATCH:" + identity)
        elif gold.get("legalSourceVersionId") != row["legalSourceVersionId"]:
            errors.append("PM_REVIEW_CASE_GOLD_SOURCE_MISMATCH:" + identity)
        elif (gold.get("goldApprovalStatus") != "HUMAN_APPROVED" or any(key not in gold for key in _REQUIRED_GOLD_FIELDS)
              or not isinstance(gold.get("normativeClaims"), list) or not gold["normativeClaims"]
              or any(not isinstance(claim, dict) or not {"claimId", "actor", "action", "modality", "claimType", "sourceNodeIds", "frame"} <= claim.keys() for claim in gold["normativeClaims"])):
            errors.append("PM_REVIEW_CASE_ATOMIC_GOLD_REQUIRED:" + identity)
    return errors


def reviewed_cases_in_aggregate_gold(package, gold):
    """Business purpose: Prevent an approved case package being scored against unrelated aggregate gold.

    Business rules:
    - Every reviewed case/control proposition, stage label and context edge must appear unchanged in the frozen holdout gold.
    Execution flow:
    1. Compare source identity and per-dimension reviewed rows with the aggregate gold used by the scorer.
    Failure cases:
    - Missing or different reviewed expectations block comparison instead of silently omitting a PM case.
    Side effects:
    - Pure validation; neither the holdout nor source inventory is rewritten.
    """
    errors = []
    rows = list(package.get("cases", []))
    for controls in package.get("controls", {}).values():
        if isinstance(controls, list):
            rows.extend(controls)
    for row in rows:
        case_gold = row.get("gold")
        if not isinstance(case_gold, dict):
            continue  # Package preflight records the missing external input.
        identity = row.get("caseId", "CONTROL")
        if case_gold.get("legalSourceVersionId") != gold.get("legalSourceVersionId"):
            errors.append("PM_REVIEW_AGGREGATE_GOLD_SOURCE_MISMATCH:" + identity)
        for key in _REQUIRED_GOLD_FIELDS:
            expected, aggregate = case_gold.get(key), gold.get(key)
            if not isinstance(expected, list) or not isinstance(aggregate, list) or any(item not in aggregate for item in expected):
                errors.append("PM_REVIEW_AGGREGATE_GOLD_CASE_MISSING:" + identity + ":" + key)
    return errors


def paired_eval_preflight(baseline, candidate, review_package=None):
    """Business purpose: Keep baseline/candidate evidence comparable without altering a holdout.

    Business rules:
    - Model configuration, source pins, gold revision and approved EN bundle must be identical; usage/cost remain separate measured receipts.
    Execution flow:
    1. Compare immutable identities and require non-synthetic authorized instruction bundle provenance.
    Failure cases:
    - Different or missing execution identities block a release comparison.
    Side effects:
    - Pure comparison; no provider call, billing adjustment or legal approval.
    """
    errors = []
    for key in ("model", "sourcePins", "goldReviewerRevision"):
        if not baseline.get(key) or baseline.get(key) != candidate.get(key):
            errors.append("PAIRED_EVAL_IDENTITY_MISMATCH:" + key)
    for manifest in (baseline, candidate):
        bundle = manifest.get("instructionBundle")
        if not isinstance(bundle, dict) or any(not bundle.get(key) for key in ("id", "approvalIdentity", "approvalRevision", "enRuntimeBundleDigest")) or str(bundle.get("approvalIdentity", "")).startswith("TEST_ONLY"):
            errors.append("PAIRED_EVAL_APPROVED_RUNTIME_REQUIRED")
    if baseline.get("instructionBundle") != candidate.get("instructionBundle"):
        errors.append("PAIRED_EVAL_INSTRUCTION_BUNDLE_MISMATCH")
    if review_package is not None:
        source_version = candidate.get("sourcePins", {}).get("legalSourceVersionId")
        if any(row.get("legalSourceVersionId") != source_version for row in review_package.get("cases", [])):
            errors.append("PAIRED_EVAL_REVIEW_CASE_SOURCE_MISMATCH")
        authorization = review_package.get("evaluationAuthorization") or {}
        for manifest in (baseline, candidate):
            if stable_hash(manifest.get("model")) != authorization.get("modelConfigurationDigest"):
                errors.append("PAIRED_EVAL_AUTHORIZED_MODEL_MISMATCH")
            if manifest.get("evaluationHoldoutSha256") != authorization.get("holdoutSha256") or manifest.get("evaluationRubricSha256") != authorization.get("rubricSha256"):
                errors.append("PAIRED_EVAL_HOLDOUT_OR_RUBRIC_MISMATCH")
            billing = manifest.get("billingReconciliation") or {}
            usage = manifest.get("usage") or {}
            if (any(not isinstance(billing.get(key), str) or not _HASH.fullmatch(billing[key]) for key in ("providerUsageReceiptSha256", "billingReceiptSha256"))
                    or billing.get("providerCost") != usage.get("providerCost") or billing.get("costCurrency") != usage.get("costCurrency")):
                errors.append("PAIRED_EVAL_PROVIDER_BILLING_EVIDENCE_REQUIRED")
            if usage.get("costCurrency") != authorization.get("budgetCurrency"):
                errors.append("PAIRED_EVAL_AUTHORIZED_CURRENCY_MISMATCH")
        costs = [(manifest.get("usage") or {}).get("providerCost") for manifest in (baseline, candidate)]
        limit = authorization.get("maximumProviderCost")
        if isinstance(limit, (int, float)) and not isinstance(limit, bool) and all(isinstance(cost, (int, float)) and not isinstance(cost, bool) and isfinite(cost) for cost in costs) and sum(costs) > limit:
            errors.append("PAIRED_EVAL_AUTHORIZED_BUDGET_EXCEEDED")
    return sorted(set(errors))


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
