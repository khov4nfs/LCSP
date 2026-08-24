# Story 8.3 Developer Packet

Status: ready-for-dev

## Story

As a Manager, I want to generate a final report only when required evidence and classification gates pass, so that the document does not overclaim compliance or legal certainty.

## Acceptance Criteria

1. **Given** VerifiedProfile, LegalRuleMatch, classification, citation validation, and GapAnalysis are ready
   **When** Manager requests final report generation
   **Then** LCSP generates a versioned final report with assessment summary, evidence summary, classification, legal citations, gaps, limitations, artifact metadata, and audit event
   **And** report claims are constrained by approved evidence and citation allowlist.

2. **Given** required final-report gates fail
   **When** Manager requests final report generation
   **Then** LCSP blocks final report generation
   **And** explains missing gates or required next actions without creating a final legal conclusion.

3. **Given** generated report text includes unsupported compliance certification, legal certainty, out-of-allowlist citation, or ungrounded risk label
   **When** output guardrails evaluate it
   **Then** LCSP blocks or removes the overclaim
   **And** records the guardrail event.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `8-3-generate-guarded-final-report`
- Official execution artifact: `docs/implementation-artifacts/8-3-generate-guarded-final-report.md`
- Epic: `Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail`
- Runtime ownership: `apps/web`, `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 8 là lớp output cuối cùng nhưng không được tự ý “nói thay” evidence/legal chain. Mọi overclaim ở đây là lỗi nghiêm trọng.
- Story trong epic này phải ưu tiên gap analysis, document guardrails, artifact versioning và audit redaction/export semantics.
- Readiness-only artifact và final artifact là hai đường output khác nhau; không trộn wording hoặc eligibility.

- Previous story context: `docs/developer/story-handbook/8-2-display-gap-analysis-with-evidence-and-priority.md`
- Next story dependency seam: `docs/developer/story-handbook/8-4-generate-evidence-readiness-report-when-final-evidence-is-missing.md`
- Artifact chain for this epic: RiskClassification + LegalRuleMatch + citations -> GapAnalysis -> guarded documents -> versioned download/export -> immutable audit trail.
- Workflow/state focus: CLASSIFICATION_READY -> GAP_ANALYSIS_READY -> DOCUMENT_GENERATED / DOCUMENT_BLOCKED plus audit export generation.

### Story-Specific Implementation Tasks

- Generate versioned final report only from ready VerifiedProfile, LegalRuleMatch, classification, citations and GapAnalysis.
- Run output guardrails against unsupported certification/legal certainty/out-of-allowlist citations.
- Persist artifact metadata, audit event and blocker explanation when final gates fail.

### Story-Specific Subtasks

- Validate final-report prerequisites against current VerifiedProfile, LegalMatchingResult, final classification, citation validation and GapAnalysis versions.
- Generate versioned final report artifact with constrained claims, citations, limitations and artifact metadata only after all gates pass.
- Run output guardrails to block unsupported certification, legal certainty, out-of-allowlist citation or ungrounded risk wording.
- Persist blocked generation outcome, safe next action and audit event whenever final report gates or output guardrails fail.

### Task to Acceptance Criteria Traceability

- `AC1`: Generate versioned final report only from ready VerifiedProfile, LegalRuleMatch, classification, citations and GapAnalysis.
- `AC2`: Run output guardrails against unsupported certification/legal certainty/out-of-allowlist citations.
- `AC3`: Persist artifact metadata, audit event and blocker explanation when final gates fail.

### Dependencies and Prerequisites

- Epic 5 approved VerifiedProfile, Epic 6 citations, Epic 7 final classification, Story 8.1 GapAnalysis.
- Document-generation guardrails spec.

### Explicit Non-Goals

- No final report when upstream state is blocked/degraded.
- No unsupported compliance certification wording.
- No bypass of citation allowlist or output guardrails.

### Story-Specific Risks and Edge Cases

- Document overclaims legal certainty.
- Final report generated from stale or blocked state.
- Guardrail failure not visible to Manager.

### Architecture Compliance

- Gap analysis, document generation và artifact persistence chạy ở async worker chain; API/Web chỉ request, track status và serve authorized downloads/views.
- Document generation phải tiêu thụ Classification + GapAnalysis + citations/evidence appendix; không được chạy trực tiếp từ classification event.
- Audit export là domain riêng, chịu PBAC + redaction policy rõ ràng trước khi download.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 8: RiskClassification + LegalRuleMatch + citations -> GapAnalysis -> guarded documents -> versioned download/export -> immutable audit trail.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 8 thường chạm `GapAnalysis`, `GeneratedDocument`, versioned artifact metadata, download tokens/refs, `AuditEvent` query/export models và redacted trail views.
- Mỗi generated artifact phải link về classification, gap analysis, citation coverage và version chain tương ứng.
- Raw source, secrets, full prompt, full AST bodies hoặc citation ngoài allowlist không được đi vào document/export output.

### State and Audit Requirements

- Final report chỉ hợp lệ khi `CLASSIFICATION_READY`, `GAP_ANALYSIS_READY`, citations valid và không còn unresolved material conflict.
- Document blocked, readiness-generated, final generated và audit-export-generated đều phải có audit trail và status projection rõ.
- Artifact downloads/exports phải tuân PBAC scope và giữ immutable history/superseded version semantics.

### File Structure Notes

- `deepagents` cho gap-analysis worker và document-generation worker.
- `apps/api` cho download/export authorization, audit query surfaces, artifact status/read model.
- `apps/web` cho gap analysis display, artifact download UI, redacted audit trail views.

### Implementation Guidance for the Dev Agent

- Không tạo final legal output khi thiếu citation traceability hoặc upstream state đang blocked/degraded.
- Gap analysis là first-class component; đừng gộp nó thành phần phụ của classification hoặc document rendering.
- Khi export audit trail, ưu tiên redaction policy và provenance clarity hơn “đầy đủ mọi thứ”.

### Testing Requirements

- Gap analysis contract tests, blocked/final eligibility tests và document-generation guard tests.
- Versioned artifact download/export authorization tests.
- Audit export redaction, immutability và history/superseded-chain assertions.

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
- [Source: docs/specs/document-generation-spec.md]
- [Source: docs/specs/legal-classification-spec.md]
- [Source: docs/specs/assessment-lifecycle-spec.md]
- [Source: docs/implementation/backend-implementation.md]
- [Source: docs/implementation/queue-implementation.md]
- [Source: docs/implementation/readiness/state-transition-authority.md]
