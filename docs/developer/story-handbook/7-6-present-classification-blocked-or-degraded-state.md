# Story 7.6 Developer Packet

Status: ready-for-dev

## Story

As a Manager, I want to see classification result or clear blocked/degraded state, so that I understand whether LCSP produced a valid result and what evidence is missing.

## Acceptance Criteria

1. **Given** classification succeeds
   **When** Manager views the result
   **Then** LCSP shows classification outcome, confidence, cited legal evidence, VerifiedProfile version, LegalMatchingResult version, linked LegalRuleMatch refs, model/provider metadata where allowed, and generation timestamp
   **And** the UI uses `FINAL_CLASSIFICATION` label only when final gates pass
   **And** distinguishes final classification from readiness-only, blocked, degraded, and intermediate evidence states.

2. **Given** classification is blocked or degraded
   **When** Manager views the assessment
   **Then** LCSP shows `BLOCKED_NO_CLASSIFICATION` or `DEGRADED_NOT_FINAL`, blocker reason, missing evidence, failed gate, or degraded condition
   **And** does not display unsupported HIGH/MEDIUM/LOW risk or compliance conclusion
   **And** final report generation and final report download remain blocked while the state is not final.

3. **Given** classification result is generated
   **When** LCSP stores it
   **Then** the result is versioned and auditable
   **And** later reruns create new classification versions without mutating prior results.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `7-6-present-classification-blocked-or-degraded-state`
- Official execution artifact: `docs/implementation-artifacts/7-6-present-classification-blocked-or-degraded-state.md`
- Epic: `Epic 7 - Citation-Backed Classification`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `LLM Gateway`

### Current State and Scope Guardrails

- Epic 7 là legal/classification gate. Nếu dev lẫn “model output” với “legal basis”, hệ thống sẽ overclaim ngay ở output quan trọng nhất.
- Story trong epic này phải dùng VerifiedProfile + LegalRuleMatch làm input chính, không dùng provider/model/framework presence hoặc unresolved conflicts như authority.
- Blocked/degraded path ở epic này cũng quan trọng như happy path vì chúng quyết định downstream report behavior.

- Previous story context: `docs/developer/story-handbook/7-5-validate-classification-citations-against-legal-allowlist.md`
- Next story dependency seam: none; story này là tail story hiện tại của epic.
- Artifact chain for this epic: VerifiedProfile approved + LegalMatchingResult -> classification request -> citation-backed classification or blocked/degraded state.
- Workflow/state focus: LEGAL_MATCHING_READY -> CLASSIFICATION_REQUESTED -> CLASSIFICATION_READY / CLASSIFICATION_BLOCKED / CLASSIFICATION_DEGRADED.

### Story-Specific Implementation Tasks

- Render final, blocked and degraded classification states with distinct labels and version metadata.
- Show cited evidence, provider/model metadata where allowed, and blocker/degraded reasons appropriately.
- Ensure reruns create new immutable classification versions surfaced in history.

### Story-Specific Subtasks

- Create read model and UI labels that cleanly separate `FINAL_CLASSIFICATION`, `BLOCKED_NO_CLASSIFICATION`, and `DEGRADED_NOT_FINAL`.
- Show cited legal evidence, version refs and provider/model metadata only where policy allows, while preserving blocker/degraded explanations.
- Keep final report and download actions locked whenever classification is not final.
- Persist new classification versions on rerun without mutating historical results and reflect current versus superseded state in history.

### Task to Acceptance Criteria Traceability

- `AC1`: Render final, blocked and degraded classification states with distinct labels and version metadata.
- `AC2`: Show cited evidence, provider/model metadata where allowed, and blocker/degraded reasons appropriately.
- `AC3`: Ensure reruns create new immutable classification versions surfaced in history.

### Dependencies and Prerequisites

- Stories 7.1-7.5 classification request, precedence, provider and citation validation.
- Epic 8 document gating will consume these state labels.

### Explicit Non-Goals

- No final label on blocked/degraded result.
- No mutation of prior classification versions.
- No hiding of blocker reason while final report remains locked.

### Story-Specific Risks and Edge Cases

- Blocked/degraded state presented as final.
- History overwrites prior classification result.
- UI shows unsupported risk or compliance wording in non-final states.

### Architecture Compliance

- Classification worker thuộc Python Worker Platform; external model invocation chỉ qua LLM Gateway.
- LLM output phải schema-validated, sanitized và không override deterministic legal/citation guardrails.
- API surface chủ yếu là status/read model và Manager-safe explanation of blocked/degraded results.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 7: VerifiedProfile approved + LegalMatchingResult -> classification request -> citation-backed classification or blocked/degraded state.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.
- Handoff contract cho story này tồn tại trong `docs/planning-artifacts/epics.md` và phải được giữ nguyên khi thiết kế artifact/output boundary.

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
- [Source: Handoff contract embedded in `docs/planning-artifacts/epics.md` for this story]
