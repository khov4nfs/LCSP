---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-4-01-get-assessment-context
jira_issue: LCSP-190
status: READY_FOR_PLANNING
---

# TASK-AO-4-01 — `get_assessment_context`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-4 / `LLM_CALLABLE` / `READ` |
| Owner / gate | API `WizardProfileProjection`; `ASSESSMENT_READ`, submitted exact profile version, assessment tenancy |
| Objective | Return selected redacted typed wizard answers, target IDs and pinned artifact refs; never alter answers or return free-form sensitive fields. |
| Policy | Audit only; 1s, one transient retry. |

AO-3/4 calls when verifying submitted claims. Missing or unsubmitted version yields `NEEDS_INPUT`; it must never silently select latest profile.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"include":{"type":"array","items":{"enum":["TARGET_IDS","PINNED_ARTIFACTS","SUBMITTED_ANSWERS"]},"minItems":1,"maxItems":3,"uniqueItems":true},"answerFields":{"type":"array","items":{"enum":["SYSTEM_PURPOSE","AI_USAGE_TYPE","PROVIDER_DECLARATION","HUMAN_REVIEW_DECLARATION","DEPLOYMENT_DECLARATION"]},"maxItems":5,"uniqueItems":true}},"required":["include"]}
```

## 6. Output Schema and Examples

`result={wizard:{assessmentId,profileRef,version,status,submittedAt,answers?,targetIds?},artifactVersions?}`; answer values are typed enums/IDs only.

```json
{"status":"READY","toolName":"get_assessment_context","toolVersion":"1.0.0","configHash":"sha256:wizard-context-v1","correlationId":"b011bb22-3333-4444-8555-666677778888","artifactVersions":{"wizardProfileId":"wp_01J","technicalEvidenceReportId":"ter_01J"},"provenanceRef":"tool-execution:wizard_01J","coverageState":"SUFFICIENT","evidenceRefs":["wizard:wp_01J"],"limitations":[],"result":{"wizard":{"assessmentId":"assessment:as_01J","profileRef":"wizard:wp_01J","version":"7","status":"SUBMITTED","submittedAt":"2026-08-11T09:00:00Z","answers":{"AI_USAGE_TYPE":"PROVIDER_API"},"targetIds":["target:tg_01J"]},"artifactVersions":{"technicalEvidenceReportId":"ter_01J"}}}
```

## 7. Errors and Typed Outcomes

Extra/unknown answer field=`INVALID_ARGUMENT`; absent/unsubmitted profile=`NEEDS_INPUT`; profile not found=`NOT_FOUND`; redacted/limited context=`OUT_OF_COVERAGE`; PBAC/tenant/version=`BLOCKED`; transient read=`FAILED` after retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → allow-list/PBAC/version → selected projection fields → stable target order → redaction/privacy → audit. Registry `AssessmentContextTool`, `LLM_CALLABLE`, `ASSESSMENT_READ`, submitted profile required, 1s/one retry/`NONE`. Model sees only listed safe field values/refs, may use pins in AO-4 reads, cannot update wizard/take latest/reveal other fields. Audit shared IDs/version/field names/hashes/output refs; no raw answer free-text, PII, prompt, secret, source or direct DB access.

## 16–18. Scenario, AC, Tests

Verifier reads declared provider and target IDs for version 7 then passes `ter_01J` to comparison; version mismatch becomes `NEEDS_INPUT`. AC: exact submitted pin, allow-listed field projection, strict/PBAC/tenant, privacy/audit.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | selected safe answers/target order | unit/contract |
| TC-02 | unsubmitted/stale/version mismatch | integration |
| TC-03 | tenant/PBAC/extra field | integration/contract |
| TC-04 | free-text/PII nested redaction | privacy |
| TC-05 | retry/audit | worker/API |

## 19–22. DoD, Files, Questions, Deliverables

Add assessment contracts/registry/projection handler/API PBAC/audit/tests. OQ-01: approve answer-field allow-list (Product+Security, OPEN, blocks yes). Deliver strict schema, mapper/audit/tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
