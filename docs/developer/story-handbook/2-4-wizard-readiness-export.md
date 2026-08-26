# Story 2.4 Developer Packet

Status: ready-for-dev

## Story

As a Manager, I want to generate a Wizard Readiness Export before technical evidence is available, so that I can share preparation gaps without implying legal classification.

## Acceptance Criteria

1. **Given** WizardProfile is submitted and classification is locked for missing technical evidence
   **When** the Manager requests Wizard Readiness Export from the Wizard or assessment readiness entry point
   **Then** LCSP generates an export labeled `Wizard Readiness Export` and readiness-only in title, badge, preview, metadata, artifact history, and download state
   **And** the export includes missing evidence checklist, explicit unresolved `unknown / chưa rõ` items, and preliminary preparation guidance
   **And** the export contains no HIGH/MEDIUM/LOW, final risk, legal conclusion, compliance certification, or non-compliant wording
   **And** the generated artifact has version, timestamp, owner, assessment ID, and audit event.

2. **Given** export generation text attempts to imply legal conclusion or final classification
   **When** output guardrails evaluate the export
   **Then** LCSP blocks generation or removes the overclaim
   **And** records a safe blocked/guardrail audit event.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `2-4-wizard-readiness-export`
- Official execution artifact: `docs/implementation-artifacts/2-4-wizard-readiness-export.md`
- Epic: `Epic 2 - Manager Assessment and Wizard Readiness`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 2 là Manager golden path đầu tiên sau auth foundation. Nếu UX/business-language sai ở đây, downstream technical/legal chains sẽ khó sử dụng.
- Story trong epic này phải ưu tiên assessment ownership, wizard completeness và readiness-only behavior trước risk/classification.
- Developer vẫn là optional collaborator; Manager phải tự hoàn tất flow chính mà không phụ thuộc Developer assignment.

- Previous story context: `docs/developer/story-handbook/2-3-wizard-only-readiness-without-risk-level.md`
- Next story dependency seam: none; story này là tail story hiện tại của epic.
- Artifact chain for this epic: authenticated Manager workspace -> assessment creation -> WizardProfile completion -> readiness-only outputs.
- Workflow/state focus: assessment and wizard states from CREATED to WIZARD_PROFILE_READY to READINESS_EXPORT_GENERATED.

### Story-Specific Implementation Tasks

- Create readiness-only export generation path from wizard/assessment entry points.
- Apply output guardrails to title, metadata, artifact history and file content.
- Persist versioned export artifact with owner, assessment ID, timestamp and audit event.
- Ensure readiness export template mirrors Wizard package semantics and `WIZARD-MAPPING.md`: readiness-only badge, missing-evidence checklist, unresolved unknowns, and next-step CTA set.

### Task to Acceptance Criteria Traceability

- `AC1`: Create readiness-only export generation path from wizard/assessment entry points.
- `AC2`: Apply output guardrails to title, metadata, artifact history and file content.
- `AC1`: Ensure readiness export template mirrors Wizard package semantics and `WIZARD-MAPPING.md`: readiness-only badge, missing-evidence checklist, unresolved unknowns, and next-step CTA set.
- `AC1`, `AC2`: Persist versioned export artifact with owner, assessment ID, timestamp and audit event.

### Dependencies and Prerequisites

- Story 2.3 readiness-only overview state.
- Document/output guardrail conventions.
- Wizard Epic 2 UX package: `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/EXPERIENCE.md`
- Export/readiness metadata contract: `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/WIZARD-MAPPING.md`

### Explicit Non-Goals

- No final legal conclusion or risk labels.
- No replacement of later evidence-based reports.
- No bypass of output guardrail checks.
- No novel legal recommendation section beyond readiness guidance and next-step framing.

### Story-Specific Risks and Edge Cases

- Export content overclaims legal conclusion.
- Artifact metadata fails to carry readiness-only labeling.
- Guardrail block not surfaced safely to Manager.
- Export drops unresolved unknown-state items, làm người nhận hiểu sai mức độ hoàn chỉnh của Wizard.

### Architecture Compliance

- Web owns wizard/readiness UX, nhưng state validation và authorization vẫn thuộc API control plane.
- Assessment aggregate phải giữ owner, organization scope và workflow state rõ ràng cho downstream repository/scan/legal chain.
- Readiness-only outputs không được nhảy cóc sang classification/final-report wording.
- Export semantics phải tiêu thụ readiness projection thay vì suy ra từ final-report template; đây là artifact khác loại, không phải downgraded report.
- Material unknown items trong export phải bám projection contract từ mapping artifact; không được drop vì lý do "quá chi tiết".

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 2: authenticated Manager workspace -> assessment creation -> WizardProfile completion -> readiness-only outputs.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 2 thường chạm `Assessment`, `WizardProfile`, wizard section drafts, readiness export metadata và UI projection read models.
- Business-language fields phải map được sang downstream technical/legal needs mà không lẫn implementation jargon trên UX.
- Versioning của WizardProfile và export artifact phải tương thích với immutable downstream chain.
- Export metadata nên mang rõ `readiness_only=true` hoặc equivalent typed flag để downstream history/download surfaces không hiểu sai artifact class.
- Export phải mang được `wizard_profile_version` hoặc equivalent version pointer để người nhận biết đây là readiness dựa trên self-declared input nào.

### State and Audit Requirements

- Transition authority trọng tâm là `CREATED`, `WIZARD_IN_PROGRESS`, `WIZARD_PROFILE_READY`, `READINESS_EXPORT_GENERATED`.
- Assessment create, wizard save/submit, readiness export request đều phải audited với correlation ID.
- Nếu chưa có accepted evidence hoặc final basis, UI class phải giữ `READINESS_ONLY` thay vì ám chỉ final legal/risk result.

### File Structure Notes

- `apps/web` cho assessment dashboard, wizard screens, readiness-only status và export entry points.
- `apps/api` cho assessment/wizard DTOs, state guards, RBAC checks và audit emission.
- `packages/*` cho section schema, validation contract và export/read-model types.

### Implementation Guidance for the Dev Agent

- Ưu tiên business-language và actionable next step cho Manager; không đẩy scanner/legal vocabulary vào bước wizard sớm.
- Readiness output là first-class artifact riêng; không chèn risk level hoặc legal certainty nếu story chưa mở gate đó.
- Mọi state-changing endpoint phải recheck assessment ownership, org scope và workflow guard ở service layer.
- Export nên đọc trực tiếp từ readiness panel semantics đã khóa ở Story 2.3 để title, badge, preview, metadata và file content cùng một nguồn sự thật.
- Không cho export tự tính lại unknown/material gaps từ raw answers nếu readiness projection đã có; một nguồn sự thật là điều kiện để audit và history sạch.

### Testing Requirements

- Assessment create/update/state-transition API tests.
- Wizard validation, draft/save/submit negative-path coverage.
- Readiness-only export/content guard tests và Manager-facing UX blocked states.
- Export tests cho:
  - readiness-only label xuất hiện ở title/badge/metadata/download history
  - unknown-state items được render như unresolved context, không như lỗi hệ thống
  - overclaim wording bị block hoặc sanitize

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
- [Source: docs/specs/assessment-lifecycle-spec.md]
- [Source: docs/specs/user-task-flows.md]
- [Source: docs/planning-artifacts/canonical-ux-review-2026-06-25.md]
- [Source: docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/DESIGN.md]
- [Source: docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/EXPERIENCE.md]
- [Source: docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/WIZARD-MAPPING.md]
- [Source: docs/implementation/backend-implementation.md]
- [Source: docs/implementation/readiness/state-transition-authority.md]
