---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-2-08-find-provider-invocations
jira_issue: LCSP-181
status: READY_FOR_PLANNING
---

# TASK-AO-2-08 — `find_provider_invocations`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-2 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Accepted `ProviderInvocationProjection`; `TECHNICAL_EVIDENCE_READ` |
| Objective | Return actual normalized call facts; declared package/config signals stay separate and cannot become invocation proof. |
| Policy | Audit only; 2s; one transient retry. |

AO-3 uses it to corroborate a provider/framework claim in a path prefix. A dependency-only hit is a declared signal, not invocation.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"provider":{"enum":["OPENAI","GOOGLE","ANTHROPIC","AZURE_OPENAI","OTHER"]},"framework":{"enum":["LANGCHAIN","LANGGRAPH","GENAI_SDK","OPENAI_SDK","OTHER"]},"pathPrefixes":{"type":"array","items":{"type":"string","pattern":"^(?!/|.*\\.\\.)[A-Za-z0-9._/-]+/$"},"maxItems":20,"uniqueItems":true},"maxResults":{"type":"integer","minimum":1,"maximum":100}},"required":["maxResults"]}
```

## 6. Output Schema and Examples

`result={invocations:[{invocationRef,provider,framework?,relativeLocation,symbolRef,evidenceRefs}],declaredSignals:[{kind,ref}],searchedScope:{exhaustive},nextCursor,truncated}`.

```json
{"status":"READY","toolName":"find_provider_invocations","toolVersion":"1.0.0","configHash":"sha256:invocation-v1","correlationId":"ff11bb22-3333-4444-8555-666677778888","artifactVersions":{"technicalEvidenceReportId":"ter_01J"},"provenanceRef":"tool-execution:invoke_01J","coverageState":"SUFFICIENT","evidenceRefs":["invocation:iv_01J"],"limitations":[],"result":{"invocations":[{"invocationRef":"invocation:iv_01J","provider":"OPENAI","framework":"OPENAI_SDK","relativeLocation":"apps/api/src/ai/client.ts:42","symbolRef":"symbol:sym_01J","evidenceRefs":["evidence:ev_01J"]}],"declaredSignals":[],"searchedScope":{"exhaustive":true},"nextCursor":null,"truncated":false}}
```

## 7. Errors and Typed Outcomes

Bad enum/path/cap=`INVALID_ARGUMENT`; missing accepted report=`NEEDS_INPUT`; exhaustive zero calls=`READY`; limited scan=`OUT_OF_COVERAGE`; PBAC/version/tenant=`BLOCKED`; transient timeout=`FAILED` after retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → registry/PBAC/version → exact invocation projection filter → stable page → separate declared signals → coverage/privacy/audit. `ProviderInvocationTool` is `LLM_CALLABLE`, `TECHNICAL_EVIDENCE_READ`, report required, 2s/one retry/`NONE`. Model may claim confirmed use only from `invocations`, may next inspect invocation ref, never source or config. Shared audit fields plus result hash; deny source, prompt, secret, AST, config keys/values and absolute paths.

## 16–18. Scenario, AC, Tests

A repository declares `openai` but calls none: return `invocations:[]`, declared package signal separately, exhaustive `READY`. AC: no signal promotion, deterministic pages, strict input/PBAC/audit/privacy and limited distinction.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | direct/alias invocation | golden integration |
| TC-02 | dependency-only false positive | golden |
| TC-03 | invalid/cross-tenant/limited | contract/integration |
| TC-04 | config/source secret leak | privacy |
| TC-05 | retry/audit | worker |

## 19–22. DoD, Files, Questions, Deliverables

Build contracts/registry, projection/handler/normalizer, PBAC/audit and tests. OQ-01: provider alias taxonomy owner/version (Scanner, OPEN, blocks yes). Deliver safe schema/mapping and tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
