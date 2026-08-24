# Story 8.7 Developer Packet

Status: ready-for-dev

## Story

As a Manager or authorized auditor, I want to view and export redacted audit events, so that I can review assessment history without exposing secrets or out-of-scope data.

## Acceptance Criteria

1. **Given** an authorized Manager or auditor opens audit trail
   **When** LCSP loads assessment audit events
   **Then** it shows redacted event timeline with filters for actor, action, result, domain, artifact, date, and correlation ID
   **And** access is PBAC-checked and audited.

2. **Given** a user requests audit export
   **When** the export is authorized
   **Then** LCSP creates a redacted audit export with assessment ID, export version, filter criteria, generated timestamp, checksum, and audit event
   **And** excludes secrets, tokens, raw source, full prompts, and out-of-scope tenant data.

3. **Given** a user lacks audit permission or requests out-of-scope data
   **When** LCSP handles the request
   **Then** access is denied server-side with safe explanation
   **And** denial is audited.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `8-7-view-and-export-redacted-audit-trail`
- Official execution artifact: `docs/implementation-artifacts/8-7-view-and-export-redacted-audit-trail.md`
- Epic: `Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail`
- Runtime ownership: `apps/web`, `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 8 là lớp output cuối cùng nhưng không được tự ý “nói thay” evidence/legal chain. Mọi overclaim ở đây là lỗi nghiêm trọng.
- Story trong epic này phải ưu tiên gap analysis, document guardrails, artifact versioning và audit redaction/export semantics.
- Readiness-only artifact và final artifact là hai đường output khác nhau; không trộn wording hoặc eligibility.

- Previous story context: `docs/developer/story-handbook/8-6-record-immutable-assessment-audit-trail.md`
- Next story dependency seam: none; story này là tail story hiện tại của epic.
- Artifact chain for this epic: RiskClassification + LegalRuleMatch + citations -> GapAnalysis -> guarded documents -> versioned download/export -> immutable audit trail.
- Workflow/state focus: CLASSIFICATION_READY -> GAP_ANALYSIS_READY -> DOCUMENT_GENERATED / DOCUMENT_BLOCKED plus audit export generation.

### Story-Specific Implementation Tasks

- Build filtered redacted audit timeline view with PBAC checks and access audit.
- Generate redacted audit export with checksum, filter criteria and version metadata.
- Deny and audit out-of-scope export/view requests without exposing hidden data.

### Task to Acceptance Criteria Traceability

- `AC1`: Build filtered redacted audit timeline view with PBAC checks and access audit.
- `AC2`: Generate redacted audit export with checksum, filter criteria and version metadata.
- `AC3`: Deny and audit out-of-scope export/view requests without exposing hidden data.

### Dependencies and Prerequisites

- Story 8.6 immutable audit trail.
- PBAC authorization for Manager or auditor roles.

### Explicit Non-Goals

- No exposure of secrets, raw source, full prompts or out-of-scope tenant data.
- No export without authorization.
- No hidden cross-tenant filtering leaks in UI/export.

### Story-Specific Risks and Edge Cases

- Audit export includes sensitive or cross-tenant data.
- Timeline filters allow inference of denied records.
- Unauthorized actor accesses export/history.

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
