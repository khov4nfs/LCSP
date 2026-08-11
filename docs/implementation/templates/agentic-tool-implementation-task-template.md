---
template: agentic-tool-implementation-task
version: 2.0.0
status: ACTIVE_TEMPLATE
owner: LCSP Engineering
extends: docs/implementation/templates/implementation-task-template.md
---

# Task Specification — LCSP LLM Tool Calling

Use this template for **one catalog tool**. It adapts the approved LLM Tool Calling template to LCSP's worker-owned capabilities, PBAC, immutable evidence, privacy boundary, and typed orchestration states. A tool packet is not `READY_FOR_SPRINT` until every non-N/A section is filled with concrete values and examples.

## 1. Task Information

| Item | Value |
|---|---|
| Task ID | `TASK-AO-<story>-<sequence>-<tool-slug>` |
| Task name | Build tool `<tool_name>` for LCSP Tool Calling |
| Module | Agentic Evidence / LLM Integration |
| Related Story | AO-1 … AO-6 |
| Priority | `P0` / `P1` / `P2` |
| Assignee / reviewer | |
| Status | `TODO` / `READY_FOR_PLANNING` / `READY_FOR_SPRINT` / `IN_PROGRESS` / `DONE` / `BLOCKED` |
| Runtime / related service | `lcsp-python-workers`; API PBAC/audit/persistence seam; exact module |
| Tool exposure | `LLM_CALLABLE` / `ORCHESTRATOR_ONLY` / `SYSTEM_ONLY` |
| Mutation class | `READ` / `REANALYZE` / `SYSTEM_MUTATION` |

## 2. Objective

State the single business capability, why a model/orchestrator needs it, exact non-goals, and the evidence/corpus/artifact boundary it reads or mutates.

## 3. Use Cases

### UC-01 — Authorized tool invocation

| Step | Behavior |
|---|---|
| Trigger | State the exact workflow requirement that makes the tool available. |
| Caller | `LLM`, `ORCHESTRATOR`, or `SYSTEM`; never imply all tools are LLM-callable. |
| Main flow | User/workflow → allowed tool selection → typed call → PBAC/preflight → worker handler → safe result → constrained LLM context or next state. |
| A1 missing argument/artifact | Typed validation error or `NEEDS_INPUT`; specify allowed resolver. |
| A2 no data | Distinguish exhaustive empty result from `OUT_OF_COVERAGE`. |
| A3 dependency failure | State error/status, retry/DLQ policy, audit and checkpoint behavior. |

## 4. Tool Definition

| Field | Required value |
|---|---|
| Tool name | Exact catalog name |
| Description | One short imperative description: when to use, what it returns, and its scope limit |
| Available when | Workflow states, required artifact versions, PBAC action |
| Do not use when | Overlapping tool / prohibited use |
| Data owner | Named sanitized read model or immutable corpus object |
| Side effect | `NONE` or exact event/outbox/state transition |
| Default/max timeout | Concrete milliseconds/seconds and server ceiling |
| Retry policy | Concrete retryable codes, max attempts/backoff; non-retryable codes |

## 5. Input Schema

### Parameters

| Parameter | Type | Required | Description | Validation / bounds | Example |
|---|---|---:|---|---|---|
| Shared envelope fields | | yes | Reference `shared-tool-contract.md` | Exact required artifact/scope/budget values | |
| Tool-specific field | | | | Enum/format/max/relationship rule | |

### JSON Schema

Provide a complete JSON Schema for the **tool-specific** `input` object: `additionalProperties: false`, all enum values, nested object bounds, arrays/maxItems, and no unconstrained free-text/URL/path/query field. Link the shared envelope schema rather than copying it.

## 6. Output Schema

### Safe result schema

Define the full typed `result` object, every field, array cap, sort/cursor, empty-result representation, coverage/limitation behavior, and evidence/provenance refs. Include:

```json
{
  "status": "READY",
  "toolName": "<tool_name>",
  "toolVersion": "1.0.0",
  "configHash": "sha256:<hash>",
  "correlationId": "<uuid>",
  "artifactVersions": {},
  "provenanceRef": "prov:<id>",
  "coverageState": "SUFFICIENT",
  "evidenceRefs": [],
  "limitations": [],
  "result": {}
}
```

Include one concrete success example and one exhaustive-empty or limited example. Do not use raw source, prompt, secret, AST/CST body, stack trace, absolute path, arbitrary config value, or full legal/OCR document.

## 7. Error Codes and Typed Outcomes

| Code / status | Trigger | Backend behavior | LLM/orchestrator behavior | Retry |
|---|---|---|---|---|
| `INVALID_ARGUMENT` | Schema/bound violation | No handler dispatch | Correct typed args only | Never |
| `MISSING_ARGUMENT` / `NEEDS_INPUT` | Required fact/version absent | Return resolver requirement | Request only allowed input | Never directly |
| `NOT_FOUND` | Exhaustive valid lookup | Return safe empty/not-found result | Do not infer coverage failure | Never |
| `FORBIDDEN` / `BLOCKED` | PBAC/state/resource denial | Fail closed/audit | Do not retry | Never |
| `OUT_OF_COVERAGE` | Explicit scanner/corpus limit | Return limitation refs | Preserve uncertainty | Resolver only |
| `TOOL_TIMEOUT` / `FAILED` | Runtime/dependency failure | Safe normalized failure | Follow policy | Only listed transient codes |

Add tool-specific values and map each to canonical `READY`, `NEEDS_INPUT`, `CONFLICT`, `OUT_OF_COVERAGE`, `BLOCKED`, or `FAILED` status.

## 8. Tool Calling Flow

Provide a Mermaid sequence diagram from caller through allow-list, API PBAC/state preflight, worker handler/read model or authorized mutation, privacy gate/audit, response, and next LLM/orchestrator action.

## 9. Business Rules

List concrete, testable rules for selection, required parameters, artifact/version pinning, scope/budget, PBAC, hallucinated IDs, empty versus limited results, and mutation confirmation/idempotency when applicable.

## 10. Execution Logic

Provide pseudocode with concrete handler stages: validate schema → allow-list → PBAC/state/version → deterministic query/mutation → result normalization/sort/cap → privacy validation → provenance/audit → response. Name the actual service/repository/worker modules to build or reuse.

## 11. LLM Tool Definition and Context Contract

- Provide the exact OpenAI/function-call-compatible definition for `LLM_CALLABLE` tools: name, description, JSON Schema, `strict: true` if supported.
- For `ORCHESTRATOR_ONLY`/`SYSTEM_ONLY`, state `exposed_to_model: false`, caller identity, and why direct model access is unsafe or unnecessary.
- Define the exact safe response fields sent to the model, max context/result size, allowed next tools, and prohibited inferences/actions.
- State prompt/template version and output-hash metadata to audit; never persist raw prompt or unbounded tool result.

## 12. Tool Registry

| Registry field | Value |
|---|---|
| Name/version | |
| Handler / contract module | |
| Capability action / PBAC action | |
| Allowed caller and workflow state | |
| Required artifact refs | |
| Scope/budget ceilings | |
| Timeout/retry/DLQ | |
| Mutation / idempotency key | |

## 13. Logging, Audit, and Observability

Specify `requestId`, `workflowRunId`, `assessmentId`, organization/resource/actor, model/provider metadata if applicable, tool/version/config, safe argument hash/ref, status/error, duration, budget use, artifact/provenance/evidence refs, output hash, timestamp, and correlation ID. Explicitly enumerate fields that are redacted or never logged.

## 14. Timeout and Retry Policy

State exact timeout, concurrency/rate limits, retryable/non-retryable codes, max attempts/backoff/jitter, idempotency/replay behavior, DLQ/terminal transition, and operator signal.

## 15. Security, Privacy, and PBAC

State exact PBAC resource/action/state gate, tenant isolation, input sanitization, deny-list, read model boundary, redaction check, no direct database/object storage/source access by LLM, audit event, and mutation protections.

## 16. Scenarios

Give at least one concrete LCSP workflow example: user need → model/orchestrator choice → valid call JSON → safe result JSON → permitted model/orchestrator next step. Add a limited/error scenario for high-risk tools.

## 17. Acceptance Criteria

Write Given/When/Then ACs for registration/callability, valid call, invalid/extra args, not-found/limited differentiation, PBAC denial, stable result, audit, privacy, timeout/retry, and mutation idempotency when applicable.

## 18. Test Matrix

| ID | Scenario | Level | Expected evidence |
|---|---|---|---|
| TC-01 | Valid typed call | Unit + contract | Exact result schema/order/refs |
| TC-02 | Missing/invalid/extra argument | Contract | No handler dispatch |
| TC-03 | Missing/stale/cross-tenant resource | Integration | Safe typed denial/limitation |
| TC-04 | PBAC/state denial | Integration | Fail closed + audit |
| TC-05 | Empty exhaustive vs limited scope | Integration | Distinct status/result |
| TC-06 | Forbidden nested payload | Privacy | No callback/LLM leak |
| TC-07 | Timeout/transient failure | Worker | Policy retry/DLQ/terminal state |
| TC-08 | Duplicate mutation | Integration | Idempotent replay/no history mutation |

Add domain-specific fixtures and properties/fuzzing for scope/caps where relevant.

## 19. Definition of Done

- Exact tool definition, registry entry, strict input schema, safe result schema/examples, handler/service integration, normalizer, typed errors, PBAC/privacy/audit, timeout/retry, and test matrix are complete.
- LLM exposure and context boundaries are explicitly declared; non-callable tools are not advertised to the model.
- Contract/API/worker tests pass; changed code has review evidence.

## 20. Technical Notes and Files

List `packages/contracts`, API, worker, persistence/outbox and test files to add/change; dependencies; versioning/migration constraints; and authoritative source docs.

## 21. Open Questions

| ID | Question | Owner | Status | Blocks readiness? |
|---|---|---|---|---|
| OQ-01 | Concrete numeric cap/timeout not set by authority | Tech Lead | `OPEN` / `RESOLVED` | yes/no |

## 22. Deliverables

`ToolDefinition + strict schema + registry entry + handler + service/read-model integration + output normalizer + error mapper + audit + tests + LLM exposure configuration`.
