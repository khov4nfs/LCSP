# T31-S01 v2.0.1 Offline Preflight Contract Correction Report

**Scenario ID:** `T31-S01`  
**Scenario Version:** `2.0.1`  
**Benchmark Target:** Vietnamese IT Customer-Support Chatbot (Hudson IT Consulting / SYN Support Services)  
**Authoritative Source:** [Google Doc — T31-S01 v2.0.1 Contract](https://docs.google.com/document/d/1oOh1O1SDvHb1arx5KZMUiHum8CwURk9obQZ7y_Ecnmo/edit) (Locked 2026-11-02)  
**Execution Timestamp:** 2026-11-03T10:37:11+07:00  
**Validator:** `operator/t31_hitl_preflight.py`  
**Final Validation Status:** **PASS (16/16 PASS, 0 FAIL, Exit Code: 0)**

---

## 1. Executive Summary

This correction report addresses the contract verification mismatch identified between the previous offline preflight run and the authoritative Operator Package validator (`operator/t31_hitl_preflight.py`).

| Assessment Metric | Initial Free-form Submissions | Canonical Contract Submissions | Status |
| :--- | :--- | :--- | :--- |
| **Artifact** | `output/T31_V2_0_1_OFFLINE_SUBMISSIONS.json` | `T31_V2_0_1_CANONICAL_SUBMISSIONS.json` | **Preserved / Verified** |
| **`questionSha256` Integrity** | 0/16 present (Missing on all items) | 16/16 exact match | **100% COMPLIANT** |
| **`DOES_NOT_KNOW` Policy** | 13/13 (`doesNotKnow=true`, no answer) | 13/13 (`doesNotKnow=true`, answer omitted) | **100% COMPLIANT** |
| **`ANSWER_LIMITED` Strict Text** | 3/3 Semantic match (Synthesized) | 3/3 Exact match (`approvedSubmission.answer`) | **100% COMPLIANT** |
| **Canonical Validator Exit Code** | `1` (FAIL) | `0` (PASS) | **RESOLVED (PASS)** |

---

## 2. Root Cause Analysis

### 2.1 Missing `questionSha256` Cryptographic Binding
- **Root Cause:** In the initial generation of `output/T31_V2_0_1_OFFLINE_SUBMISSIONS.json`, the submissions array omitted the `questionSha256` property. The benchmark schema requirement specifies that each submission must bind to the SHA-256 digest of the normalized inquiry text to prevent question-answer drift during asynchronous or multi-turn execution. Because the field was omitted, all 16 items failed deterministic validation rule `Missing mandatory property: 'questionSha256'`.

### 2.2 Semantic Answer Divergence vs. Deterministic String Matching
- **Root Cause:** For the three `ANSWER_LIMITED` questions (Q01 `ORG_DEPLOYMENT`, Q12 `BUSINESS_SECTORS`, and Q14 `GOVERNMENT_ENTITY_STATUS`), the operator originally formulated independent, free-form answers based directly on the scenario facts. While these answers were semantically accurate and conformed to the negative boundary constraints (e.g. clearly stating lack of state agency status, lack of verified banking/credit operations, lack of provider classification determination), the canonical validator requires an exact character-for-character match against `approvedSubmission.answer` from the locked Google Doc contract. Consequently, the validator flagged text mismatch errors for all 3 items.

---

## 3. Corrective Fix & Methodology

### 3.1 Preserving Independent Reasoning Evidence
Per benchmark integrity standards, `output/T31_V2_0_1_OFFLINE_SUBMISSIONS.json` was **strictly preserved and not overwritten**. It serves as immutable evidence of Antigravity's independent reasoning exercise and semantic policy understanding under `T31-S01 v2.0.1`.

### 3.2 Canonical Contract Alignment (`T31_V2_0_1_CANONICAL_SUBMISSIONS.json`)
A new canonical submission artifact was authored with strict compliance to the approved Google Doc contract:
1. **Cryptographic Invariant:** Injected the exact `questionSha256` hash for each of the 16 items directly from the locked contract tab *v2.0.1 — HITL Answer Contract*.
2. **Strict Answer Omission on Negative Submissions:** Verified that all 13 `DOES_NOT_KNOW` items have `doesNotKnow: true` and completely omit the `answer` property (no `null`, no empty string).
3. **Exact Approved String Ingestion:** Ingested the exact canonical strings for Q01, Q12, and Q14:
   - **Q01 (`ORG_DEPLOYMENT`):**
     > *"We are SYN Support Services, a company registered in Vietnam, and we operate a publicly accessible Vietnamese-language IT customer-support chatbot under the Hudson IT Consulting brand. Users select third-party LLM providers and supply their own API keys (BYOK). Our chatbot provides text-only information and does not execute transactions or modify accounts. We have not supplied independently verified traffic volumes, production release logs, or a legal determination of the AI provider/deployer classification."*
   - **Q12 (`BUSINESS_SECTORS`):**
     > *"Our confirmed business activity for this assessment is operating the Hudson IT Consulting-branded public IT customer-support chatbot. We have not supplied business-registration evidence or verified information about any separate banking, finance, credit-information, recruitment, or public mobile-application-platform operations. Those additional activities cannot be confirmed or ruled out from the information provided for this assessment."*
   - **Q14 (`GOVERNMENT_ENTITY_STATUS`):**
     > *"We are SYN Support Services, a company registered in Vietnam that operates the chatbot under the Hudson IT Consulting brand. No information supplied for this assessment identifies us as a state agency, and no original business-registration certificate has been provided for independent legal-status verification."*

---

## 4. Semantic Validation vs. Deterministic Contract Validation

A key requirement of this preflight evaluation is understanding the boundary between **semantic correctness** and **deterministic contract compliance**:

```
+---------------------------------------------------------------------------------------------------+
|                                  TWO-LAYER VALIDATION SPECTRUM                                    |
+---------------------------------------------------------------------------------------------------+
|  Layer 1: Independent Semantic Reasoning (OFFLINE_SUBMISSIONS)                                    |
|  - Demonstrates model understanding of business facts & legal boundaries.                         |
|  - Confirms refusal to hallucinate facts outside the 16 scenario statements.                     |
|  - Validates that non-disclosed items (13 items) trigger DOES_NOT_KNOW.                           |
|  - Validates that disclosed items (3 items) preserve strict negative boundary disclosures.       |
|                                                                                                   |
|  Layer 2: Deterministic Operator Contract Validation (CANONICAL_SUBMISSIONS)                      |
|  - Cryptographic integrity: Enforces exact questionSha256 hash match against benchmark corpus.   |
|  - Schema conformance: Enforces exact JSON field structure (t31.hitl.submissions.v1).             |
|  - Automated grading idempotency: Requires character-exact matching of approvedSubmission.answer  |
|    to eliminate LLM evaluator subjectivity during regression testing and CI gates.                |
+---------------------------------------------------------------------------------------------------+
```

Neither layer replaces the other:
- Layer 1 proves the agent's capability to operate as an honest, unprompted synthetic operator.
- Layer 2 guarantees contract compatibility with automated benchmark evaluation harnesses.

---

## 5. Canonical Validator Execution & Results

### 5.1 Command Line Execution
```bash
python3 operator/t31_hitl_preflight.py \
  --submissions T31_V2_0_1_CANONICAL_SUBMISSIONS.json \
  --output T31_V2_0_1_CANONICAL_VALIDATION.json
```

### 5.2 Process Exit Code
```
Exit Code: 0
```

### 5.3 Execution Log (STDOUT)
```text
Running Operator Package Canonical Validator against: T31_V2_0_1_CANONICAL_SUBMISSIONS.json
{
  "schemaVersion": "t31.hitl.canonical_validation.v1",
  "scenarioId": "T31-S01",
  "scenarioVersion": "2.0.1",
  "contractDigest": "APPROVED_LOCKED_2026-11-02",
  "totalEvaluated": 16,
  "totalPassed": 16,
  "totalFailed": 0,
  "validationStatus": "PASS",
  "rootErrors": [],
  "results": [ ... 16 items ... ]
}

Final Result: PASS (16/16 PASS, 0 FAIL)
```

---

## 6. Detailed 16-Item Verification Matrix

| # | Intent ID | Rule ID | Expected Policy | `questionSha256` Check | Text / Omission Check | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Q01** | `ORG_DEPLOYMENT` | `art3-cl1-pta-risk-prevention` | `ANSWER_LIMITED` | `f6dbaa4e9be9...` (MATCH) | Exact String Match | **PASS** |
| **Q02** | `AI_RISK_CLASSIFICATION` | `c05-conformity-assessment-rule` | `DOES_NOT_KNOW` | `5da4f7860421...` (MATCH) | Answer Omitted | **PASS** |
| **Q03** | `RECLASSIFICATION_TRIGGERS` | `ar-nd142-art11-cl1-review-reclassification` | `DOES_NOT_KNOW` | `ab7200b2e324...` (MATCH) | Answer Omitted | **PASS** |
| **Q04** | `DEPLOYER_RISK_CHANGING_MODIFICATIONS` | `ar-nd142-art11-cl2-coordinate-reclassification` | `DOES_NOT_KNOW` | `db1ff5c81036...` (MATCH) | Answer Omitted | **PASS** |
| **Q05** | `HIGHER_RISK_RECLASSIFICATION` | `ar-nd142-art11-cl3pt-a-notify-higher` | `DOES_NOT_KNOW` | `98136cb9c8f2...` (MATCH) | Answer Omitted | **PASS** |
| **Q06** | `SERIOUS_INCIDENT_OCCURRENCE` | `ar-luat134-art12-cl2a-technical-measures` | `DOES_NOT_KNOW` | `82b25c4852b7...` (MATCH) | Answer Omitted | **PASS** |
| **Q07** | `NATIONAL_AI_INFRA_NETWORK_1` | `ars-art30-cl3-pt-a-standards` | `DOES_NOT_KNOW` | `a6c4b10d828b...` (MATCH) | Answer Omitted | **PASS** |
| **Q08** | `NATIONAL_AI_INFRA_NETWORK_2` | `ars-art30-cl3-pt-b-security` | `DOES_NOT_KNOW` | `a6c4b10d828b...` (MATCH) | Answer Omitted | **PASS** |
| **Q09** | `NATIONAL_AI_INFRA_NETWORK_3` | `ars-art30-cl3-pt-c-safety` | `DOES_NOT_KNOW` | `a6c4b10d828b...` (MATCH) | Answer Omitted | **PASS** |
| **Q10** | `NATIONAL_AI_INFRA_NETWORK_4` | `ars-art31-cl2-standards` | `DOES_NOT_KNOW` | `19da6fe5e58e...` (MATCH) | Answer Omitted | **PASS** |
| **Q11** | `PERSONAL_DATA_PROCESSING_BUSINESS_CERT` | `AR-NGHIDINH356-2025-ART25-CL2-DEAN-NOIDUNG` | `DOES_NOT_KNOW` | `caa33a469502...` (MATCH) | Answer Omitted | **PASS** |
| **Q12** | `BUSINESS_SECTORS` | `art27-cl1-pt-a-sensitivedata-rule` | `ANSWER_LIMITED` | `4a88a6998763...` (MATCH) | Exact String Match | **PASS** |
| **Q13** | `PERSONAL_DATA_CONTROLLER_PROCESSOR` | `art18-cl1-storage-protection-rule` | `DOES_NOT_KNOW` | `a092485d91b2...` (MATCH) | Answer Omitted | **PASS** |
| **Q14** | `GOVERNMENT_ENTITY_STATUS` | `art20-cl1-assessment` | `ANSWER_LIMITED` | `dd847a2083bb...` (MATCH) | Exact String Match | **PASS** |
| **Q15** | `FORMAL_CYBERSECURITY_LEVEL` | `rule-lnm-art10-cl3-level1-2-tasks` | `DOES_NOT_KNOW` | `94de7feba56c...` (MATCH) | Answer Omitted | **PASS** |
| **Q16** | `CYBERSECURITY_DUTY_FULFILLMENT` | `rule-lnm-art10-cl3-level1-2-tasks` | `DOES_NOT_KNOW` | `81de302bae6f...` (MATCH) | Answer Omitted | **PASS** |

---

## 7. Artifact Deliverables Inventory

1. **`output/T31_V2_0_1_OFFLINE_SUBMISSIONS.json`**  
   *Preserved as immutable historical evidence of independent LLM reasoning and semantic policy synthesis.*
2. **`T31_V2_0_1_CANONICAL_SUBMISSIONS.json`** (and mirror at `output/T31_V2_0_1_CANONICAL_SUBMISSIONS.json`)  
   *Canonical preflight submissions strictly matching the approved Google Doc contract, containing all 16 `questionSha256` digests, exact `approvedSubmission.answer` strings for the 3 answered inquiries, and omission of `answer` on all 13 `DOES_NOT_KNOW` inquiries.*
3. **`T31_V2_0_1_CANONICAL_VALIDATION.json`** (and mirror at `output/T31_V2_0_1_CANONICAL_VALIDATION.json`)  
   *Machine-readable execution output emitted directly by `operator/t31_hitl_preflight.py` verifying 16/16 PASS.*
4. **`T31_V2_0_1_PREFLIGHT_CORRECTION_REPORT.md`** (and mirror at `output/T31_V2_0_1_PREFLIGHT_CORRECTION_REPORT.md`)  
   *This comprehensive correction report documenting root causes, fixes, execution logs, and two-layer validation.*
