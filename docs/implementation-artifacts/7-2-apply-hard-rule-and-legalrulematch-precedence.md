# Story 7.2: Apply Hard-Rule and LegalRuleMatch Precedence

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Apply Hard-Rule and LegalRuleMatch Precedence

## Acceptance Criteria

1. **Given** hard-rule conditions or authoritative LegalRuleMatch constraints apply
   **When** classification runs
   **Then** LCSP applies those rules before model-generated interpretation
   **And** records the rule ID, LegalRuleMatch refs, precedence reason, and outcome.

2. **Given** model output conflicts with hard-rule or LegalRuleMatch precedence
   **When** output validation runs
   **Then** LCSP rejects or corrects the model output according to guardrail policy
   **And** preserves the rejection reason in audit metadata.

## Tasks / Subtasks

- [ ] Apply deterministic hard rules and LegalRuleMatch constraints before model interpretation. (AC: 1)
- [ ] Reject or correct model output when it conflicts with rule precedence. (AC: 2)
- [ ] Audit precedence source, rule IDs and rejection reasons. (AC: 2)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `7-2-apply-hard-rule-and-legalrulematch-precedence`
- Official execution artifact: `docs/implementation-artifacts/7-2-apply-hard-rule-and-legalrulematch-precedence.md`
- Epic: `Epic 7 - Citation-Backed Classification`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `LLM Gateway`

### Current State and Scope Guardrails

- Epic 7 là legal/classification gate. Nếu dev lẫn “model output” với “legal basis”, hệ thống sẽ overclaim ngay ở output quan trọng nhất.
- Story trong epic này phải dùng VerifiedProfile + LegalRuleMatch làm input chính, không dùng provider/model/framework presence hoặc unresolved conflicts như authority.
- Blocked/degraded path ở epic này cũng quan trọng như happy path vì chúng quyết định downstream report behavior.

- Previous story context: `docs/developer/story-handbook/7-1-submit-classification-request-from-approved-verifiedprofile.md`
- Next story dependency seam: `docs/developer/story-handbook/7-3-use-real-llm-provider-with-schema-and-budget-guardrails.md`
- Artifact chain for this epic: VerifiedProfile approved + LegalMatchingResult -> classification request -> citation-backed classification or blocked/degraded state.
- Workflow/state focus: LEGAL_MATCHING_READY -> CLASSIFICATION_REQUESTED -> CLASSIFICATION_READY / CLASSIFICATION_BLOCKED / CLASSIFICATION_DEGRADED.

### Story-Specific Implementation Tasks

- Apply deterministic hard rules and LegalRuleMatch constraints before model interpretation.
- Reject or correct model output when it conflicts with rule precedence.
- Audit precedence source, rule IDs and rejection reasons.

### Task to Acceptance Criteria Traceability

- `AC1`: Apply deterministic hard rules and LegalRuleMatch constraints before model interpretation.
- `AC2`: Reject or correct model output when it conflicts with rule precedence.
- `AC2`: Audit precedence source, rule IDs and rejection reasons.

### Dependencies and Prerequisites

- Story 7.1 valid classification request.
- Current LegalRuleMatch set and classification spec.

### Explicit Non-Goals

- No model override of deterministic legal constraints.
- No precedence logic hidden from audit trail.
- No unsupported final result from conflicting model output.

### Story-Specific Risks and Edge Cases

- Hard-rule missed and model output wins incorrectly.
- Correction path obscures original rejection reason.
- Rule precedence implementation diverges from spec.

### Architecture Compliance

- Classification worker thuộc Python Worker Platform và có thể được orchestrate bằng LangGraph trong bounded runtime; external model invocation chỉ qua LLM Gateway.
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
- [Source: docs/implementation/langgraph-runtime-implementation.md]
- [Source: docs/architecture/adr/adr-024-real-llm-provider-mvp-requirement.md]
- [Source: docs/implementation/readiness/state-transition-authority.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/7-2-apply-hard-rule-and-legalrulematch-precedence.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/7-2-apply-hard-rule-and-legalrulematch-precedence.md
