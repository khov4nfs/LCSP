---
status: ACTIVE_TRACEABILITY_ARTIFACT
artifact_type: implementation_readiness_traceability
workflowType: testarch-trace
stepsCompleted:
  - step-01-load-context
  - step-03-map-criteria
  - step-05-gate-decision
coverageBasis: acceptance_criteria
oracleConfidence: high
oracleResolutionMode: formal_requirements
oracleSources:
  - docs/product/prd.md
  - docs/specs/functional-requirements.md
  - docs/specs/non-functional-requirements.md
  - docs/planning-artifacts/epics.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md
externalPointerStatus: not_used
gateDecision: CONCERNS
---

# Implementation Readiness Traceability Matrix

## Purpose

This matrix upgrades readiness traceability from FR-to-story coverage to certification-grade planning traceability:

```text
FR/NFR/UX/control -> story ID -> acceptance criterion ID -> test level -> owner -> evidence artifact
```

It is a planning/test-architecture artifact. It does not prove tests exist yet and does not authorize implementation by itself.

## Coverage Summary

| Priority | Total Criteria | Planning Trace Rows | Coverage % | Status |
|---|---:|---:|---:|---|
| P0 | 38 | 38 | 100% | Pass |
| P1 | 34 | 34 | 100% | Pass |
| P2 | 18 | 18 | 100% | Pass |
| P3 | 0 | 0 | 100% | Pass |
| **Total** | **90** | **90** | **100%** | **CONCERNS** |

Gate decision is `CONCERNS` because trace rows now exist, but executable test artifacts are not present in this readiness pass.

## FR Trace Rows

| Criterion | Priority | Story | AC ID | Test level | Owner | Evidence artifact |
|---|---:|---|---|---|---|---|
| FR-001 | P0 | 1.1 | S1.1-AC01 | API/E2E/auth | Platform | auth integration test, audit event |
| FR-002 | P0 | 1.1 | S1.1-AC02 | API/E2E/auth | Platform | protected route denial test |
| FR-003 | P0 | 1.2 | S1.2-AC01 | API/security | Platform | MFA secret/OTP tests |
| FR-004 | P0 | 1.2 | S1.2-AC02 | API/security | Platform | session revoke/expiry tests |
| FR-005 | P0 | 1.3 | S1.3-AC01 | API/security | Platform | OAuth callback contract tests |
| FR-006 | P0 | 1.3 | S1.3-AC02 | API/security | Platform | OAuth/GitHub separation test |
| FR-007 | P0 | 1.4 | S1.4-AC01 | API/RBAC | Platform | organization create/read tests |
| FR-008 | P0 | 1.4 | S1.4-AC02 | API/RBAC | Platform | membership scope tests |
| FR-009 | P0 | 1.4 / 1.7 | S1.7-AC01 | API/RBAC | Platform | policy template assignment test |
| FR-010 | P1 | 1.5 | S1.5-AC01 | API/UI | Assessment | Developer invite tests |
| FR-011 | P0 | 1.5 / 1.7 | S1.5-AC02 | API/RBAC | Platform | grant/revoke negative tests |
| FR-012 | P0 | 1.6 / 1.7 | S1.6-AC01 | API/RBAC/security | Platform | Manager-only denial tests |
| FR-013 | P0 | 2.1 | S2.1-AC01 | API/E2E | Assessment | assessment creation test |
| FR-014 | P0 | 2.2 | S2.2-AC01 | API/UI/E2E | Assessment | WizardProfile submit test |
| FR-015 | P0 | 2.3 | S2.3-AC01 | UI/E2E | UX / Assessment | no-risk-label readiness test |
| FR-016 | P0 | 3.1 | S3.1-AC01 | API/integration | Scanner | GitHub App read-only connection test |
| FR-017 | P0 | 3.2 | S3.2-AC01 | API/integration | Scanner | commit-pinned snapshot test |
| FR-018 | P0 | 3.3 / 3.5 / 3.6 | S3.3-AC01 | worker/integration | Scanner | scan command/job orchestration test |
| FR-019 | P0 | 3.4 / 3.6 | S3.4-AC01 | worker/security | Scanner | workspace cleanup/privacy tests |
| FR-020 | P0 | 3.7 | S3.7-AC01 | worker/schema | Scanner | invalid evidence rejection test |
| FR-021 | P0 | 3.6 / 3.7 | S3.7-AC03 | worker/quality | Scanner | insufficient evidence blocked-state test |
| FR-022 | P0 | 3.8 | S3.8-AC01 | worker/contract | Intelligence | TechnicalProfile generation test |
| FR-023 | P0 | 3.5 / 3.8 | S3.8-AC02 | worker/contract | Scanner / Intelligence | AI signal evidence-ref test |
| FR-024 | P0 | 4.1 / 4.2 / 4.3 | S4.1-AC01 | worker/contract | Intelligence | AIUsageFlow claim generation test |
| FR-025 | P0 | 4.3 / 4.4 / 4.5 | S4.4-AC01 | worker/contract | Intelligence | unknown/unclear usage test |
| FR-026 | P0 | 4.5 / 5.1 | S5.1-AC01 | worker/contract | Intelligence | conflict candidate detection test |
| FR-027 | P1 | 5.2 | S5.2-AC01 | UI/API | Intelligence / UX | Conflict Score explanation test |
| FR-028 | P0 | 5.3 | S5.3-AC01 | API/UI/E2E | Assessment | Manager conflict task routing test |
| FR-029 | P0 | 5.3 / 5.4 | S5.3-AC02 | API/RBAC | Assessment | Manager resolution audit test |
| FR-030 | P0 | 5.5 | S5.5-AC01 | worker/contract | Intelligence | VerifiedProfile creation gate test |
| FR-031 | P1 | 5.6 | S5.6-AC02 | API/UI/RBAC | Assessment | VerifiedProfile approval test |
| FR-032 | P0 | 6.5 / 6.7 | S6.5-AC01 | worker/integration | Legal | legal retrieval primary-context test |
| FR-033 | P0 | 6.7 | S6.7-AC01 | worker/contract | Legal | LegalRuleMatch generation test |
| FR-034 | P0 | 6.6 / 7.4 | S6.6-AC02 | worker/security | Legal | citation allowlist rejection test |
| FR-035 | P0 | 7.1 / 7.2 | S7.1-AC01 | API/worker | Legal | classification request gate test |
| FR-036 | P0 | 7.2 / 7.5 / 7.6 | S7.6-AC01 | worker/UI | Legal | cited result/blocked state test |
| FR-037 | P1 | 7.6 | S7.6-AC02 | UI/E2E | Legal / UX | classification status display test |
| FR-038 | P1 | 8.1 / 8.2 | S8.1-AC01 | worker/UI | Reporting | GapAnalysis generation/display test |
| FR-039 | P0 | 8.3 | S8.3-AC01 | worker/document | Reporting | final report guard test |
| FR-040 | P1 | 2.4 / 8.4 | S8.4-AC01 | worker/document/UI | Reporting / UX | readiness-only export test |
| FR-041 | P1 | 8.5 | S8.5-AC02 | API/RBAC | Reporting | artifact download authorization test |
| FR-042 | P0 | 1.8 / 8.6 | S8.6-AC01 | API/worker/audit | Platform | material audit event tests |
| FR-043 | P1 | 8.7 | S8.7-AC02 | API/security | Platform | redacted audit export test |
| FR-044 | P0 | 8.5 | S8.5-AC04 | persistence/audit | Platform | immutable artifact version test |
| FR-045 | P0 | 3.11 | S3.11-AC03 | negative/API/UI | Scanner / QA | structured attestation absent test |
| FR-046 | P0 | 3.11 | S3.11-AC03 | negative/API/UI | Scanner / QA | supplemental attestation absent test |
| FR-047 | P1 | 1.5 / 3.9 | S3.9-AC03 | API/UI/RBAC | Assessment | scoped Developer task test |
| FR-048 | P1 | 3.9 | S3.9-AC01 | API/UI/security | Scanner / UX | redacted findings view test |
| FR-049 | P0 | 3.10 | S3.10-AC01 | API/worker/persistence | Scanner | scan rerun immutable history test |
| FR-050 | P0 | 3.3 | S3.3-AC01 | API/worker/integration | Scanner | trusted trigger idempotency test |
| FR-051 | P0 | 3.11 | S3.11-AC01 | negative/API/UI | Scanner / QA | manual JSON upload absent test |
| FR-052 | P1 | 3.11 | S3.11-AC03 | negative/API/UI | Assessment / QA | delegated clarification absent test |
| FR-053 | P1 | 6.1 / 6.2 | S6.1-AC01 | worker/integration | Legal | legal source snapshot test |
| FR-054 | P1 | 6.3 | S6.3-AC01 | API/ops | Legal | LegalCorpusVersion approval test |
| FR-055 | P0 | 7.3 / 7.4 | S7.3-AC01 | integration/security | Platform / Legal | real LLM gateway budget/schema test |
| FR-056 | P0 | 6.2 / 6.4 / 6.5 / 6.6 | S6.4-AC01 | worker/integration | Legal | ChromaDB vectorless retrieval test |

## NFR and Control Trace Rows

| Criterion | Priority | Story | AC ID | Test level | Owner | Evidence artifact |
|---|---:|---|---|---|---|---|
| NFR-008 RBAC deny-by-default | P0 | 1.7 | S1.7-AC02 | API/RBAC/security | Platform | denied action matrix |
| NFR-010 material audit | P0 | 1.8 / 8.6 | S1.8-AC01 | API/worker/audit | Platform | audit event fixture suite |
| NFR-012 raw source not sent to LLM | P0 | 3.4 / 7.3 | S3.4-AC02 | security/worker | Scanner / Platform | prompt payload inspection |
| NFR-015 secret redaction | P0 | 1.8 / 3.7 / 8.6 | S1.8-AC02 | security | Platform / Scanner | secret fixture test |
| NFR-016 provenance metadata | P0 | 3.7 | S3.7-AC01 | worker/persistence | Scanner | evidence provenance assertion |
| NFR-018 fail closed | P0 | 5.5 / 6.7 / 7.6 / 8.3 | S7.6-AC02 | worker/E2E | Legal / Reporting | blocked-state acceptance suite |
| NFR-020 no overclaim | P0 | 2.4 / 8.3 / 8.4 | S8.3-AC03 | document/UX | Reporting / UX | output guardrail review |
| NFR-021 async work not web lifecycle | P0 | 1.9 / 3.3 / 7.1 / 8.3 | S1.9-AC01 | worker/API | Platform | enqueue/status tests |
| NFR-023 bounded scanner | P1 | 3.4 / 3.6 | S3.6-AC01 | worker/performance | Scanner | timeout/resource limit fixtures |
| NFR-026 correlation IDs | P1 | 1.8 / 1.9 | S1.9-AC03 | observability | Platform | log/audit correlation check |
| NFR-027 accessibility | P1 | 2.2 / 7.6 / 8.7 | UX-AC-A11Y-01 | UI/a11y | UX / QA | keyboard/screen-reader checks |
| NFR-029 AIUsageFlow evidence refs | P0 | 4.3 | S4.3-AC01 | worker/contract | Intelligence | claim evidence-ref fixture |
| NFR-030 immutable reruns | P0 | 3.10 / 8.5 | S3.10-AC01 | persistence/audit | Scanner / Platform | immutable chain test |
| NFR-033 LLM budgets | P0 | 7.3 | S7.3-AC01 | integration | Platform | token/cost cap test |
| NFR-034 immutable corpus | P0 | 6.3 | S6.3-AC01 | API/ops | Legal | corpus immutability test |
| NFR-035 scanner sandbox | P0 | 3.4 / 3.6 | S3.4-AC01 | worker/security | Scanner | no install/execute/cleanup tests |
| UX-DR6 stepper gates | P1 | 2.3 / 7.6 | UX-AC-STEP-01 | UI/E2E | UX | no hidden gate skip test |
| UX-DR11 scan status | P1 | 3.3 / 3.10 | UX-AC-SCAN-01 | UI/E2E | UX / Scanner | scan status/retry screen test |
| UX-DR17 citation drawer | P1 | 6.7 / 7.6 | UX-AC-CITE-01 | UI/component | UX / Legal | citation drawer fixture |
| UX-DR21 readiness vs final report | P1 | 2.4 / 8.4 | UX-AC-DOC-01 | UI/document | UX / Reporting | readiness-only labeling test |
| CONTROL-RBAC-RUNTIME | P0 | 1.7 | DEC-RBAC-AC01 | API/worker/security | Platform | `rbac-runtime-decision.md` conformance tests |
| CONTROL-TRIGGER-REPLAY | P0 | 3.3 / 1.9 | DEC-TRIGGER-AC01 | API/worker/queue | Platform / Scanner | trigger replay/DLQ test suite |
| CONTROL-SCANNER-SEVERITY | P0 | 3.6 / 3.7 | DEC-SCANNER-AC01 | worker/security | Scanner | severity/provenance fixture suite |
| CONTROL-STATE-TRANSITIONS | P0 | cross-epic | STATE-AC01 | API/worker/E2E | Platform / QA | state transition table conformance |

## Gap Analysis

### Critical Gaps

No planning traceability gaps remain for active FR IDs.

### High Priority Gaps

Executable automated tests are not present in this planning artifact. Each row above identifies required test level and evidence artifact; implementation tasks must create or cite the concrete test files.

### Gate Decision

`CONCERNS`

Rationale: oracle confidence is high and planning trace rows are complete, but the current repository state does not yet provide executable automated evidence for every row.

```text
CERTIFICATION_GRADE_TRACE_ROWS_CREATED
FR_NFR_UX_CONTROL_TO_STORY_AC_TEST_OWNER_EVIDENCE_MAPPED
QUALITY_GATE_CONCERNS_UNTIL_EXECUTABLE_TESTS_EXIST
```
