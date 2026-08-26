# Story 8.5: Download Versioned Artifacts

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, I want to download generated reports and artifacts with version metadata, so that assessment evidence remains traceable.

## Acceptance Criteria

1. **Given** a report or export artifact is generated
   **When** Manager opens artifact history
   **Then** LCSP shows artifact type, version, status, created by, created at, source assessment versions, checksum, and download availability.

2. **Given** Manager downloads an artifact
   **When** LCSP serves the file
   **Then** access is RBAC-checked
   **And** download is audited with artifact ID, version, actor, timestamp, and correlation ID.

3. **Given** Manager permission, organization membership, artifact access, or assessment scope is revoked after artifact generation
   **When** the actor attempts to download the artifact
   **Then** LCSP denies download server-side, hides or marks the artifact unavailable, and audits the denial.

4. **Given** a newer artifact version exists
   **When** Manager views historical artifacts
   **Then** LCSP preserves older versions as immutable historical records
   **And** clearly marks current versus superseded artifacts.

## Tasks / Subtasks

- [ ] Expose artifact history with type, version, status, checksum and source assessment versions. (AC: 1)
- [ ] Enforce RBAC on download serving and audit every access or denial. (AC: 2)
- [ ] Mark current vs superseded artifacts while preserving immutable historical versions. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `8-5-download-versioned-artifacts`
- Official execution artifact: `docs/implementation-artifacts/8-5-download-versioned-artifacts.md`
- Epic: `Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail`
- Runtime ownership: `apps/web`, `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 8 là lớp output cuối cùng nhưng không được tự ý “nói thay” evidence/legal chain. Mọi overclaim ở đây là lỗi nghiêm trọng.
- Story trong epic này phải ưu tiên gap analysis, document guardrails, artifact versioning và audit redaction/export semantics.
- Readiness-only artifact và final artifact là hai đường output khác nhau; không trộn wording hoặc eligibility.

- Previous story context: `docs/developer/story-handbook/8-4-generate-evidence-readiness-report-when-final-evidence-is-missing.md`
- Next story dependency seam: `docs/developer/story-handbook/8-6-record-immutable-assessment-audit-trail.md`
- Artifact chain for this epic: RiskClassification + LegalRuleMatch + citations -> GapAnalysis -> guarded documents -> versioned download/export -> immutable audit trail.
- Workflow/state focus: CLASSIFICATION_READY -> GAP_ANALYSIS_READY -> DOCUMENT_GENERATED / DOCUMENT_BLOCKED plus audit export generation.

### Story-Specific Implementation Tasks

- Expose artifact history with type, version, status, checksum and source assessment versions.
- Enforce RBAC on download serving and audit every access or denial.
- Mark current vs superseded artifacts while preserving immutable historical versions.

### Task to Acceptance Criteria Traceability

- `AC1`: Expose artifact history with type, version, status, checksum and source assessment versions.
- `AC2`: Enforce RBAC on download serving and audit every access or denial.
- `AC3`: Mark current vs superseded artifacts while preserving immutable historical versions.

### Dependencies and Prerequisites

- Generated artifacts from Stories 2.4, 8.3, 8.4 and audit/event foundations.
- RBAC and membership validity from Epic 1.

### Explicit Non-Goals

- No download on revoked membership/scope.
- No mutable replacement of historical artifacts.
- No unaudited artifact access.

### Story-Specific Risks and Edge Cases

- Artifact served after access revoked.
- Current vs superseded version unclear.
- Download endpoint leaks out-of-scope artifact metadata.

### Architecture Compliance

- Gap analysis, document generation và artifact persistence chạy ở async worker chain; API/Web chỉ request, track status và serve authorized downloads/views.
- Document generation phải tiêu thụ Classification + GapAnalysis + citations/evidence appendix; không được chạy trực tiếp từ classification event.
- Audit export là domain riêng, chịu RBAC + redaction policy rõ ràng trước khi download.

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
- Artifact downloads/exports phải tuân RBAC scope và giữ immutable history/superseded version semantics.

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

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/8-5-download-versioned-artifacts.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/8-5-download-versioned-artifacts.md
