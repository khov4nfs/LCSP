"""Source-authored review frames; proposals only, never automatic legal judgments."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from evals.legal_reasoning.p14_cohort import canonical_digest
from evals.policy_baseline import _load_legal_context

# Each declaration is authored independently of fixture verdicts and model output.
# Actors and material distinctions refer to the original clauses listed here.
FRAMES = (
    (
        "classification-before-use",
        "law-10",
        "1",
        "Nhà cung cấp",
        "Classify before first use",
        "provider before first use",
        "organization is solely deployer",
        "actor",
    ),
    (
        "classification-dossier",
        "law-10",
        "1",
        "Nhà cung cấp",
        "Keep classification dossier for medium/high risk",
        "provider with medium-risk system",
        "provider with low-risk system",
        "risk level",
    ),
    (
        "deployer-integrity",
        "law-10",
        "2",
        "Bên triển khai",
        "Preserve system safety and integrity during use",
        "deployer operating the system",
        "organization does not deploy or use the system",
        "actor",
    ),
    (
        "material-change-reclassification",
        "law-10",
        "2",
        "Bên triển khai",
        "Coordinate reclassification with provider after changes causing new or higher risk",
        "deployer modifies functionality creating higher risk",
        "deployer makes no change creating new or higher risk",
        "material change",
    ),
    (
        "classification-notification",
        "law-10",
        "3",
        "nhà cung cấp",
        "Notify classification before use for medium/high risk",
        "provider with high-risk system before use",
        "provider with low-risk system",
        "risk level",
    ),
    (
        "direct-interaction-disclosure",
        "law-11",
        "1",
        "Nhà cung",
        "Enable recognition of direct AI interaction",
        "direct interaction with no established statutory exception",
        "no direct human interaction",
        "trigger",
    ),
    (
        "public-authenticity-disclosure",
        "law-11",
        "3",
        "Bên triển khai",
        "Clearly disclose public AI-created/edited content capable of misleading about authenticity",
        "deployer publishes misleading AI-created content publicly",
        "same content remains private internal evidence",
        "public release",
    ),
    (
        "impersonation-visible-label",
        "law-11",
        "4",
        "Bên triển khai",
        "Recognizably label imitation of real people or events; artistic presentation has a suitable-method qualifier",
        "deployer publishes impersonating audiovisual content",
        "content does not simulate a real person or actual event",
        "trigger",
    ),
    (
        "ongoing-transparency",
        "law-11",
        "5",
        "Nhà cung cấp và bên triển khai",
        "Maintain transparency information throughout provision to users",
        "provider and deployer continue supplying content to users",
        "supply has ended and no ongoing provision is asserted",
        "duration",
    ),
    (
        "third-party-access-limit",
        "decree-12",
        "3",
        "nhà cung cấp",
        "Limit third-party technical/data information to lawful access and control",
        "third-party model information is within lawful access/control",
        "requested third-party internals are outside lawful access/control",
        "access limit",
    ),
    (
        "source-code-exclusion",
        "decree-12",
        "4",
        "nhà cung",
        "Dossier does not by itself mandate source code/parameters/raw training data disclosure; preserve statutory override",
        "dossier requests ordinary identification information",
        "same dossier demand expands to protected source code without a statutory override",
        "exclusion",
    ),
    (
        "equivalent-technical-documents",
        "decree-12",
        "5",
        "Nhà cung cấp",
        "International-standard technical documents may satisfy dossier components only if required information is complete",
        "equivalent documents contain every required information component",
        "equivalent documents omit a required component",
        "condition",
    ),
    (
        "dossier-retention",
        "decree-12",
        "6",
        "Nhà cung cấp, bên triển khai",
        "Provider and deployer retain dossier throughout system operation",
        "provider and deployer continue operating the system",
        "system is no longer operating; other retention obligations are outside this target",
        "duration",
    ),
    (
        "technical-mark-preservation",
        "decree-17",
        "4",
        "Nhà cung cấp",
        "Maintain marking during generation/export/provision within controlled system functions",
        "provider controls the export function",
        "the relevant function is outside provider system control",
        "control boundary",
    ),
    (
        "open-system-deployer-marking",
        "decree-17",
        "5",
        "Bên triển khai",
        "Deployer of open/free system marks outputs supplied to the public; provider enablement is a distinct obligation",
        "deployer of an open/free system supplies audiovisual output publicly",
        "same deployer uses output internally without public supply",
        "actor and public release",
    ),
)

# Authored actor correspondence, independent of scenario verdicts or model text.
AUTHORED_ACTORS = {
    "classification-before-use": "Nhà cung cấp",
    "classification-dossier": "Nhà cung cấp",
    "deployer-integrity": "Bên triển khai",
    "material-change-reclassification": "Bên triển khai phối hợp nhà cung cấp",
    "classification-notification": "Nhà cung cấp",
    "direct-interaction-disclosure": "Nhà cung cấp",
    "public-authenticity-disclosure": "Bên triển khai",
    "impersonation-visible-label": "Bên triển khai",
    "ongoing-transparency": "Nhà cung cấp và bên triển khai",
    "third-party-access-limit": "Nhà cung cấp",
    "source-code-exclusion": "Nhà cung cấp",
    "equivalent-technical-documents": "Nhà cung cấp",
    "dossier-retention": "Nhà cung cấp và bên triển khai",
    "technical-mark-preservation": "Nhà cung cấp",
    "open-system-deployer-marking": "Bên triển khai",
}


def build_review_frames(output: Path) -> dict:
    """Business purpose: Give reviewers provision-grounded frames and material counterfactuals.

    Business rules:
    - Source text is copied from revalidated official PDFs, never from generated LCSP output.
    - Scenario labels are explicit candidate proposals; quality dimensions need independent review.
    - Actor declarations and dates are linked to exact originals, without interpreting free text automatically.
    - Evidence from any relevant lifecycle phase remains in scope; no alternate business mode exists.

    Execution flow:
    1. Load verified original provisions and attach the authored actor/action/condition distinctions.
    2. Add two explicit counterfactual fact scenarios per frame and source/effectivity pins.
    3. Save a single review package with no reviewer approvals or executed-output claim.

    Failure cases:
    - Missing source, clause, actor anchor, or temporal reference stops package construction.

    Side effects:
    - Reads official corpus and writes the requested candidate review artifact only.
    """
    context, pins = _load_legal_context()
    frames = []
    for identity, key, clause, actor, action, left, right, changed in FRAMES:
        source = context[key]
        # This checks the authored anchor's presence, not legal correspondence by keyword matching.
        if actor not in source.content or f"{clause}." not in source.content:
            raise ValueError(f"AUTHORED_FRAME_SOURCE_ANCHOR_MISSING:{identity}")
        frames.append(
            {
                "frameId": identity,
                "source": source.model_dump(),
                "clause": clause,
                "actorSourceAnchor": actor,
                "expectedActor": AUTHORED_ACTORS[identity],
                "requiredAction": action,
                "materialConditionOrLimit": changed,
                "interpretationStatus": "CANDIDATE_REQUIRES_INDEPENDENT_LEGAL_REVIEW",
                "reviewStatus": "CANDIDATE",
                "reviewers": [],
                "rationale": f"Review {source.document_id}, {source.locator}, clause {clause} in original Vietnamese. Preserve the declared actor and {changed}; compare the two stated facts, not repository names or fixture verdicts.",
                "scenarioPair": {
                    "pairId": identity + "-pair",
                    "changedFact": changed,
                    "scenarios": [
                        {
                            "caseId": identity + "-trigger",
                            "facts": left,
                            "proposedTargetTreatment": "ASSESS_STATED_TARGET_AND_LIMITS",
                        },
                        {
                            "caseId": identity + "-counterfactual",
                            "facts": right,
                            "proposedTargetTreatment": "REASSESS_MATERIAL_LIMIT_DO_NOT_TRANSFER_PRIOR_CONCLUSION",
                        },
                    ],
                },
                "reviewDimensions": [
                    "ACTOR",
                    "CONDITIONS",
                    "EXCEPTIONS",
                    "EVIDENCE_SUFFICIENCY",
                    "UNSUPPORTED_CONCLUSION",
                ],
                "annotationDecision": "Record independently justified labels; no quality label is derived from an applicability/compliance fixture verdict.",
            }
        )
    temporal = {
        "asOf": "2027-10-01",
        "lawEffectiveDate": "2026-03-01",
        "decreeEffectiveDate": "2026-05-01",
        "sourceReferences": {
            key: context[key].model_dump() for key in ("law-34", "law-35", "decree-45")
        },
        "decision": "Review first operation date, sector, transitional deadlines and any suspension facts per scenario; asOf alone does not decide applicability.",
        "interpretationStatus": "CANDIDATE_REQUIRES_INDEPENDENT_LEGAL_REVIEW",
    }
    package = {
        "version": "LCSP-400-SOURCE-REVIEW-FRAMES-V1",
        "jurisdiction": "VIETNAM",
        "businessBoundary": "Analyze the complete admitted source; retain relevant development, deployment, production and operational evidence.",
        "corpusPins": pins,
        "temporalFrame": temporal,
        "frames": frames,
        "frameCount": len(frames),
        "counterfactualScenarioCount": len(frames) * 2,
        "metricEligibility": "NOT_SCORED_REVIEW_REQUIREMENTS_ONLY",
        "actualPreparationOutputCount": 0,
    }
    package["packageSha256"] = canonical_digest(package)
    validate_review_frames(package, context=context)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return package


def validate_review_frames(package: dict, *, context: dict | None = None) -> None:
    """Business purpose: Reject altered actor, clause, source and fixed as-of declarations.

    Business rules:
    - Authored declarations pin actor/action/condition correspondence to exact original provisions.
    - Matching bytes is structural evidence; candidate interpretations remain unreviewed.
    - Fixed as-of and effectivity references cannot be silently rewritten by recomputing a hash.

    Execution flow:
    1. Verify the package hash and load the official provision context when needed.
    2. Compare every declared source, actor, clause and action with this authored frame version.
    3. Verify fixed dates and their exact original temporal provisions.

    Failure cases:
    - Modified sources, roles, dates, frame inventory or interpretation status raises ValueError.

    Side effects:
    - Reads official source assets when no verified context is provided; writes nothing.
    """
    if package.get("packageSha256") != canonical_digest(
        {k: v for k, v in package.items() if k != "packageSha256"}
    ):
        raise ValueError("SOURCE_REVIEW_PACKAGE_DIGEST_MISMATCH")
    if context is None:
        context, _ = _load_legal_context()
    frames = package.get("frames", [])
    if len(frames) != len(FRAMES):
        raise ValueError("SOURCE_REVIEW_FRAME_INVENTORY_MISMATCH")
    for row, declaration in zip(frames, FRAMES, strict=True):
        identity, key, clause, actor, action, left, right, changed = declaration
        if row.get("source") != context[key].model_dump():
            raise ValueError("SOURCE_REVIEW_ORIGINAL_BYTES_MISMATCH")
        if row.get("expectedActor") != AUTHORED_ACTORS[identity]:
            raise ValueError("SOURCE_REVIEW_ACTOR_FRAME_MISMATCH")
        if (
            row.get("frameId"),
            row.get("clause"),
            row.get("actorSourceAnchor"),
            row.get("requiredAction"),
            row.get("materialConditionOrLimit"),
        ) != (identity, clause, actor, action, changed):
            raise ValueError("SOURCE_REVIEW_ACTOR_FRAME_MISMATCH")
        if [
            s.get("facts") for s in row.get("scenarioPair", {}).get("scenarios", [])
        ] != [left, right]:
            raise ValueError("SOURCE_REVIEW_COUNTERFACTUAL_FACTS_MISMATCH")
        if row.get("reviewStatus") != "CANDIDATE" or row.get("reviewers") != []:
            raise ValueError("SOURCE_REVIEW_CANDIDATE_SNAPSHOT_IMMUTABLE")
    temporal = package.get("temporalFrame", {})
    if (
        temporal.get("asOf"),
        temporal.get("lawEffectiveDate"),
        temporal.get("decreeEffectiveDate"),
    ) != ("2027-10-01", "2026-03-01", "2026-05-01"):
        raise ValueError("SOURCE_REVIEW_ASOF_EFFECTIVITY_MISMATCH")
    if temporal.get("sourceReferences") != {
        key: context[key].model_dump() for key in ("law-34", "law-35", "decree-45")
    }:
        raise ValueError("SOURCE_REVIEW_EFFECTIVITY_ORIGINAL_MISMATCH")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    result = build_review_frames(parser.parse_args().output)
    print(
        json.dumps(
            {
                "frames": result["frameCount"],
                "scenarios": result["counterfactualScenarioCount"],
                "reviewStatus": "CANDIDATE",
            }
        )
    )
