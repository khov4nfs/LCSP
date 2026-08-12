---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-4-06-get-verified-profile
jira_issue: LCSP-216
status: READY_FOR_PLANNING
---

# TASK-AO-4-06 — `get_verified_profile`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-4 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Versioned `VerifiedProfileProjection`; `VERIFIED_PROFILE_READ`, approved state/no open conflict/exact version |
| Objective | Return legal-safe merged facts and evidence refs only after owning gates, for named downstream purpose. |
| Policy | Audit only; 1s, one transient retry. |

AO-5 uses it for `LEGAL_MATCHING`/`CLASSIFICATION`; unapproved, stale, unresolved or rejected profile must block, not fall back to Wizard text.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"verifiedProfileRef":{"type":"string","pattern":"^verified:[A-Za-z0-9_-]{8,120}$"},"expectedVersion":{"type":"string","pattern":"^[1-9][0-9]{0,9}$"},"requiredFor":{"enum":["LEGAL_MATCHING","CLASSIFICATION","GAP_ANALYSIS"]}},"required":["verifiedProfileRef","expectedVersion","requiredFor"]}
```

## 6. Output Schema and Examples

`result={profileRef,version,status,legalSafeFacts:{aiUsageTypes,providers,reviewState,deploymentCategories},factEvidenceRefs,gatesPassedAt,blockingReason?}`; facts are typed categories, no free-text answers.

```json
{"status":"READY","toolName":"get_verified_profile","toolVersion":"1.0.0","configHash":"sha256:verified-profile-v1","correlationId":"b511bb22-3333-4444-8555-666677778888","artifactVersions":{"verifiedProfileId":"verified_vp_01J"},"provenanceRef":"tool-execution:verified_01J","coverageState":"SUFFICIENT","evidenceRefs":["verified:vp_01J"],"limitations":[],"result":{"profileRef":"verified:vp_01J","version":"3","status":"VERIFIED","legalSafeFacts":{"aiUsageTypes":["PROVIDER_API"],"providers":["OPENAI"],"reviewState":"PRESENT","deploymentCategories":["WORKLOAD"]},"factEvidenceRefs":["invocation:iv_01J","review:hr_01J"],"gatesPassedAt":"2026-08-11T09:30:00Z"}}
```

## 7. Errors and Typed Outcomes

Bad ref/version/purpose=`INVALID_ARGUMENT`; absent reference=`NEEDS_INPUT`; unknown ref=`NOT_FOUND`; gate evidence limited=`OUT_OF_COVERAGE`; pending/rejected/open-conflict/PBAC/tenant/version mismatch=`BLOCKED`; transient timeout=`FAILED` after retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → registry/PBAC/exact version → verify approval/no conflict/integrity gates → legal-safe projection → privacy/audit. `VerifiedProfileTool`, `LLM_CALLABLE`, `VERIFIED_PROFILE_READ`, 1s/one retry/`NONE`. Model receives typed facts only for `requiredFor`, may proceed to matching/classification only while pin holds; it cannot access profile history, raw wizard answers or override gates. Audit shared hashes/version/gate/provenance/refs; deny raw source/prompts/secrets/AST/PII/free-text/direct storage.

## 16–18. Scenario, AC, Tests

AO-5 requests v3 for legal matching; verified facts/refs return. Open conflict produces `BLOCKED` with safe reason. AC: exact version and gate enforcement, purpose bound, strict/PBAC/privacy/audit.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | verified exact legal-safe projection | integration |
| TC-02 | pending/rejected/open conflict/version mismatch | integration |
| TC-03 | purpose/extra/PBAC tenant denial | contract/integration |
| TC-04 | raw answer/PII payload leak | privacy |
| TC-05 | timeout/audit | worker/API |

## 19–22. DoD, Files, Questions, Deliverables

Implement verified-profile contracts/registry/read model/API PBAC/audit/tests. OQ-01: approve legal-safe fact allow-list by downstream purpose (Legal+Security, OPEN, blocks yes). Deliver strict schema/gate mapper/audit/tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation-artifacts/ao-4-verify-wizard-targets-and-discover-similar-patterns.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
