# Story 8.1: Generate GapAnalysis From Classification and Evidence

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Generate GapAnalysis From Classification and Evidence

## Acceptance Criteria

1. **Given** classification and required evidence are available
   **When** GapAnalysis generation runs
   **Then** LCSP creates gap items linked to classification result, LegalRuleMatch refs, VerifiedProfile facts, evidence limitations, and recommended remediation area
   **And** each gap has priority, rationale, source refs, status, and timestamp.

2. **Given** classification is blocked or degraded
   **When** GapAnalysis generation runs
   **Then** LCSP creates evidence-readiness or blocker gaps instead of final compliance gaps
   **And** does not imply final legal classification or compliance failure.

## Tasks / Subtasks

- [ ] Generate gap items from classification, LegalRuleMatch, VerifiedProfile and evidence limitations. (AC: 1)
- [ ] Differentiate final compliance gaps from evidence-readiness or blocker gaps when classification is blocked/degraded. (AC: 2)
- [ ] Persist priority, rationale, refs and remediation area per gap item. (AC: 2)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `8-1-generate-gapanalysis-from-classification-and-evidence`
- Official execution artifact: `docs/implementation-artifacts/8-1-generate-gapanalysis-from-classification-and-evidence.md`
- Epic: `Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail`
- Runtime ownership: `apps/web`, `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 8 là lớp output cuối cùng nhưng không được tự ý “nói thay” evidence/legal chain. Mọi overclaim ở đây là lỗi nghiêm trọng.
- Story trong epic này phải ưu tiên gap analysis, document guardrails, artifact versioning và audit redaction/export semantics.
- Readiness-only artifact và final artifact là hai đường output khác nhau; không trộn wording hoặc eligibility.

- Previous story context: none; đây là story mở đầu chuỗi của epic hoặc một entry boundary mới.
- Next story dependency seam: `docs/developer/story-handbook/8-2-display-gap-analysis-with-evidence-and-priority.md`
- Artifact chain for this epic: RiskClassification + LegalRuleMatch + citations -> GapAnalysis -> guarded documents -> versioned download/export -> immutable audit trail.
- Workflow/state focus: CLASSIFICATION_READY -> GAP_ANALYSIS_READY -> DOCUMENT_GENERATED / DOCUMENT_BLOCKED plus audit export generation.

### Story-Specific Implementation Tasks

- Generate gap items from classification, LegalRuleMatch, VerifiedProfile and evidence limitations.
- Differentiate final compliance gaps from evidence-readiness or blocker gaps when classification is blocked/degraded.
- Persist priority, rationale, refs and remediation area per gap item.

### Task to Acceptance Criteria Traceability

- `AC1`: Generate gap items from classification, LegalRuleMatch, VerifiedProfile and evidence limitations.
- `AC2`: Differentiate final compliance gaps from evidence-readiness or blocker gaps when classification is blocked/degraded.
- `AC2`: Persist priority, rationale, refs and remediation area per gap item.

### Dependencies and Prerequisites

- Epic 7 classification state and Epic 6/5 evidence chain.
- Gap analysis trigger contract from classification spec.

### Explicit Non-Goals

- No final compliance implication when only blocker gaps exist.
- No gap item without linked rationale/refs.
- No direct document generation from classification bypassing gap analysis.

### Story-Specific Risks and Edge Cases

- Blocked classification still produces final compliance gaps.
- Gap items lack actionable provenance.
- Priority/rationale inconsistent with legal/evidence basis.

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
- Source packet: `docs/developer/story-handbook/8-1-generate-gapanalysis-from-classification-and-evidence.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/8-1-generate-gapanalysis-from-classification-and-evidence.md
