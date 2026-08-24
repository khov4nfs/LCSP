# Story 7.5 Developer Packet

Status: ready-for-dev

## Story

Validate Classification Citations Against Legal Allowlist

## Acceptance Criteria

1. **Given** classification output contains legal citations or legal_refs
   **When** citation validation runs
   **Then** LCSP accepts only citations present in the current LegalMatchingResult primary, parent, or referenced context allowlist
   **And** validates corpus version, chunk ID, locator, context role, and effective-date status.

2. **Given** classification output cites law outside the allowlist or fabricates a locator
   **When** validation runs
   **Then** LCSP rejects the citation and blocks or degrades the classification result
   **And** records the validation failure.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `7-5-validate-classification-citations-against-legal-allowlist`
- Official execution artifact: `docs/implementation-artifacts/7-5-validate-classification-citations-against-legal-allowlist.md`
- Epic: `Epic 7 - Citation-Backed Classification`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `LLM Gateway`

### Current State and Scope Guardrails

- Epic 7 là legal/classification gate. Nếu dev lẫn “model output” với “legal basis”, hệ thống sẽ overclaim ngay ở output quan trọng nhất.
- Story trong epic này phải dùng VerifiedProfile + LegalRuleMatch làm input chính, không dùng provider/model/framework presence hoặc unresolved conflicts như authority.
- Blocked/degraded path ở epic này cũng quan trọng như happy path vì chúng quyết định downstream report behavior.

- Previous story context: `docs/developer/story-handbook/7-4-reject-provider-only-or-unsupported-classification.md`
- Next story dependency seam: `docs/developer/story-handbook/7-6-present-classification-blocked-or-degraded-state.md`
- Artifact chain for this epic: VerifiedProfile approved + LegalMatchingResult -> classification request -> citation-backed classification or blocked/degraded state.
- Workflow/state focus: LEGAL_MATCHING_READY -> CLASSIFICATION_REQUESTED -> CLASSIFICATION_READY / CLASSIFICATION_BLOCKED / CLASSIFICATION_DEGRADED.

### Story-Specific Implementation Tasks

- Validate classification legal refs against current LegalMatchingResult allowlist and metadata.
- Reject fabricated locators or mismatched corpus/chunk/context-role combinations.
- Persist validation failure details that explain blocked/degraded outcome.

### Task to Acceptance Criteria Traceability

- `AC1`: Validate classification legal refs against current LegalMatchingResult allowlist and metadata.
- `AC2`: Reject fabricated locators or mismatched corpus/chunk/context-role combinations.
- `AC2`: Persist validation failure details that explain blocked/degraded outcome.

### Dependencies and Prerequisites

- Story 6.6 allowlist contract and current LegalMatchingResult.
- Story 7.3/7.4 classification output generation.

### Explicit Non-Goals

- No citation outside current allowlist.
- No fabricated locator acceptance.
- No final classification if citation validation fails materially.

### Story-Specific Risks and Edge Cases

- Output cites law outside retrieved context.
- Context role or corpus version mismatch missed.
- Validation errors not reflected in visible blocked/degraded state.

### Architecture Compliance

- Classification worker thuộc Python Worker Platform; external model invocation chỉ qua LLM Gateway.
- LLM output phải schema-validated, sanitized và không override deterministic legal/citation guardrails.
- API surface chủ yếu là status/read model và Manager-safe explanation of blocked/degraded results.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 7: VerifiedProfile approved + LegalMatchingResult -> classification request -> citation-backed classification or blocked/degraded state.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 7 thường chạm `RiskClassification`, `LegalRuleMatch[]`, citation coverage, blocking reasons, provider/model run metadata và gap-analysis handoff contracts.
- Provider config, token/cost limits, prompt version refs và output hashes là metadata bắt buộc; raw prompts/secrets/full source là forbidden.
- Classification output phải giữ link tới VerifiedProfile version và legal match IDs để downstream audit/report reproduce được.

### State and Audit Requirements

- Missing citation, unknown critical usage, provider-only basis hoặc invalid schema output phải block/degrade thay vì fabricate classification.
- Classification request/completed/blocked/degraded và LLM gateway security/runtime failures đều phải audited.
- Gap Analysis chỉ được trigger sau classification completed; document generation không được nhảy cóc từ classification nếu state authority chưa cho.

### File Structure Notes

- `deepagents` cho classification orchestration/runtime.
- `packages/*` cho classification schema, citation coverage enums, blocking reason contract.
- `apps/api` cho status projection và presentation contract cho blocked/degraded/final states.

### Implementation Guidance for the Dev Agent

- Không để mock mode hoặc credential-unavailable dev path bị trình bày như A-to-Z acceptance evidence.
- Hard-rule precedence và legal matching guardrails phải thắng model output khi có mâu thuẫn.
- Nếu output chỉ đạt diagnostic quality, hãy đánh dấu degraded rõ ràng; không phát hành final classification trá hình.

### Testing Requirements

- Classification worker tests cho hard-rule precedence, blocked/degraded outcomes và citation enforcement.
- LLM Gateway contract tests cho schema validation, forbidden input rejection, timeout/retry/fail-closed behavior.
- Status/read-model tests cho final vs blocked vs degraded presentation.

### References

- [Source: docs/project-context.md]
- [Source: docs/planning-artifacts/epics.md]
- [Source: docs/product/prd.md]
- [Source: docs/specs/functional-requirements.md]
- [Source: docs/specs/non-functional-requirements.md]
- [Source: docs/specs/use-cases.md]
- [Source: docs/specs/domain-model.md]
- [Source: docs/specs/domain-state-machines.md]
- [Source: docs/specs/event-catalog.md]
- [Source: docs/architecture/architecture.md]
- [Source: docs/implementation/dev-compendium.md]
- [Source: docs/specs/legal-classification-spec.md]
- [Source: docs/specs/legal-matching-domain-spec.md]
- [Source: docs/implementation/llm-gateway-implementation.md]
- [Source: docs/architecture/adr/adr-024-real-llm-provider-mvp-requirement.md]
- [Source: docs/implementation/readiness/state-transition-authority.md]
