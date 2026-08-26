# Story 8.2: Display Gap Analysis With Evidence and Priority

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, I want to review gaps with evidence refs, priority, and recommended actions, so that I can understand what to remediate.

## Acceptance Criteria

1. **Given** GapAnalysis exists
   **When** Manager opens the gap view
   **Then** LCSP shows each gap with title, priority, status, affected assessment area, evidence refs, legal refs where available, explanation, and recommended action
   **And** distinguishes evidence gaps from final classification-backed compliance gaps.

2. **Given** a gap references legal or technical evidence
   **When** Manager inspects the gap
   **Then** LCSP shows redacted provenance, corpus version or evidence version, and limitation notes
   **And** does not expose raw source, secrets, full prompts, or out-of-scope data.

## Tasks / Subtasks

- [ ] Build gap review UI with title, priority, status, evidence/legal refs and recommended action. (AC: 1)
- [ ] Show redacted provenance, corpus/evidence versions and limitation notes on inspection. (AC: 2)
- [ ] Differentiate evidence gaps from classification-backed compliance gaps in presentation. (AC: 2)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `8-2-display-gap-analysis-with-evidence-and-priority`
- Official execution artifact: `docs/implementation-artifacts/8-2-display-gap-analysis-with-evidence-and-priority.md`
- Epic: `Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail`
- Runtime ownership: `apps/web`, `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 8 là lớp output cuối cùng nhưng không được tự ý “nói thay” evidence/legal chain. Mọi overclaim ở đây là lỗi nghiêm trọng.
- Story trong epic này phải ưu tiên gap analysis, document guardrails, artifact versioning và audit redaction/export semantics.
- Readiness-only artifact và final artifact là hai đường output khác nhau; không trộn wording hoặc eligibility.

- Previous story context: `docs/developer/story-handbook/8-1-generate-gapanalysis-from-classification-and-evidence.md`
- Next story dependency seam: `docs/developer/story-handbook/8-3-generate-guarded-final-report.md`
- Artifact chain for this epic: RiskClassification + LegalRuleMatch + citations -> GapAnalysis -> guarded documents -> versioned download/export -> immutable audit trail.
- Workflow/state focus: CLASSIFICATION_READY -> GAP_ANALYSIS_READY -> DOCUMENT_GENERATED / DOCUMENT_BLOCKED plus audit export generation.

### Story-Specific Implementation Tasks

- Build gap review UI with title, priority, status, evidence/legal refs and recommended action.
- Show redacted provenance, corpus/evidence versions and limitation notes on inspection.
- Differentiate evidence gaps from classification-backed compliance gaps in presentation.

### Task to Acceptance Criteria Traceability

- `AC1`: Build gap review UI with title, priority, status, evidence/legal refs and recommended action.
- `AC2`: Show redacted provenance, corpus/evidence versions and limitation notes on inspection.
- `AC2`: Differentiate evidence gaps from classification-backed compliance gaps in presentation.

### Dependencies and Prerequisites

- Story 8.1 GapAnalysis artifact.
- Redaction and RBAC display rules from prior epics.

### Explicit Non-Goals

- No raw source/full prompts/secrets in gap evidence view.
- No collapsing evidence gaps into final compliance gaps.
- No out-of-scope data exposure.

### Story-Specific Risks and Edge Cases

- Gap provenance too sparse for remediation.
- Redaction leaks sensitive technical/legal context.
- Managers misread evidence gap as final legal non-compliance.

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
- Source packet: `docs/developer/story-handbook/8-2-display-gap-analysis-with-evidence-and-priority.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/8-2-display-gap-analysis-with-evidence-and-priority.md
