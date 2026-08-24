# Story 7.1 Developer Packet

Status: ready-for-dev

## Story

As a Manager, I want to request classification only after VerifiedProfile and legal evidence are ready, so that classification starts from validated assessment facts.

## Acceptance Criteria

1. **Given** Manager has PBAC permission and an approved VerifiedProfile exists
   **When** Manager requests classification
   **Then** LCSP validates assessment state, VerifiedProfile approval, LegalMatchingResult readiness, `classificationEligible=true`, citation coverage, blocking reasons, retrieval audit ID, and required evidence gates
   **And** creates a classification request with assessment ID, VerifiedProfile version, LegalMatchingResult version, linked LegalRuleMatch refs, actor, timestamp, and correlation ID.

2. **Given** VerifiedProfile is missing, unapproved, stale, or blocked
   **When** Manager requests classification
   **Then** LCSP denies the request with neutral readiness explanation
   **And** no final risk label is shown.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `7-1-submit-classification-request-from-approved-verifiedprofile`
- Official execution artifact: `docs/implementation-artifacts/7-1-submit-classification-request-from-approved-verifiedprofile.md`
- Epic: `Epic 7 - Citation-Backed Classification`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `LLM Gateway`

### Current State and Scope Guardrails

- Epic 7 là legal/classification gate. Nếu dev lẫn “model output” với “legal basis”, hệ thống sẽ overclaim ngay ở output quan trọng nhất.
- Story trong epic này phải dùng VerifiedProfile + LegalRuleMatch làm input chính, không dùng provider/model/framework presence hoặc unresolved conflicts như authority.
- Blocked/degraded path ở epic này cũng quan trọng như happy path vì chúng quyết định downstream report behavior.

- Previous story context: none; đây là story mở đầu chuỗi của epic hoặc một entry boundary mới.
- Next story dependency seam: `docs/developer/story-handbook/7-2-apply-hard-rule-and-legalrulematch-precedence.md`
- Artifact chain for this epic: VerifiedProfile approved + LegalMatchingResult -> classification request -> citation-backed classification or blocked/degraded state.
- Workflow/state focus: LEGAL_MATCHING_READY -> CLASSIFICATION_REQUESTED -> CLASSIFICATION_READY / CLASSIFICATION_BLOCKED / CLASSIFICATION_DEGRADED.

### Story-Specific Implementation Tasks

- Validate Manager request against VerifiedProfile approval, LegalMatchingResult readiness and classification eligibility gates.
- Persist classification request with version refs, linked LegalRuleMatch refs, actor and correlation metadata.
- Return neutral readiness explanation when prerequisites are missing or stale.

### Task to Acceptance Criteria Traceability

- `AC1`: Validate Manager request against VerifiedProfile approval, LegalMatchingResult readiness and classification eligibility gates.
- `AC2`: Persist classification request with version refs, linked LegalRuleMatch refs, actor and correlation metadata.
- `AC2`: Return neutral readiness explanation when prerequisites are missing or stale.

### Dependencies and Prerequisites

- Epic 5 approved VerifiedProfile and Epic 6 current LegalMatchingResult.
- PBAC permission for classification request.

### Explicit Non-Goals

- No request from missing/unapproved/stale VerifiedProfile.
- No final risk label on denied request.
- No direct use of raw AIUsageFlow or unresolved conflicts.

### Story-Specific Risks and Edge Cases

- Classification starts from stale inputs.
- Denied request leaks internal gate logic unsafely.
- Request record lacks version refs for audit/replay.

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
