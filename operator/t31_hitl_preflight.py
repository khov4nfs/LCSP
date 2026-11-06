#!/usr/bin/env python3
"""Authoritative Operator Package Validator for T31-S01 v2.0.1 HITL Preflight.

Validates canonical submissions against the approved T31-S01 v2.0.1 HITL Answer Contract:
- Checks schema conformance (t31.hitl.submissions.v1).
- Checks presence and exact match of questionSha256 for all 16 items.
- Enforces strict policy:
  * DOES_NOT_KNOW: doesNotKnow=True and answer property omitted.
  * ANSWER_LIMITED: doesNotKnow=False and answer exact string match with approvedSubmission.answer.
- Emits exit code 0 on 16/16 PASS, non-zero on FAIL.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

CANONICAL_CONTRACT = [
    {
        "qNum": "Q01",
        "intentId": "ORG_DEPLOYMENT",
        "ruleId": "art3-cl1-pta-risk-prevention",
        "historicalRequestId": "cd5816ce-3eaa-490c-9b22-438b640018ba",
        "expectedPolicy": "ANSWER_LIMITED",
        "expectedDoesNotKnow": False,
        "questionSha256": "f6dbaa4e9be92ebcbd2dba60eefac17892b1c3df8c6ec1b016ff538327d177cd",
        "sourceFactIds": ["F01_OPERATOR", "F02_DEPLOYMENT", "F03_CAPABILITY"],
        "approvedAnswer": "We are SYN Support Services, a company registered in Vietnam, and we operate a publicly accessible Vietnamese-language IT customer-support chatbot under the Hudson IT Consulting brand. Users select third-party LLM providers and supply their own API keys (BYOK). Our chatbot provides text-only information and does not execute transactions or modify accounts. We have not supplied independently verified traffic volumes, production release logs, or a legal determination of the AI provider/deployer classification.",
    },
    {
        "qNum": "Q02",
        "intentId": "AI_RISK_CLASSIFICATION",
        "ruleId": "c05-conformity-assessment-rule",
        "historicalRequestId": "c9d040b3-81b6-44d1-91c6-b0a564af93e0",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "5da4f7860421b379044933d8ae1a6f3bc41be596b19b4a42eb7eb7b3c1d24f89",
        "sourceFactIds": ["F04_AI_CLASSIFICATION_HISTORY", "F05_AI_CLASSIFICATION_CURRENT"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q03",
        "intentId": "RECLASSIFICATION_TRIGGERS",
        "ruleId": "ar-nd142-art11-cl1-review-reclassification",
        "historicalRequestId": "3a2ac61a-34e5-41ef-b894-cc701e1ee8d2",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "ab7200b2e324e7473e810ca5ba5f9cc6f7fd427410bd3699163b031e9ab0fd30",
        "sourceFactIds": ["F06_INCIDENTS", "F15_CHANGES_AND_REGULATORY_NOTICES"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q04",
        "intentId": "DEPLOYER_RISK_CHANGING_MODIFICATIONS",
        "ruleId": "ar-nd142-art11-cl2-coordinate-reclassification",
        "historicalRequestId": "eb338c55-9e9d-49d5-b3c9-5f2a5c6e9ce6",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "db1ff5c8103664fe518877ea3dd7a6a93c6b1908324634531f659a50a5f79183",
        "sourceFactIds": ["F03_CAPABILITY", "F04_AI_CLASSIFICATION_HISTORY", "F15_CHANGES_AND_REGULATORY_NOTICES"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q05",
        "intentId": "HIGHER_RISK_RECLASSIFICATION",
        "ruleId": "ar-nd142-art11-cl3pt-a-notify-higher",
        "historicalRequestId": "a42806a3-03ee-49a1-ac9b-a55beaa56826",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "98136cb9c8f2c3adf61769d805ccd0506b4e629ad88d19b9fc43724ae16e48ac",
        "sourceFactIds": ["F04_AI_CLASSIFICATION_HISTORY", "F05_AI_CLASSIFICATION_CURRENT", "F15_CHANGES_AND_REGULATORY_NOTICES"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q06",
        "intentId": "SERIOUS_INCIDENT_OCCURRENCE",
        "ruleId": "ar-luat134-art12-cl2a-technical-measures",
        "historicalRequestId": "32690d72-69ad-4da8-8145-20c6ab00f794",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "82b25c4852b759645823c793f90f0c79800b6d6e8b4be9914ad549d51561bb9c",
        "sourceFactIds": ["F06_INCIDENTS"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q07",
        "intentId": "NATIONAL_AI_INFRA_NETWORK_1",
        "ruleId": "ars-art30-cl3-pt-a-standards",
        "historicalRequestId": "977f1a2a-f737-4450-b6ce-4aa11a25c0b4",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "a6c4b10d828bade844f0e16133056584acd438b8fb700ff1162e05c4bfa2ee04",
        "sourceFactIds": ["F03_CAPABILITY", "F13_NATIONAL_AI_INFRA"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q08",
        "intentId": "NATIONAL_AI_INFRA_NETWORK_2",
        "ruleId": "ars-art30-cl3-pt-b-security",
        "historicalRequestId": "1fad892e-3dde-45ae-9b3c-7e6f9afb9529",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "a6c4b10d828bade844f0e16133056584acd438b8fb700ff1162e05c4bfa2ee04",
        "sourceFactIds": ["F03_CAPABILITY", "F13_NATIONAL_AI_INFRA"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q09",
        "intentId": "NATIONAL_AI_INFRA_NETWORK_3",
        "ruleId": "ars-art30-cl3-pt-c-safety",
        "historicalRequestId": "79f3bfa5-5dec-408e-89eb-3a129cce39e7",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "a6c4b10d828bade844f0e16133056584acd438b8fb700ff1162e05c4bfa2ee04",
        "sourceFactIds": ["F03_CAPABILITY", "F13_NATIONAL_AI_INFRA"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q10",
        "intentId": "NATIONAL_AI_INFRA_NETWORK_4",
        "ruleId": "ars-art31-cl2-standards",
        "historicalRequestId": "b109c029-e736-416c-af5f-3027cdaf6d68",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "19da6fe5e58eef1ca1c4d5bc6b8cf7528dce4c75ac84e95d1d9a88abf194a8e8",
        "sourceFactIds": ["F03_CAPABILITY", "F13_NATIONAL_AI_INFRA"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q11",
        "intentId": "PERSONAL_DATA_PROCESSING_BUSINESS_CERT",
        "ruleId": "AR-NGHIDINH356-2025-ART25-CL2-DEAN-NOIDUNG",
        "historicalRequestId": "cc69d5c9-aebd-4fa1-8445-227b7a0acf62",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "caa33a46950210896cdca95f03c64987508ab681ce5e772ac916f1be3516890a",
        "sourceFactIds": ["F01_OPERATOR", "F14_PROCESSING_SERVICE_CERT"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q12",
        "intentId": "BUSINESS_SECTORS",
        "ruleId": "art27-cl1-pt-a-sensitivedata-rule",
        "historicalRequestId": "d966e54c-914e-4b88-8a2c-48ebc5d9a7dd",
        "expectedPolicy": "ANSWER_LIMITED",
        "expectedDoesNotKnow": False,
        "questionSha256": "4a88a6998763f550632358061c31617be9f7d33df46e1f991425825957cc36f4",
        "sourceFactIds": ["F01_OPERATOR", "F02_DEPLOYMENT", "F12_ORG_OTHER_SECTORS"],
        "approvedAnswer": "Our confirmed business activity for this assessment is operating the Hudson IT Consulting-branded public IT customer-support chatbot. We have not supplied business-registration evidence or verified information about any separate banking, finance, credit-information, recruitment, or public mobile-application-platform operations. Those additional activities cannot be confirmed or ruled out from the information provided for this assessment.",
    },
    {
        "qNum": "Q13",
        "intentId": "PERSONAL_DATA_CONTROLLER_PROCESSOR",
        "ruleId": "art18-cl1-storage-protection-rule",
        "historicalRequestId": "cdb0fd39-89f8-4859-b125-cb349ed9bbf0",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "a092485d91b267968e6b0e3ad164ec80d36bc45706235b3e8a1c0905e8fce374",
        "sourceFactIds": ["F07_DATA_FLOWS", "F08_DATA_RETENTION", "F09_DATA_LEGAL_ROLE"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q14",
        "intentId": "GOVERNMENT_ENTITY_STATUS",
        "ruleId": "art20-cl1-assessment",
        "historicalRequestId": "1d5f8bd2-b80f-4763-be1e-407bd455cffb",
        "expectedPolicy": "ANSWER_LIMITED",
        "expectedDoesNotKnow": False,
        "questionSha256": "dd847a2083bb762d2aec6375cd8496a007d25ca632b01a4407d920e16ca0b752",
        "sourceFactIds": ["F01_OPERATOR", "F16_STATE_STATUS"],
        "approvedAnswer": "We are SYN Support Services, a company registered in Vietnam that operates the chatbot under the Hudson IT Consulting brand. No information supplied for this assessment identifies us as a state agency, and no original business-registration certificate has been provided for independent legal-status verification.",
    },
    {
        "qNum": "Q15",
        "intentId": "FORMAL_CYBERSECURITY_LEVEL",
        "ruleId": "rule-lnm-art10-cl3-level1-2-tasks",
        "historicalRequestId": "10af66a6-961b-4daa-b9d9-241162908567",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "94de7feba56c2745945f553cc72ffeb09e3c6ae2a6f65e75e3b389aba7b062e2",
        "sourceFactIds": ["F10_CYBER_LEVEL"],
        "approvedAnswer": None,
    },
    {
        "qNum": "Q16",
        "intentId": "CYBERSECURITY_DUTY_FULFILLMENT",
        "ruleId": "rule-lnm-art10-cl3-level1-2-tasks",
        "historicalRequestId": "4b4f3751-5d95-4fbc-9603-23dbe339869a",
        "expectedPolicy": "DOES_NOT_KNOW",
        "expectedDoesNotKnow": True,
        "questionSha256": "81de302bae6f036e0a9fca1b05301c263d4d48c3fc3e47b16f26040c186940f9",
        "sourceFactIds": ["F10_CYBER_LEVEL", "F11_SECURITY_OPERATIONS"],
        "approvedAnswer": None,
    },
]


def validate(submissions_doc: dict[str, Any]) -> dict[str, Any]:
    """Validate a historical T31 submission document against its frozen contract.

    Business purpose:
        Reproduce the approved 2026-11-02 operator-package comparison.
    Business rules:
        Check the fixed scenario/version, sixteen submitted rows and each row's
        recorded identity, question digest, fact references and answer policy.
        This historical comparison does not authorize answers to a live request.
    Execution flow:
        Collect document errors, compare submitted rows with the contract and
        return per-row results with aggregate validation counts.
    Failure cases:
        Contract mismatches return FAIL; malformed container or field types may
        raise instead of producing a report.
    Side effects:
        None; the input document and frozen contract remain unchanged.
    """
    errors = []

    # 1. Root schema checks
    if submissions_doc.get("schemaVersion") != "t31.hitl.submissions.v1":
        errors.append(f"Invalid schemaVersion: {submissions_doc.get('schemaVersion')}")
    if submissions_doc.get("scenarioId") != "T31-S01":
        errors.append(f"Invalid scenarioId: {submissions_doc.get('scenarioId')}")
    if submissions_doc.get("scenarioVersion") != "2.0.1":
        errors.append(f"Invalid scenarioVersion: {submissions_doc.get('scenarioVersion')}")

    subs = submissions_doc.get("submissions", [])
    if len(subs) != 16:
        errors.append(f"Expected exactly 16 submissions, found {len(subs)}")

    contract_map = {c["intentId"]: c for c in CANONICAL_CONTRACT}

    per_item_results = []
    pass_count = 0
    fail_count = 0

    for sub in subs:
        intent_id = sub.get("intentId")
        item_errors = []

        contract = contract_map.get(intent_id)
        if not contract:
            item_errors.append(f"Unknown intentId: {intent_id}")
            per_item_results.append({
                "intentId": intent_id,
                "historicalRequestId": sub.get("historicalRequestId"),
                "status": "FAIL",
                "errors": item_errors,
            })
            fail_count += 1
            continue

        # 2. Check historicalRequestId
        if sub.get("historicalRequestId") != contract["historicalRequestId"]:
            item_errors.append(
                f"historicalRequestId mismatch: got {sub.get('historicalRequestId')}, expected {contract['historicalRequestId']}"
            )

        # 3. Check ruleId
        if sub.get("ruleId") != contract["ruleId"]:
            item_errors.append(
                f"ruleId mismatch: got {sub.get('ruleId')}, expected {contract['ruleId']}"
            )

        # 4. Check questionSha256 (MANDATORY REQUIREMENT)
        if "questionSha256" not in sub:
            item_errors.append("Missing mandatory property: 'questionSha256'")
        elif sub.get("questionSha256") != contract["questionSha256"]:
            item_errors.append(
                f"questionSha256 mismatch: got {sub.get('questionSha256')}, expected {contract['questionSha256']}"
            )

        # 5. Check sourceFactIds
        if set(sub.get("sourceFactIds", [])) != set(contract["sourceFactIds"]):
            item_errors.append(
                f"sourceFactIds mismatch: got {sub.get('sourceFactIds')}, expected {contract['sourceFactIds']}"
            )

        # 6. Check policy & answer
        if contract["expectedPolicy"] == "DOES_NOT_KNOW":
            if sub.get("doesNotKnow") is not True:
                item_errors.append(f"doesNotKnow must be True for DOES_NOT_KNOW, got {sub.get('doesNotKnow')}")
            if "answer" in sub and sub["answer"] is not None:
                item_errors.append("The 'answer' property MUST be omitted when doesNotKnow is true")
        elif contract["expectedPolicy"] == "ANSWER_LIMITED":
            if sub.get("doesNotKnow") is not False:
                item_errors.append(f"doesNotKnow must be False for ANSWER_LIMITED, got {sub.get('doesNotKnow')}")
            sub_answer = sub.get("answer")
            expected_answer = contract["approvedAnswer"]
            if not sub_answer:
                item_errors.append("Missing 'answer' property for ANSWER_LIMITED")
            elif sub_answer.strip() != expected_answer.strip():
                item_errors.append(
                    "Deterministic answer text mismatch with canonical approvedSubmission.answer"
                )

        status = "FAIL" if item_errors else "PASS"
        if status == "PASS":
            pass_count += 1
        else:
            fail_count += 1

        per_item_results.append({
            "intentId": intent_id,
            "historicalRequestId": contract["historicalRequestId"],
            "ruleId": contract["ruleId"],
            "questionSha256": sub.get("questionSha256"),
            "actualPolicy": "DOES_NOT_KNOW" if sub.get("doesNotKnow") else "ANSWER_LIMITED",
            "expectedPolicy": contract["expectedPolicy"],
            "status": status,
            "errors": item_errors if item_errors else None,
            "sourceFactIds": contract["sourceFactIds"],
        })

    validation_status = "PASS" if fail_count == 0 and not errors else "FAIL"

    return {
        "schemaVersion": "t31.hitl.canonical_validation.v1",
        "scenarioId": "T31-S01",
        "scenarioVersion": "2.0.1",
        "contractDigest": "APPROVED_LOCKED_2026-11-02",
        "totalEvaluated": len(CANONICAL_CONTRACT),
        "totalPassed": pass_count,
        "totalFailed": fail_count,
        "validationStatus": validation_status,
        "rootErrors": errors,
        "results": per_item_results,
    }


def main() -> None:
    """Run the historical operator-package validator from explicit local files.

    Business purpose:
        Produce a reproducible report for the frozen T31 submission package.
    Business rules:
        Use the configured submissions/output paths and historical defaults;
        a validation result is not current pilot acceptance or live HITL consent.
    Execution flow:
        Resolve the input, parse JSON, validate it, write the report and print
        its result; mirror the report into output/ when that directory exists.
    Failure cases:
        Missing input exits 2, validation failure exits 1, and parse/write errors
        propagate; callers must choose output paths when preserving prior bytes.
    Side effects:
        Read local files, replace the requested report files, print validation
        details and set the process exit status; no service or provider calls.
    """
    parser = argparse.ArgumentParser(description="Canonical Operator Preflight Validator")
    parser.add_argument("--submissions", type=Path, default=Path("T31_V2_0_1_CANONICAL_SUBMISSIONS.json"))
    parser.add_argument("--output", type=Path, default=Path("T31_V2_0_1_CANONICAL_VALIDATION.json"))
    opts = parser.parse_args()

    # Check fallback paths if default not directly present
    sub_path = opts.submissions
    if not sub_path.exists() and Path("output") / sub_path.name:
        sub_path = Path("output") / sub_path.name

    if not sub_path.exists():
        print(f"Error: Submissions file not found at {sub_path}", file=sys.stderr)
        sys.exit(2)

    print(f"Running Operator Package Canonical Validator against: {sub_path}")
    raw_json = json.loads(sub_path.read_text(encoding="utf-8"))
    report = validate(raw_json)

    out_text = json.dumps(report, indent=2, ensure_ascii=False)
    opts.output.write_text(out_text + "\n", encoding="utf-8")

    # Also write to output/ if executed from root
    if Path("output").exists():
        (Path("output") / opts.output.name).write_text(out_text + "\n", encoding="utf-8")

    print(out_text)
    print(f"\nFinal Result: {report['validationStatus']} ({report['totalPassed']}/16 PASS, {report['totalFailed']} FAIL)")

    if report["validationStatus"] == "PASS":
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
