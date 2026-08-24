# Story 7.4 Developer Packet

Status: ready-for-dev

## Story

Reject Provider-Only or Unsupported Classification

## Acceptance Criteria

1. **Given** evidence only shows provider, framework, SDK, package, endpoint, or model invocation indicators
   **When** classification evaluates sufficiency
   **Then** LCSP does not classify risk from provider-only evidence
   **And** requires VerifiedProfile and LegalRuleMatch evidence before final classification.

2. **Given** critical AI usage facts remain unknown, unclear, unresolved, or conflict-bearing
   **When** classification is requested
   **Then** LCSP blocks or degrades classification according to policy
   **And** explains the missing evidence or unresolved dimension without assigning unsupported final risk.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `7-4-reject-provider-only-or-unsupported-classification`
- Official execution artifact: `docs/implementation-artifacts/7-4-reject-provider-only-or-unsupported-classification.md`
- Epic: `Epic 7 - Citation-Backed Classification`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `LLM Gateway`

### Current State and Scope Guardrails

- Epic 7 là legal/classification gate. Nếu dev lẫn “model output” với “legal basis”, hệ thống sẽ overclaim ngay ở output quan trọng nhất.
- Story trong epic này phải dùng VerifiedProfile + LegalRuleMatch làm input chính, không dùng provider/model/framework presence hoặc unresolved conflicts như authority.
- Blocked/degraded path ở epic này cũng quan trọng như happy path vì chúng quyết định downstream report behavior.

- Previous story context: `docs/developer/story-handbook/7-3-use-real-llm-provider-with-schema-and-budget-guardrails.md`
- Next story dependency seam: `docs/developer/story-handbook/7-5-validate-classification-citations-against-legal-allowlist.md`
- Artifact chain for this epic: VerifiedProfile approved + LegalMatchingResult -> classification request -> citation-backed classification or blocked/degraded state.
- Workflow/state focus: LEGAL_MATCHING_READY -> CLASSIFICATION_REQUESTED -> CLASSIFICATION_READY / CLASSIFICATION_BLOCKED / CLASSIFICATION_DEGRADED.

### Story-Specific Implementation Tasks

- Enforce sufficiency check that blocks provider/framework-only evidence from final classification.
- Map unknown/unclear/conflict-bearing critical facts into blocked or degraded classification state.
- Expose neutral explanations for missing evidence without unsupported final risk labels.

### Task to Acceptance Criteria Traceability

- `AC1`: Enforce sufficiency check that blocks provider/framework-only evidence from final classification.
- `AC2`: Map unknown/unclear/conflict-bearing critical facts into blocked or degraded classification state.
- `AC2`: Expose neutral explanations for missing evidence without unsupported final risk labels.

### Dependencies and Prerequisites

- Stories 4 and 5 uncertainty/conflict semantics.
- Story 7.3 gateway/runtime handling.

### Explicit Non-Goals

- No classification from provider/model/package detection alone.
- No masking critical unknowns as final result.
- No unsupported HIGH/MEDIUM/LOW output.

### Story-Specific Risks and Edge Cases

- Provider-only indicators treated as legal basis.
- Critical unknown bypasses block logic.
- Manager sees unsupported final risk despite degraded inputs.

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
