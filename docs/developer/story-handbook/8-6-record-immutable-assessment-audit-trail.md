# Story 8.6 Developer Packet

Status: ready-for-dev

## Story

Record Immutable Assessment Audit Trail

## Acceptance Criteria

1. **Given** material actions occur across authentication, PBAC, assessment, wizard, repository, scan, evidence, AIUsageFlow, reconciliation, legal retrieval, classification, reports, artifacts, or exports
   **When** LCSP processes the action
   **Then** it records audit event with actor, action, resource, organization, assessment ID, result, timestamp, policy version where applicable, correlation ID, and redaction status.

2. **Given** an event includes sensitive data, tokens, secrets, raw source, full prompts, or out-of-scope details
   **When** audit payload is written
   **Then** LCSP redacts or omits sensitive fields
   **And** stores only approved metadata and safe refs.

3. **Given** audit event write fails for a material action
   **When** LCSP evaluates the operation
   **Then** it follows the configured failure policy for blocking, retrying, or marking degraded state
   **And** never silently drops required audit evidence.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `8-6-record-immutable-assessment-audit-trail`
- Official execution artifact: `docs/implementation-artifacts/8-6-record-immutable-assessment-audit-trail.md`
- Epic: `Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail`
- Runtime ownership: `apps/web`, `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 8 là lớp output cuối cùng nhưng không được tự ý “nói thay” evidence/legal chain. Mọi overclaim ở đây là lỗi nghiêm trọng.
- Story trong epic này phải ưu tiên gap analysis, document guardrails, artifact versioning và audit redaction/export semantics.
- Readiness-only artifact và final artifact là hai đường output khác nhau; không trộn wording hoặc eligibility.

- Previous story context: `docs/developer/story-handbook/8-5-download-versioned-artifacts.md`
- Next story dependency seam: `docs/developer/story-handbook/8-7-view-and-export-redacted-audit-trail.md`
- Artifact chain for this epic: RiskClassification + LegalRuleMatch + citations -> GapAnalysis -> guarded documents -> versioned download/export -> immutable audit trail.
- Workflow/state focus: CLASSIFICATION_READY -> GAP_ANALYSIS_READY -> DOCUMENT_GENERATED / DOCUMENT_BLOCKED plus audit export generation.

### Story-Specific Implementation Tasks

- Write immutable redacted audit events for all material domains from auth through exports.
- Apply redaction/omission policy to secrets, tokens, raw source, full prompts and out-of-scope details.
- Handle audit write failure by blocking/retrying/degrading per configured policy instead of silent drop.

### Task to Acceptance Criteria Traceability

- `AC1`: Write immutable redacted audit events for all material domains from auth through exports.
- `AC2`: Apply redaction/omission policy to secrets, tokens, raw source, full prompts and out-of-scope details.
- `AC3`: Handle audit write failure by blocking/retrying/degrading per configured policy instead of silent drop.

### Dependencies and Prerequisites

- Foundational audit contract from Epic 1 and all downstream domain events.
- Failure policy and queue/persistence behavior.

### Explicit Non-Goals

- No silent drop of required audit event.
- No storage of sensitive raw payloads.
- No mutable audit correction that rewrites history.

### Story-Specific Risks and Edge Cases

- Material action succeeds without durable audit.
- Redaction incomplete for sensitive fields.
- Failure policy inconsistent across domains.

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
