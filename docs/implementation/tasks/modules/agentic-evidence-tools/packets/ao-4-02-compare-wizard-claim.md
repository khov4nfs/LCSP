---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-4-02-compare-wizard-claim
jira_issue: LCSP-161
status: DONE
---
# TASK-AO-4-02 — `compare_wizard_claim`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-4 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Pinned wizard/evidence/coverage comparison projection; `ASSESSMENT_VERIFY` |
| Objective | Deterministically compare one typed target claim to bounded evidence and return verdict, never mutate the wizard. |
| Policy | Audit and append-only conflict-candidate ref only; 4s, one retry. |

AO-4 calls after context is pinned. `NOT_FOUND` requires exhaustive sufficient search; contradiction only creates a proposal ref, not a profile update.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"targetId":{"type":"string","pattern":"^target:[A-Za-z0-9_-]{8,120}$"},"claimField":{"enum":["PROVIDER","AI_USAGE_TYPE","HUMAN_REVIEW","DEPLOYMENT_CONTEXT","DECISION_PATH"]},"expectedValue":{"type":"string","enum":["OPENAI","GOOGLE","ANTHROPIC","PROVIDER_API","HUMAN_REVIEW_PRESENT","PRODUCTION","PRESENT"]},"comparisonScope":{"enum":["ASSESSMENT","TARGET","PATH_PREFIX"]},"maxEvidenceRefs":{"type":"integer","minimum":1,"maximum":20}},"required":["targetId","claimField","expectedValue","comparisonScope","maxEvidenceRefs"]}
```

Shared envelope must pin wizard and evidence artifact versions.

## 6. Output Schema and Examples

`result={verdict:"SUPPORTED"|"CONTRADICTED"|"NOT_FOUND"|"UNKNOWN"|"OUT_OF_COVERAGE",comparedAttributes,evidenceRefs,coverageState,missingEvidenceExplanation?,conflictCandidateRef?}`.

```json
{"status":"READY","toolName":"compare_wizard_claim","toolVersion":"1.0.0","configHash":"sha256:compare-v1","correlationId":"b111bb22-3333-4444-8555-666677778888","artifactVersions":{"wizardProfileId":"wp_01J","technicalEvidenceReportId":"ter_01J"},"provenanceRef":"tool-execution:compare_01J","coverageState":"SUFFICIENT","evidenceRefs":["invocation:iv_01J"],"limitations":[],"result":{"verdict":"SUPPORTED","comparedAttributes":{"claimField":"PROVIDER","expectedValue":"OPENAI"},"evidenceRefs":["invocation:iv_01J"],"coverageState":"SUFFICIENT"}}
```

## 7. Errors and Typed Outcomes

Invalid target/field/value=`INVALID_ARGUMENT`; missing pins=`NEEDS_INPUT`; unknown target=`NOT_FOUND`; limited/dynamic search=`OUT_OF_COVERAGE`; ambiguous evidence=`READY` with `UNKNOWN`; RBAC/version/tenant=`BLOCKED`; transient failure=`FAILED` after retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → registry/RBAC/exact pins → read only AO-2 safe projections → fixed verdict rules → limitation/conflict candidate → privacy/audit. `WizardClaimComparisonTool`, `LLM_CALLABLE`, `ASSESSMENT_VERIFY`, 4s/one retry/append-only candidate idempotent by pins+claim. Model receives verdict/refs only, may report/reroute, cannot edit claim or resolve conflict. Audit shared safe ids/hashes/rules/config/outcome; deny source, raw answers, prompts/secrets/AST.

## 16–18. Scenario, AC, Tests

Target claims `OPENAI`; confirmed invocation yields `SUPPORTED`; a Google-only sufficient scope yields `CONTRADICTED` plus candidate ref; partial scope yields `OUT_OF_COVERAGE`. AC: golden five verdicts, no wizard write, strict/RBAC/privacy/audit.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | five canonical verdict fixtures | golden |
| TC-02 | evidence-ref cap/strict schema | contract |
| TC-03 | partial/dynamic/cross-tenant | integration |
| TC-04 | unchanged wizard/candidate idempotency | integration |
| TC-05 | raw answer/source leak/retry | privacy/worker |

## 19–22. DoD, Files, Questions, Deliverables

Implement comparison contracts/rule version/registry/projection service/candidate repository/API audit/RBAC/tests. OQ-01: approve typed expected-value vocabulary per claim field (Product, OPEN, blocks yes). Deliver definition/schema/rules/audit/tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation-artifacts/ao-4-verify-wizard-targets-and-discover-similar-patterns.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
