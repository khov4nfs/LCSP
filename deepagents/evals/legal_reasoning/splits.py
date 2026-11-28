"""Pinned leakage-aware development and holdout membership for LCSP-400 cases."""

from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path
from typing import Any

from evals.legal_reasoning.p14_cohort import canonical_digest

SPLIT_VERSION = "LCSP-400-DEV-HOLDOUT-SPLIT-V1"
RELATED_PROVISION_GROUPS = {
    "GDPR_ART_3_": "GDPR_TERRITORIAL_SCOPE",
    "GDPR_RECITAL_23": "GDPR_TERRITORIAL_SCOPE",
    "GDPR_ART_33_": "GDPR_BREACH_RESPONSE",
    "GDPR_ART_34_": "GDPR_BREACH_RESPONSE",
}


def _semantic_grouping_keys(record: dict[str, Any]) -> set[str]:
    """Business purpose: Identify every grouping constraint that must prevent split leakage.

    Business rules:
    - A counterfactual pair keeps its members together.
    - Repeated and explicitly related source provisions share one group.
    - This grouping is evaluation metadata and does not decide the legal meaning of a provision.

    Execution flow:
    1. Collect source/provision keys and any counterfactual pair key.
    2. Resolve them through the stable, documented provision-family policy.
    3. Return the keys used to join this case to every materially related case.

    Failure cases:
    - Missing source or provision references fail closed rather than receiving an ungrouped split.

    Side effects:
    - None: reads annotation metadata only.
    """
    source = record.get("legalSource") or {}
    refs = sorted(source.get("provisionRefs") or [])
    if not source.get("sourceId") or not refs:
        raise ValueError(f"SPLIT_SOURCE_REFERENCE_MISSING:{record.get('caseId')}")
    pair = record.get("counterfactualPair")
    keys = [f"{source['sourceId']}:{ref}" for ref in refs]
    if pair:
        keys.append(f"PAIR:{pair['pairId']}")
    families = [
        family
        for ref in refs
        for prefix, family in RELATED_PROVISION_GROUPS.items()
        if ref.startswith(prefix)
    ]
    if families:
        keys.append(f"{source['sourceId']}:FAMILY:{min(set(families))}")
    return set(keys)


def build_split_manifest(
    candidate_records: list[dict[str, Any]], cohort: dict[str, Any]
) -> dict[str, Any]:
    """Business purpose: Freeze repeatable development and holdout groups without semantic leakage.

    Business rules:
    - Candidate cases sharing legal provisions or a counterfactual pair stay in one split group.
    - The compact shared SCRIPTED engineering cohort is DEV-only and cannot support generalization claims.
    - Split membership derives from a versioned stable hash rule and is fully enumerated in the artifact.

    Execution flow:
    1. Group canonical candidate records and shared P14 engineering cases.
    2. Assign candidate groups using the fixed SHA-256 bucket rule; assign the shared cohort to DEV.
    3. Pin dataset/cohort inputs, group counts, assignments, and the full artifact digest.

    Failure cases:
    - Duplicate cases, malformed pair links, or missing provision references raise ValueError.

    Side effects:
    - None: returns a reproducible in-memory manifest.
    """
    groups: dict[str, list[str]] = {}
    parent: dict[str, str] = {}
    row_keys: dict[str, set[str]] = {}

    def find(case_id: str) -> str:
        """Business purpose: Resolve the current component for one candidate case.

        Business rules:
        - Every candidate case is initialized before any grouping key joins it to another case.
        - Root selection remains deterministic under sorted union operations.

        Execution flow:
        1. Follow parent links to the component root.
        2. Compress the traversed path to that root.
        3. Return the root case identifier.

        Failure cases:
        - An uninitialized case identifier raises KeyError and stops split construction.

        Side effects:
        - Updates only the local parent map for path compression.
        """
        root = case_id
        while parent[root] != root:
            root = parent[root]
        while parent[case_id] != case_id:
            next_case_id = parent[case_id]
            parent[case_id] = root
            case_id = next_case_id
        return root

    def union(left: str, right: str) -> None:
        """Business purpose: Join cases that share a counterfactual or legal-source grouping key.

        Business rules:
        - Related cases must remain in the same split group before DEV/HOLDOUT assignment.
        - The lexicographically smaller root wins to make component construction stable.

        Execution flow:
        1. Resolve each case's current root.
        2. Return immediately when both cases already share a root.
        3. Link the greater root identifier to the lesser root identifier.

        Failure cases:
        - Uninitialized case identifiers raise KeyError and stop split construction.

        Side effects:
        - Mutates the local parent map used to build this in-memory split manifest.
        """
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            first, second = sorted((left_root, right_root))
            parent[second] = first

    key_owner: dict[str, str] = {}
    candidate_ids: set[str] = set()
    for record in candidate_records:
        case_id = record["caseId"]
        if case_id in candidate_ids:
            raise ValueError(f"SPLIT_DUPLICATE_CASE:{case_id}")
        candidate_ids.add(case_id)
        parent[case_id] = case_id
        keys = _semantic_grouping_keys(record)
        row_keys[case_id] = keys
        for key in sorted(keys):
            owner = key_owner.setdefault(key, case_id)
            union(case_id, owner)

    component_keys: dict[str, set[str]] = {}
    for case_id, keys in row_keys.items():
        component_keys.setdefault(find(case_id), set()).update(keys)
    for case_id in sorted(candidate_ids):
        root = find(case_id)
        group_id = min(component_keys[root])
        groups.setdefault(group_id, []).append(case_id)
    cohort_ids: set[str] = set()
    for record in cohort.get("cases", []):
        case_id = record["cohortCaseId"]
        if case_id in cohort_ids or case_id in candidate_ids:
            raise ValueError(f"SPLIT_DUPLICATE_COHORT_CASE:{case_id}")
        cohort_ids.add(case_id)
        groups.setdefault(record["splitGroupId"], []).append(case_id)

    grouped_rows = []
    for group_id, case_ids in sorted(groups.items()):
        is_cohort = all(case_id in cohort_ids for case_id in case_ids)
        if is_cohort:
            split = "DEV"
        else:
            bucket = int(sha256(group_id.encode("utf-8")).hexdigest()[:8], 16) % 5
            split = "HOLDOUT" if bucket == 0 else "DEV"
        grouped_rows.append(
            {"groupId": group_id, "split": split, "caseIds": sorted(case_ids)}
        )
    body = {
        "splitVersion": SPLIT_VERSION,
        "splitId": "lcsp400-legal-reasoning-v1-frozen",
        "assignmentRule": "SHA256(groupId)[0:8] mod 5 == 0 => HOLDOUT; otherwise DEV; shared SCRIPTED engineering cohort => DEV",
        "candidateDatasetSha256": canonical_digest(candidate_records),
        "sharedCohortSha256": cohort.get("cohortSha256"),
        "candidateCaseCount": len(candidate_ids),
        "sharedCohortCaseCount": len(cohort_ids),
        "groups": grouped_rows,
        "splitCaseCounts": {
            split: sum(
                len(row["caseIds"]) for row in grouped_rows if row["split"] == split
            )
            for split in ("DEV", "HOLDOUT")
        },
        "splitGroupCounts": {
            split: sum(1 for row in grouped_rows if row["split"] == split)
            for split in ("DEV", "HOLDOUT")
        },
    }
    return {**body, "splitDigest": canonical_digest(body)}


def load_split_manifest(path: str | Path) -> dict[str, Any]:
    """Business purpose: Load and integrity-check the exact frozen split passed into a P14 run.

    Business rules:
    - Only the versioned split identity, digest, unique groups, and DEV/HOLDOUT values are accepted.
    - A digest pins assignments but does not establish dataset representativeness.

    Execution flow:
    1. Parse the JSON artifact.
    2. Recompute the digest and validate group membership and counts.
    3. Return the validated manifest for run-manifest binding.

    Failure cases:
    - Missing, stale, duplicate, or invalid split metadata raises ValueError.

    Side effects:
    - Reads the selected local split file.
    """
    manifest = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        not isinstance(manifest, dict)
        or manifest.get("splitVersion") != SPLIT_VERSION
        or manifest.get("splitDigest")
        != canonical_digest(
            {key: value for key, value in manifest.items() if key != "splitDigest"}
        )
        or not isinstance(manifest.get("groups"), list)
    ):
        raise ValueError("EVALUATION_SPLIT_MANIFEST_INVALID")
    seen: set[str] = set()
    for group in manifest["groups"]:
        if not isinstance(group, dict) or group.get("split") not in {"DEV", "HOLDOUT"}:
            raise ValueError("EVALUATION_SPLIT_GROUP_INVALID")
        ids = group.get("caseIds")
        if not isinstance(ids, list) or not ids or len(ids) != len(set(ids)):
            raise ValueError("EVALUATION_SPLIT_MEMBERSHIP_INVALID")
        if seen.intersection(ids):
            raise ValueError("EVALUATION_SPLIT_DUPLICATE_MEMBER")
        seen.update(ids)
    return manifest


def validate_split_membership(
    manifest: dict[str, Any],
    candidate_records: list[dict[str, Any]],
    cohort: dict[str, Any],
    p14_cases: list[dict[str, Any]],
) -> dict[str, str]:
    """Business purpose: Prove every current candidate, cohort, and executed P14 case retains its frozen group.

    Business rules:
    - Candidate and cohort snapshot digests must match the frozen split inputs.
    - P14 case split strings must agree with cohort assignment, and each run case must be assigned.

    Execution flow:
    1. Check input pins and construct a unique case-to-split inventory.
    2. Require exact candidate/cohort membership and P14 split correspondence.
    3. Return deterministic memberships for artifact reporting.

    Failure cases:
    - Changed inputs, missing memberships, or split drift raise ValueError.

    Side effects:
    - None: validates in-memory evaluation artifacts.
    """
    expected_manifest = build_split_manifest(candidate_records, cohort)
    if manifest.get("splitDigest") != expected_manifest.get("splitDigest"):
        raise ValueError("EVALUATION_SPLIT_ASSIGNMENT_OR_GROUPING_DRIFT")
    if manifest.get("candidateDatasetSha256") != canonical_digest(candidate_records):
        raise ValueError("EVALUATION_SPLIT_CANDIDATE_SNAPSHOT_MISMATCH")
    if manifest.get("sharedCohortSha256") != cohort.get("cohortSha256"):
        raise ValueError("EVALUATION_SPLIT_COHORT_SNAPSHOT_MISMATCH")
    membership = {
        case_id: group["split"]
        for group in manifest["groups"]
        for case_id in group["caseIds"]
    }
    expected_ids = {row["caseId"] for row in candidate_records} | {
        row["cohortCaseId"] for row in cohort.get("cases", [])
    }
    if {key for key in membership if not key.startswith("CASE-")} != expected_ids:
        raise ValueError("EVALUATION_SPLIT_MEMBERSHIP_SNAPSHOT_MISMATCH")
    cohort_by_p14 = {row["p14CaseId"]: row for row in cohort.get("cases", [])}
    for row in p14_cases:
        cohort_row = cohort_by_p14.get(row.get("case_id"))
        if cohort_row is None:
            raise ValueError(f"EVALUATION_SPLIT_P14_CASE_UNMAPPED:{row.get('case_id')}")
        if row.get("split") != cohort_row["split"]:
            raise ValueError(
                f"EVALUATION_SPLIT_P14_SPLIT_MISMATCH:{row.get('case_id')}"
            )
    return dict(sorted(membership.items()))
