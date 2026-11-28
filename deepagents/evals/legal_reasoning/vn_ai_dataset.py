from __future__ import annotations

import argparse
import copy
import json
import re
from hashlib import sha256
from pathlib import Path
from typing import Any

from evals.benchmark_runner import DEEPAGENTS_ROOT, load_benchmark_cases
from evals.benchmark_schema import BenchmarkCase
from evals.legal_reasoning.p14_cohort import (
    canonical_digest,
    cohort_digest,
    fixture_fingerprints,
)
from evals.legal_reasoning.splits import build_split_manifest
from evals.policy_baseline import CORPUS, FIXTURES, _load_legal_context
from evals.run_manifest import stable_hash

PACKAGE = Path(__file__).resolve().parent
DATASET_VERSION = "LCSP-400-VIETNAM-AI-CANDIDATES-V1"
RUBRIC_VERSION = "LCSP-400-LEGAL-REASONING-RUBRIC-VN-AI-V1"
OMIT = {"archive-VN-AI-OPEN-MARK-ENABLEMENT", "prototype-VN-AI-OPEN-MARK-ENABLEMENT"}
GROUPS = {
    "VN-AI-RISK-VERSION": "VN_AI_RISK_DOSSIER",
    "VN-AI-INTERACTION-DISCLOSURE": "VN_AI_INTERACTION_DISCLOSURE",
    "VN-AI-MEDIA-MARK": "VN_AI_TECHNICAL_MARKING",
    "VN-AI-OPEN-MARK-ENABLEMENT": "VN_AI_TECHNICAL_MARKING",
}
DOC_IDS = {
    "134-2025-QH15": "VN_LAW_134_2025_QH15",
    "142-2026-ND-CP": "VN_DECREE_142_2026_ND_CP",
}
EFFECTIVE = {"134-2025-QH15": "2026-03-01", "142-2026-ND-CP": "2026-05-01"}


def _hash_file(path: Path) -> str:
    """Business purpose: Pin exact repository-evidence bytes to one candidate scenario.

    Business rules:
    - The hash identifies local fixture content and never establishes legal meaning.

    Execution flow:
    1. Read the selected file bytes.
    2. Calculate and return lowercase SHA-256.

    Failure cases:
    - Missing or unreadable files stop candidate generation.

    Side effects:
    - Reads one local file only."""
    return sha256(path.read_bytes()).hexdigest()


def _group(rule_id: str) -> str:
    """Business purpose: Keep related statutory target rules together in one frozen split group.

    Business rules:
    - The listed Article 17 media and open-marking duties share the declared semantic group.
    - Unknown target rule IDs cannot receive a split assignment.

    Execution flow:
    1. Resolve the target rule through the explicit allowlist.
    2. Return the split group identifier.

    Failure cases:
    - An unrecognized rule ID raises ValueError.

    Side effects:
    - None; returns evaluation metadata only."""
    if rule_id not in GROUPS:
        raise ValueError(f"VN_AI_RULE_GROUP_UNKNOWN:{rule_id}")
    return "EXPLICIT_SEMANTIC_GROUP:" + GROUPS[rule_id]


def _expect(label: str, rationale: str) -> dict[str, Any]:
    """Business purpose: Represent proposed legal labels without promoting them to reviewed gold.

    Business rules:
    - Every generated label remains CANDIDATE until a genuine human review is recorded.

    Execution flow:
    1. Store the categorical label, annotation rationale, and CANDIDATE confidence.

    Failure cases:
    - Empty or unsupported values are rejected later by the annotation schema.

    Side effects:
    - None; returns an in-memory annotation value."""
    return {"label": label, "details": [rationale], "confidence": "CANDIDATE"}


def _schema_and_rubric() -> tuple[dict[str, Any], dict[str, Any]]:
    """Business purpose: Version the annotation contract and examples for the Vietnamese AI-law candidate cohort.

    Business rules:
    - The seven established dimensions remain evaluation-only labels.
    - Active examples describe Vietnamese source-bound requirements and do not reuse GDPR legal conclusions.

    Execution flow:
    1. Load the immutable base schema and rubric.
    2. Set active dataset/rubric versions and target-binding fields.
    3. Replace examples and uncertainty guidance, then return both objects.

    Failure cases:
    - Missing base schema or rubric files stop artifact generation.

    Side effects:
    - Reads local base artifacts and creates new in-memory objects."""
    schema = json.loads(
        (PACKAGE / "annotation.schema.v1.json").read_text(encoding="utf-8")
    )
    rubric = json.loads((PACKAGE / "rubric.v1.json").read_text(encoding="utf-8"))
    schema["$id"] = (
        "https://lcsp.example/evals/legal-reasoning/annotation.schema.vn-ai.v1.json"
    )
    schema["title"] = "LCSP-400 Vietnamese AI law candidate annotation"
    schema["properties"]["datasetVersion"] = {"const": DATASET_VERSION}
    schema["properties"]["rubricVersion"] = {"const": RUBRIC_VERSION}
    schema["required"] += [
        "relatedLegalSources",
        "targetObligation",
        "semanticGroupId",
        "executionBinding",
    ]
    schema["properties"]["relatedLegalSources"] = {
        "type": "array",
        "items": copy.deepcopy(schema["properties"]["legalSource"]),
    }
    schema["properties"]["semanticGroupId"] = {"type": "string", "minLength": 1}
    schema["properties"]["targetObligation"] = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "targetRuleId",
            "proposition",
            "actor",
            "conditions",
            "exceptions",
            "provisionRefs",
            "semanticGroupId",
        ],
        "properties": {
            "targetRuleId": {"type": "string", "minLength": 1},
            "proposition": {"type": "string", "minLength": 1},
            "actor": {"type": "string", "minLength": 1},
            "conditions": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
            },
            "exceptions": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
            },
            "provisionRefs": {
                "type": "array",
                "minItems": 1,
                "uniqueItems": True,
                "items": {"type": "string", "minLength": 1},
            },
            "semanticGroupId": {"type": "string", "minLength": 1},
        },
    }
    fingerprints = [
        "legalSourceSha256",
        "provisionContentSha256",
        "targetPropositionSha256",
        "targetRuleSha256",
        "scenarioSha256",
        "repositorySnapshotSha256",
        "p14CaseSha256",
    ]
    schema["properties"]["executionBinding"] = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "p14CaseId",
            "evaluationStage",
            "lifecycleStage",
            "targetRuleId",
            "fixtureFingerprints",
            "releaseEvidenceSha256",
        ],
        "properties": {
            "p14CaseId": {"type": "string", "minLength": 1},
            "evaluationStage": {"const": "ASSESSMENT_ROOT"},
            "lifecycleStage": {
                "enum": [
                    "INITIAL",
                    "WAITING_FOR_HUMAN",
                    "RESUME_FINAL",
                    "FAULT_RECOVERY",
                ]
            },
            "targetRuleId": {"type": "string", "minLength": 1},
            "fixtureFingerprints": {
                "type": "object",
                "additionalProperties": False,
                "required": fingerprints,
                "properties": {
                    k: {"type": "string", "pattern": "^[a-f0-9]{64}$"}
                    for k in fingerprints
                },
            },
            "releaseEvidenceSha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
        },
    }
    rubric["rubricId"] = "LCSP-400-HUMAN-REVIEWED-VIETNAM-AI-LEGAL-REASONING"
    rubric["rubricVersion"] = RUBRIC_VERSION
    rubric["datasetVersion"] = DATASET_VERSION
    rubric["domainContractSources"] = [
        "Law 134/2025/QH15, Articles 10, 11, 34 and 35 (official Công báo PDF pin)",
        "Decree 142/2026/NĐ-CP, Articles 12, 16, 17 and 45 (official Công báo PDF pin)",
        "LCSP-402 pinned policy fixture references; candidate labels require independent legal review",
    ]
    ex = {
        "APPLICABILITY": (
            [
                "Provider and triggering facts place a medium/high-risk system within the cited classification scope."
            ],
            [
                "Applying a provider duty to a deployer when the case states the organization is not the provider."
            ],
        ),
        "COMPLIANCE": (
            [
                "A verified, applicable record supports only the particular statutory element it documents."
            ],
            ["Treating an incomplete or unverified record as proof of non-compliance."],
        ),
        "ACTOR": (
            [
                "Preserving the provider as the actor where the cited provision assigns the duty to the provider."
            ],
            [
                "Assigning the provider's Article 17 duty to a deployer because the deployer publishes output."
            ],
        ),
        "CONDITIONS": (
            [
                "Preserving provider status, risk level, timing, and the separate direct-interaction or audiovisual trigger."
            ],
            ["Dropping a statutory trigger and applying a duty to every AI system."],
        ),
        "EXCEPTIONS": (
            [
                "Preserving the Article 11(1) legal exception and the separate Article 17(5) open/free-system route."
            ],
            [
                "Applying Article 17(5) without facts that establish an open/free system and audiovisual output."
            ],
        ),
        "EVIDENCE_SUFFICIENCY": (
            [
                "A digest-bound release-evidence file supports only the fields it actually contains."
            ],
            ["Using a missing or unverified field as conclusive proof of a violation."],
        ),
        "UNSUPPORTED_CONCLUSION": (
            [
                "Limiting a conclusion to the pinned Vietnamese provision and established scenario facts."
            ],
            [
                "Inventing a universal encryption obligation from the cited AI-law provisions."
            ],
        ),
    }
    for key, (correct, incorrect) in ex.items():
        rubric["dimensions"][key]["correctExamples"] = correct
        rubric["dimensions"][key]["incorrectExamples"] = incorrect
        rubric["dimensions"][key]["uncertainAndExcludedCases"] = (
            "Keep uncertain any issue depending on an unpinned rule, transition date, actor role, or material fact; exclude issues requiring an external legal interpretation."
        )
    return schema, rubric


def build_vn_ai_assets(source_cases_path: Path, output_dir: Path) -> dict[str, Any]:
    """Business purpose: Build the active Vietnamese candidate cohort from pinned LCSP-402 legal and P14 inputs.

    Business rules:
    - Official PDF/extraction bytes and every provision reference must validate.
    - Candidate labels remain provisional; SCRIPTED or generated output never supplies gold labels.
    - Related statutory cases remain grouped in the frozen DEV/HOLDOUT split.

    Execution flow:
    1. Load P14 cases, official corpus receipt, source manifest, and independent static fixture references.
    2. Select and cross-bind the 30 supported cases to provisions, rules, repository evidence, facts, and lifecycle.
    3. Build versioned candidate, rubric, source, cohort, mapping, split, and review artifacts.
    4. Validate hashes and return artifact counts and digests.

    Failure cases:
    - Missing cases, unsupported source kinds, changed hashes, invalid labels, or split drift stop generation.

    Side effects:
    - Reads checked-in legal/evaluation assets and writes only to the caller-selected evaluation directory."""
    source_raw = json.loads(source_cases_path.read_text(encoding="utf-8"))
    source_rows = source_raw["cases"] if isinstance(source_raw, dict) else source_raw
    parsed = load_benchmark_cases(source_cases_path, split="ALL")
    by_id = {row.case_id: row for row in parsed}
    refs = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    legal_context, corpus_sources = _load_legal_context()
    corpus_pin = parsed[0].corpus_pin
    manifest = json.loads((CORPUS / "manifest.json").read_text(encoding="utf-8"))
    docs = {row["number"]: row for row in manifest["documents"]}
    selected = [copy.deepcopy(row) for row in source_rows if row["case_id"] not in OMIT]
    if len(selected) != 30:
        raise ValueError(f"VN_AI_CASE_INVENTORY_MUST_BE_30:{len(selected)}")

    models: dict[str, BenchmarkCase] = {}
    model_data: dict[str, dict[str, Any]] = {}
    group_by_case: dict[str, str] = {}
    for raw in selected:
        original = by_id[raw["case_id"]]
        rule = original.rule_definitions[0]
        group = _group(rule.rule_id)
        split = (
            "HOLDOUT"
            if int(sha256(group.encode()).hexdigest()[:8], 16) % 5 == 0
            else "DEV"
        )
        raw["split"] = split
        raw["rule_definitions"][0]["applicability_conditions"] = [
            "Analyze the complete admitted Vietnamese legal source; retain relevant development, deployment, production and operational evidence. Apply each obligation actor, trigger, exception and temporal conditions without a separate business mode."
        ]
        raw["rule_set_pin"]["digest_sha256"] = stable_hash(raw["rule_definitions"])
        case = BenchmarkCase.model_validate(raw)
        models[case.case_id] = case
        model_data[case.case_id] = raw
        group_by_case[case.case_id] = group

    provision_index: dict[str, dict[str, Any]] = {}
    for case in models.values():
        for provision in case.legal_provisions:
            if provision.source_kind != "OFFICIAL_PINNED_LAW":
                raise ValueError(f"VN_AI_NONOFFICIAL_PROVISION:{case.case_id}")
            match = re.search(r"([0-9]+)", provision.locator)
            if not match:
                raise ValueError(f"VN_AI_PROVISION_LOCATOR_INVALID:{case.case_id}")
            article = match.group(1)
            context_key = (
                "law-" if provision.document_id == "134-2025-QH15" else "decree-"
            ) + article
            if (
                context_key not in legal_context
                or legal_context[context_key].model_dump() != provision.model_dump()
            ):
                raise ValueError(
                    f"VN_AI_PROVISION_BYTES_NOT_OFFICIAL:{case.case_id}:{context_key}"
                )
            source_id = DOC_IDS.get(provision.document_id)
            if not source_id:
                raise ValueError(
                    f"VN_AI_SOURCE_DOCUMENT_UNSUPPORTED:{provision.document_id}"
                )
            provision_index.setdefault(source_id, {})[f"article-{article}"] = {
                "citation": provision.locator,
                "locator": provision.locator,
                "contentSha256": provision.content_sha256,
                "referenceNote": "Exact provision text rebuilt from the official Công báo PDF and validated LCSP-402 extraction receipt.",
            }

    source_metadata = []
    for number, source_id in sorted(DOC_IDS.items(), key=lambda item: item[1]):
        if source_id not in provision_index:
            continue
        document = docs[number]
        source_metadata.append(
            {
                "sourceId": source_id,
                "sourceVersion": f"{number}@pdf-sha256:{document['sha256']}",
                "sourceName": document["sourceFileName"],
                "sourceUrl": document["sourcePage"],
                "versionPinBasis": f"Official Công báo PDF bytes SHA-256 {document['sha256']}; receipt and extracted provisions are independently checked.",
                "jurisdiction": "VIETNAM",
                "sourceKind": "OFFICIAL_PINNED_LAW",
                "documentNumber": number,
                "pdfSha256": document["sha256"],
                "effectiveDate": EFFECTIVE[number],
                "provisions": dict(sorted(provision_index[source_id].items())),
            }
        )
    source_by_id = {row["sourceId"]: row for row in source_metadata}

    candidates = []
    cohort_rows = []
    mapping_rows = []
    for case_id, case in models.items():
        rule = case.rule_definitions[0]
        repo = (DEEPAGENTS_ROOT / case.repo_pin.fixture_dir).resolve()
        evidence_file = repo / "release-evidence.json"
        evidence_bytes = evidence_file.read_bytes()
        facts = json.loads(evidence_bytes.decode("utf-8"))
        reference = refs[repo.name]["cases"][rule.rule_id]
        group = group_by_case[case_id]
        semantic_group = group.removeprefix("EXPLICIT_SEMANTIC_GROUP:")
        candidate_id = "vn-ai-" + re.sub(r"[^a-z0-9]+", "-", case_id.lower()).strip("-")
        fingerprints = fixture_fingerprints(
            case, case.gold_rubric.stages[0].stage, rule.rule_id
        )
        grouped_refs: dict[str, list[str]] = {}
        target_refs = []
        for provision in case.legal_provisions:
            article = re.search(r"([0-9]+)", provision.locator).group(1)
            source_id = DOC_IDS[provision.document_id]
            provision_id = f"article-{article}"
            grouped_refs.setdefault(source_id, []).append(provision_id)
            target_refs.append(f"{source_id}:{provision_id}")
        legal_refs = []
        for source_id in sorted(grouped_refs):
            source = source_by_id[source_id]
            provisions = sorted(set(grouped_refs[source_id]))
            legal_refs.append(
                {
                    "sourceId": source_id,
                    "sourceVersion": source["sourceVersion"],
                    "sourceUrl": source["sourceUrl"],
                    "citations": sorted(
                        {source["provisions"][ref]["citation"] for ref in provisions}
                    ),
                    "provisionRefs": provisions,
                }
            )

        verdict_labels = {
            "PASS": ("APPLICABLE", "SUPPORTED_COMPLIANCE"),
            "FAIL": ("APPLICABLE", "SUPPORTED_NON_COMPLIANCE"),
            "UNKNOWN": ("UNRESOLVED", "UNRESOLVED"),
            "NOT_APPLICABLE": ("NOT_APPLICABLE", "NOT_APPLICABLE"),
        }
        if reference["verdict"] not in verdict_labels:
            raise ValueError(f"VN_AI_REFERENCE_VERDICT_INVALID:{case_id}")
        app, compliance = verdict_labels[reference["verdict"]]
        rationale = (
            "Candidate label from the separately authored LCSP-402 static fixture reference and exact release-evidence facts, checked against pinned official Vietnamese provisions. "
            "It is provisional, not human-reviewed legal gold; no SCRIPTED or generated LCSP output was used as expected label."
        )
        # Fixture verdicts propose outcomes only. They cannot supply quality judgments.
        expected = {
            "applicability": _expect(app, rationale),
            "compliance": _expect(compliance, rationale),
            "actor": None,
            "conditions": None,
            "exceptions": None,
            "evidenceSufficiency": None,
            "unsupportedConclusion": None,
        }
        stage = case.gold_rubric.stages[0].stage
        row = {
            "caseId": candidate_id,
            "datasetVersion": DATASET_VERSION,
            "rubricVersion": RUBRIC_VERSION,
            "stage": "ASSESSMENT_ROOT",
            "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
            "primaryDimension": "COMPLIANCE",
            "caseDescription": f"Vietnamese AI-law Assessment Root scenario {case_id}; exact P14 case, target rule and repository snapshot are bound below.",
            "legalSource": legal_refs[0],
            "relatedLegalSources": legal_refs[1:],
            "scenarioFacts": [
                f"{key}={json.dumps(value, ensure_ascii=False, sort_keys=True)}"
                for key, value in sorted(facts.items())
            ],
            "claimUnderReview": None,
            "fixedOutputDiagnostic": None,
            "expected": expected,
            "annotationRationale": rationale,
            "evidenceReferences": [
                {
                    "referenceId": ref,
                    "kind": "PUBLIC_LEGAL_SOURCE",
                    "description": f"Official source pin {ref}; exact PDF and provision digests are in source-pins.vn-ai.v1.json.",
                }
                for ref in sorted(set(target_refs))
            ]
            + [
                {
                    "referenceId": f"release-evidence.json@sha256:{_hash_file(evidence_file)}",
                    "kind": "SYNTHETIC_REPOSITORY_EVIDENCE",
                    "description": "Exact synthetic P14 repository evidence bytes; digest-bound to the repository snapshot.",
                }
            ],
            "reviewStatus": "CANDIDATE",
            "reviewers": [],
            "reviewerDisagreements": [],
            "adjudication": None,
            "uncertaintyReason": "Qualified independent legal review is required before scoring.",
            "exclusionReason": None,
            "counterfactualPair": None,
            "semanticGroupId": semantic_group,
            "targetObligation": {
                "targetRuleId": rule.rule_id,
                "proposition": rule.requirement_proposition,
                "actor": "Nhà cung cấp hệ thống trí tuệ nhân tạo theo điều khoản được viện dẫn.",
                "conditions": list(rule.applicability_conditions),
                "exceptions": list(rule.exceptions),
                "provisionRefs": sorted(set(target_refs)),
                "semanticGroupId": semantic_group,
            },
            "executionBinding": {
                "p14CaseId": case_id,
                "evaluationStage": "ASSESSMENT_ROOT",
                "lifecycleStage": stage,
                "targetRuleId": rule.rule_id,
                "fixtureFingerprints": fingerprints,
                "releaseEvidenceSha256": _hash_file(evidence_file),
            },
        }
        candidates.append(row)
        cohort_id = f"p14-{candidate_id}"
        cohort_rows.append(
            {
                "cohortCaseId": cohort_id,
                "candidateCaseId": candidate_id,
                "p14CaseId": case_id,
                "evaluationStage": "ASSESSMENT_ROOT",
                "lifecycleStage": stage,
                "targetRuleId": rule.rule_id,
                "splitGroupId": group,
                "split": case.split,
                "sourceKind": "OFFICIAL_PINNED_LAW",
                "jurisdiction": "VIETNAM",
                "corpusId": case.corpus_pin.corpus_id,
                "corpusVersion": case.corpus_pin.version,
                "corpusDigestSha256": case.corpus_pin.digest_sha256,
                "fixtureFingerprints": fingerprints,
            }
        )
        mapping_rows.append(
            {
                "cohortCaseId": cohort_id,
                "candidateCaseId": candidate_id,
                "p14CaseId": case_id,
                "evaluationStage": "ASSESSMENT_ROOT",
                "lifecycleStage": stage,
                "p14RuleId": rule.rule_id,
            }
        )

    source_pins = {
        "sourcePinsVersion": "LCSP-400-VIETNAM-OFFICIAL-SOURCE-PINS-V1",
        "jurisdiction": "VIETNAM",
        "officialCorpus": {
            "corpusId": corpus_pin.corpus_id,
            "version": corpus_pin.version,
            "corpusDigestSha256": corpus_pin.digest_sha256,
            "manifestSha256": corpus_sources["manifestSha256"],
            "selectorsSha256": corpus_sources["selectorsSha256"],
            "ingestionReceiptSha256": corpus_sources["ingestionReceiptSha256"],
        },
        "sources": source_metadata,
    }
    cohort = {
        "cohortVersion": "LCSP-400-P14-SHARED-COHORT-V2",
        "cohortKind": "OFFICIAL_VN_SOURCE_PINNED_P14_CASES",
        "cohortPurpose": "ASSESSMENT_ROOT_EXECUTABLE_CANDIDATES_NOT_REVIEWED_GOLD",
        "corpusId": corpus_pin.corpus_id,
        "corpusVersion": corpus_pin.version,
        "corpusDigestSha256": corpus_pin.digest_sha256,
        "cases": cohort_rows,
    }
    cohort["cohortSha256"] = cohort_digest(cohort)
    split = build_split_manifest(candidates, cohort)
    memberships = {
        case_id: group["split"]
        for group in split["groups"]
        for case_id in group["caseIds"]
    }
    if any(
        memberships[row["cohortCaseId"]] != row["split"]
        or memberships[row["candidateCaseId"]] != row["split"]
        for row in cohort_rows
    ):
        raise ValueError("VN_AI_SPLIT_ASSIGNMENT_DRIFT")
    p14_digest = stable_hash([case.model_dump() for case in models.values()])
    candidate_digest, source_digest = (
        canonical_digest(candidates),
        canonical_digest(source_pins),
    )
    mapping = {
        "mappingVersion": "LCSP-400-P14-CASE-MAP-V3",
        "mappingPolicy": "EXACT_OFFICIAL_SOURCE_AND_SAME_P14_CASE_IDENTITY; NO LEGAL CROSSWALK",
        "caseMappings": mapping_rows,
        "pinnedInputs": {
            "candidateDatasetSha256": candidate_digest,
            "p14CasesDatasetSha256": p14_digest,
            "sourcePinsSha256": source_digest,
            "sharedCohortSha256": cohort["cohortSha256"],
            "splitManifestSha256": split["splitDigest"],
        },
    }
    overlay = {
        "overlayVersion": "LCSP-400-REVIEW-OVERLAY-V1",
        "candidateDatasetSha256": candidate_digest,
        "caseReviews": [],
    }
    schema, rubric = _schema_and_rubric()
    output_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "candidate-cases.vn-ai.v1.jsonl": "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            + "\n"
            for row in candidates
        ),
        "source-pins.vn-ai.v1.json": json.dumps(
            source_pins, ensure_ascii=False, indent=2, sort_keys=True
        )
        + "\n",
        "rubric.vn-ai.v1.json": json.dumps(
            rubric, ensure_ascii=False, indent=2, sort_keys=True
        )
        + "\n",
        "annotation.schema.vn-ai.v1.json": json.dumps(
            schema, ensure_ascii=False, indent=2, sort_keys=True
        )
        + "\n",
        "review-overlay.vn-ai.v1.json": json.dumps(
            overlay, ensure_ascii=False, indent=2, sort_keys=True
        )
        + "\n",
        "p14-shared-cohort.vn-ai.v2.json": json.dumps(
            cohort, ensure_ascii=False, indent=2, sort_keys=True
        )
        + "\n",
        "p14-case-map.vn-ai.v3.json": json.dumps(
            mapping, ensure_ascii=False, indent=2, sort_keys=True
        )
        + "\n",
        "evaluation-splits.vn-ai.v2.json": json.dumps(
            split, ensure_ascii=False, indent=2, sort_keys=True
        )
        + "\n",
        "p14-cases.vn-ai.v1.json": json.dumps(
            {
                "schemaVersion": source_raw.get(
                    "schemaVersion", "LCSP_BENCHMARK_CASES_V1"
                ),
                "cases": selected,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
    }
    for name, content in files.items():
        (output_dir / name).write_text(content, encoding="utf-8", newline="\n")
    return {
        "candidateCaseCount": len(candidates),
        "mappedCaseCount": len(mapping_rows),
        "sourceCount": len(source_metadata),
        "officialProvisionCount": sum(
            len(row["provisions"]) for row in source_metadata
        ),
        "candidateDatasetSha256": candidate_digest,
        "sourcePinsSha256": source_digest,
        "cohortSha256": cohort["cohortSha256"],
        "p14CasesDatasetSha256": p14_digest,
        "splitDigest": split["splitDigest"],
        "splitCounts": split["splitCaseCounts"],
    }


def main() -> int:
    """Business purpose: Generate versioned Vietnamese candidate and P14 mapping artifacts from pinned inputs.

    Business rules:
    - The command emits provisional labels from official-source and fixture bytes only; it never invokes a model.
    - Output is limited to the requested evaluation artifact directory.

    Execution flow:
    1. Parse source-case and output-directory arguments.
    2. Build and validate the candidate cohort.
    3. Print machine-readable counts and digests.

    Failure cases:
    - Invalid source pins or generation errors return a nonzero process status.

    Side effects:
    - Writes evaluation artifacts only to the selected output directory."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-cases", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=PACKAGE / "proposals.v2")
    args = parser.parse_args()
    print(
        json.dumps(
            build_vn_ai_assets(args.source_cases, args.output_dir),
            ensure_ascii=True,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
