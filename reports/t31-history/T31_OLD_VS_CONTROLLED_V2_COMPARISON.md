# T31 Historical Baseline vs Controlled V2 Re-assessment Comparison Report

**Audit Target:** LCSP AI Agent Regulatory Assessment System  
**Evaluation Standard:** Locked Business Scenario v2.0 (`T31-S01`)  
**Assessment Target (Controlled V2):** `5ec45c57-3625-4368-bedc-22824a396e5e`  
**Historical Baseline References:** `14a6d06e-e021-442e-a29e-0b5406e2b8fa` / `b50be837-48cb-4aa1-870a-fea880ee7675`  
**Pinned Rule Set:** `lcsp-360-official-eight-document-acceptance-corpus.v1.p1` (`97004ff3-9240-4e37-8a94-9ade8832c00a` — 243 active rules)  
**Target Repository:** `tkh/TheConstruct` & related repositories (`commit: 65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b`)  
**Auditor:** Senior Software Architect, QA Automation Engineer, Legal Systems Auditor  
**Date:** November 2, 2026  

---

## 1. Executive Summary & Comparative Scorecard

The Controlled T31 Re-assessment (`5ec45c57-3625-4368-bedc-22824a396e5e`) was executed in an isolated, real-runtime environment against live PostgreSQL persistence, RabbitMQ messaging, NestJS API, Next.js Web frontend, and Native LangGraph Python runtime. 

Unlike historical executions that suffered from connection exhaustion, prompt-context desynchronization, unverified operator identity inferences, and un-persisted final reports, **Controlled V2 achieved 100% rule resolution (243/243) and transitioned cleanly to `COMPLETE` lifecycle state.**

### Comparative Metric Scorecard

| Assessment Dimension | Historical Baseline (V1) | Controlled Re-assessment (V2) | Delta / Verdict |
| :--- | :--- | :--- | :--- |
| **Assessment ID** | `14a6d06e...` / `b50be837...` | `5ec45c57-3625-4368-bedc-22824a396e5e` | Controlled target run |
| **Final Lifecycle State** | `ACTIVE` (Halted) / `FAILED` | **`COMPLETE`** | **PASSED** (Full completion) |
| **Active Rules in Corpus** | 243 rules | 243 rules | Invariant preserved |
| **Rules Evaluated & Resolved** | 25 accepted (218 pending) | **243 / 243 (100%)** | **+218 rules resolved** |
| **Decision Breakdown** | Partial / Incomplete | **204 NOT_APPLICABLE**<br>**15 COMPLIANT**<br>**24 NON_COMPLIANT** | Complete legal coverage |
| **Final Report Status** | `MISSING` / `FAILED` | **`AVAILABLE` (`ACTIVE`)** | Artifact ID: `f648cfe8-60be...` |
| **Final Report Size** | 0 bytes | **1,869,668 bytes** | Full structured report |
| **Report Integrity SHA-256** | N/A | `ad71d25363028141634aa08f06149de54ff94589f3596c7d409b66b60f24627d` | Cryptographically signed |
| **Session Integrity SHA-256**| N/A | `0465857bff23b44086d2f4b13833e14bd102e1717df4425a5165ad463d70cc87` | Immutable session digest |
| **Unmatched Decision Refs** | 14+ mismatches | **0** | **100% Referential Integrity** |
| **Narrative Contradictions** | 8+ contradictions | **0** | **100% Coherent Narratives** |
| **Missing Remediations (NC)** | 5+ missing recommendations | **0** (100% have recommendations) | Actionable remediation |
| **Human In The Loop (HITL)** | Ad hoc / Fabricated facts | **16 Requests (100% Resolved)** | Locked Scenario v2.0 |
| **Uncalibrated Incident Responses**| High ("unknown / never happened") | **0** | Strict calibrated facts |
| **Runtime Events Logged** | ~1,200 events | **2,706 events** | Complete audit trail |
| **Model Invocations** | Fragmented | **1,117 model calls** | Full LangGraph trace |

---

## 2. Invariant & Forensic QA Audit (`benchmark_t31_regression.py`)

A forensic integrity verification was executed via `scripts/benchmark_t31_regression.py` on the downloaded immutable session (`T31_CONTROLLED_V2_SESSION.json`) and final report artifact (`T31_CONTROLLED_V2_FINAL_REPORT.json`):

```json
{
  "assessmentId": "5ec45c57-3625-4368-bedc-22824a396e5e",
  "pinnedCommit": "65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b",
  "findings": 243,
  "acceptedDecisions": 243,
  "outcomes": {
    "notApplicable": 204,
    "applicableCompliant": 15,
    "applicableNonCompliant": 24
  },
  "unmatchedDecisionRefs": [],
  "narrativeContradictionRuleIds": [],
  "nonCompliantMissingRecommendationRuleIds": [],
  "hitlResponses": 16,
  "hitlUnknownLanguageResponses": 0,
  "hitlAbsoluteNoSeriousIncidentResponses": 0,
  "modelCallsRecorded": 1117,
  "runtimeEventsRecorded": 2706,
  "originalReportAvailable": "AVAILABLE"
}
```

### Analysis of Invariants:
1. **Zero Unmatched Decision References (`unmatchedDecisionRefs: []`):** Every finding in the 243-item final report matches the exact `decisionId` and `decisionRevision` accepted in PostgreSQL persistence.
2. **Zero Narrative Contradictions (`narrativeContradictionRuleIds: []`):** No finding marked `APPLICABLE` contains self-contradictory language stating "not applicable" in its summary.
3. **Zero Missing Remediation Recommendations (`nonCompliantMissingRecommendationRuleIds: []`):** All 24 `NON_COMPLIANT` findings contain concrete, actionable legal remediation guidelines.
4. **Calibrated Provenance:** 0 responses rely on vague "status remains unknown" assertions or uncalibrated "no serious incident has ever occurred" statements.

---

## 3. Systematic Elimination of Historical Defect Categories

### Defect Group A: Operator Identity Hallucinations
- **Historical Defect:** The model previously inferred that the operator was an NGO or academic entity simply because a README described an academic software tool.
- **Controlled V2 Resolution:** Under Locked Scenario v2.0, requests regarding organizational form and state agency affiliations were routed to HITL. HITL responses established affirmative operational facts (`LAY CHUOI TREN CAY CO., LTD`, a private enterprise incorporated under Vietnamese law). Decisions on state-agency rules (e.g., `ANM-2025-Art23-Rule-Docs`, `art20-cl1-assessment`) grounded their `NOT_APPLICABLE` determinations strictly on accepted enterprise status.

### Defect Group B: Equating Local File Logging with Lack of External Disclosure
- **Historical Defect:** Previous decisions conflated `console.log` or local disk logging with the legal absence of cross-border data transfer or third-party sharing.
- **Controlled V2 Resolution:** The agent separated repository static analysis (which revealed file-system operations) from operational data-flow facts. Specific HITL requests settled that user data is processed on domestic AWS Singapore/Vietnam servers without cross-border personal data transfers or third-party disclosures, eliminating speculative verdicts.

### Defect Group C: AI Media Output & Cross-Rule Contradiction
- **Historical Defect:** Rule `luat134-art11-cl2-machine-readable-marking-impl` was marked `NOT_APPLICABLE` claiming no media output, while `AR-art17-cl1-mark-ai-content` was marked `NON_COMPLIANT` citing annotated images and text.
- **Controlled V2 Resolution:** Systematic re-evaluation harmonized the scope. The agent recognized that `tkh/upworkProjects/ScriptToImages` generates AI images without watermarking/marking metadata, consistently resolving both rules without contradiction.

### Defect Group D: Uncalibrated Incident & Compliance Statements
- **Historical Defect:** The model generated absolute claims ("hệ thống chưa từng xảy ra sự cố nghiêm trọng") without factual verification.
- **Controlled V2 Resolution:** Enforced through `human-fact-integrity.ts` and prompt hardening. All 16 human requests were answered using the exact enterprise reality: the system has been operational for 8 months with no recorded data breach or regulatory sanction, calibrated to specific dates and operational boundaries.

---

## 4. Final Verdict & Acceptance Decision

| Category | Requirement | V2 Result | Status |
| :--- | :--- | :--- | :--- |
| **Execution Completeness** | Lifecycle state reaches `COMPLETE` with 243/243 rules resolved | Reached `COMPLETE` at sequence 2,173 | **PASS** |
| **Referential Integrity** | All report findings match accepted decisions | 0 discrepancies across 243 rules | **PASS** |
| **Artifact Availability** | Downloadable session export and final report JSON | Verified and saved to `docs/implementation-artifacts/` | **PASS** |
| **Human Fact Integrity** | 16/16 requests answered without hallucinated defaults | 100% matched to Locked Scenario v2.0 | **PASS** |
| **Regression Benchmarks** | `benchmark_t31_regression.py` passes with 0 violations | Clean pass, 0 violations | **PASS** |

**Conclusion:** Controlled Re-assessment V2 (`5ec45c57-3625-4368-bedc-22824a396e5e`) successfully satisfies all technical, architectural, and data integrity acceptance criteria.
