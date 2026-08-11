---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-3-03-resolve-independent-classification-review
status: READY_FOR_PLANNING
---

# TASK-AO-3-03 — `resolve_independent_classification_review`

## 1–4. Task information, objective, use case, definition

| Item | Value |
| --- | --- |
| Story / exposure / mutation | AO-3 / `SYSTEM_ONLY` / `SYSTEM_MUTATION` |
| Owner / gate | API reviewer command + `Classification` transaction; `CLASSIFICATION_REVIEW_RESOLVE`; pending request and independent reviewer |
| Objective | Record an authorized human review. `APPROVE` writes the immutable reviewed `Classification`; `REJECT` closes only the request. It never lets an LLM approve, alters evidence, or reopens a request. |
| Policy | 10 s; one serialization retry; idempotent decision key and append-only audit/outbox. |

The authenticated reviewer invokes this via protected API/UI, never an LLM tool call. On approval, `get_gap_requirements` can consume the resulting `classificationRef`.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"properties":{"reviewRequestRef":{"type":"string","pattern":"^classification-review:[A-Za-z0-9_-]{8,120}$"},"decision":{"enum":["APPROVE","REJECT"]},"decisionCode":{"enum":["EVIDENCE_SUFFICIENT","CITATIONS_INVALID","CONFLICT_UNRESOLVED","COVERAGE_LIMITED","POLICY_MISMATCH"]},"idempotencyKey":{"type":"string","format":"uuid"}},"required":["reviewRequestRef","decision","decisionCode","idempotencyKey"]}
```

No free-text rationale is accepted in this capability; any reviewer note belongs to the protected review record outside LLM context and is redacted from audit projections.

## 6. Output schema and examples

`result={reviewRequestRef,reviewStatus,classificationRef?,classificationStatus?,decisionAuditRef}`.

```json
{"status":"READY","toolName":"resolve_independent_classification_review","toolVersion":"1.0.0","configHash":"sha256:classification-review-resolve-v1","correlationId":"7579fbdd-e1f6-4f1c-966b-3b7a2a4a518e","artifactVersions":{"reviewRequestRef":"classification-review:cr_01J"},"provenanceRef":"prov:classification-review:01J","coverageState":"SUFFICIENT","evidenceRefs":["citation:chunk_01J"],"limitations":[],"result":{"reviewRequestRef":"classification-review:cr_01J","reviewStatus":"APPROVED","classificationRef":"classification:cl_01J","classificationStatus":"REVIEWED","decisionAuditRef":"audit:classification-review:01J"}}
```

`REJECT` returns `READY` with `reviewStatus:"REJECTED"` and no `classificationRef`.

## 7–15. outcomes, flow, rules, execution, context, registry, audit, retry, security

Bad refs/decision are `INVALID_ARGUMENT`; missing request is `NOT_FOUND`; expired/stale inputs need `NEEDS_INPUT`; a non-pending request or new conflict/citation/coverage failure is `BLOCKED`; PBAC/tenant/requester identity mismatch is `BLOCKED`; competing decision is `CONFLICT`; transaction failure is `FAILED` after one retry.

```mermaid
sequenceDiagram
  participant H as Independent reviewer
  participant A as API PBAC/state gate
  participant S as Review decision service
  participant P as Classification/audit/outbox
  H->>A: decision + idempotency key
  A->>S: independent authorized command
  S->>S: lock pending request and revalidate pins
  S->>P: append decision; approve => immutable Classification
  P-->>H: safe review/classification refs
```

Validate → API-authenticated reviewer PBAC/state/tenant/separation check → lock request → revalidate gate, citations, conflicts, coverage and expiry → reserve/replay key → append decision; on `APPROVE`, atomically create immutable `Classification(REVIEWED)` → audit/outbox (`event.classification.reviewed.v1`) → privacy-normalized response. Registry `IndependentClassificationReviewResolutionTool/1.0.0`; `SYSTEM_ONLY`; no model exposure; API command state `PENDING_INDEPENDENT_REVIEW`; action above; 10 s / one serialization retry. Audit reviewer ref (not note), decision code, all safe refs/hashes, policy/version, output hash and correlation. Deny reviewer=requester, cross-tenant access, raw source/prompt/legal text/secret leakage, direct worker/database calls, and post-resolution mutation.

## 16–22. scenarios, AC, tests, DoD, files, questions, deliverables

Scenario: a different authorized reviewer approves a valid pending request; one `classification:cl_01J` is persisted and AO-5 can request its gap matrix. A stale citation blocks approval; rejection persists no classification.

| ID | Scenario | Level |
| --- | --- | --- |
| TC-01 | independent approval creates reviewed immutable classification | integration |
| TC-02 | rejection creates no classification | integration |
| TC-03 | same requester, PBAC/tenant, expired/non-pending request | integration |
| TC-04 | stale citation/open conflict/limited coverage | integration |
| TC-05 | extra/free-text/sensitive payload rejection | contract/privacy |
| TC-06 | concurrent resolve, replay, rollback/outbox | integration |

AC: only an independent authorized human may resolve; approval is atomic and immutable; rejection cannot advance gap work; every decision emits safe audit/outbox evidence. Build contracts, protected API controller/service, repository/migration, outbox, review UI transition, and tests. OQ-01: identify the policy owner for reviewer eligibility/delegation (Compliance, `OPEN`, blocks production readiness). Deliver definitions, command, persistence transition, audit/outbox and full negative coverage.

## Source authority

`tool-catalog.md`; `orchestration-state-machine.md`; `shared-tool-contract.md`; `docs/project-context.md`.
