# Story 2.3 Developer Packet

Status: ready-for-dev

## Story

As a Manager, I want readiness guidance after Wizard submission when technical evidence is missing, so that I know the next required actions without seeing unsupported risk classification.

## Acceptance Criteria

1. **Given** WizardProfile is submitted and no accepted technical evidence exists
   **When** the Manager views assessment overview
   **Then** LCSP shows readiness-only state, missing evidence checklist, next action, blocker reason, and explicit carry-over of any `unknown / chưa rõ` business context that still needs validation
   **And** LCSP does not show HIGH/MEDIUM/LOW, risk, severity, violation, non-compliant, or equivalent authoritative labels
   **And** classification remains locked with `LOCKED_EVIDENCE_REQUIRED` or equivalent neutral status
   **And** the UI explains that repository evidence is required before classification.

2. **Given** technical evidence later becomes available
   **When** the Manager returns to the assessment overview
   **Then** readiness state updates without mutating the original WizardProfile version
   **And** the transition is auditable.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `2-3-wizard-only-readiness-without-risk-level`
- Official execution artifact: `docs/implementation-artifacts/2-3-wizard-only-readiness-without-risk-level.md`
- Epic: `Epic 2 - Manager Assessment and Wizard Readiness`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 2 là Manager golden path đầu tiên sau auth foundation. Nếu UX/business-language sai ở đây, downstream technical/legal chains sẽ khó sử dụng.
- Story trong epic này phải ưu tiên assessment ownership, wizard completeness và readiness-only behavior trước risk/classification.
- Developer vẫn là optional collaborator; Manager phải tự hoàn tất flow chính mà không phụ thuộc Developer assignment.

- Previous story context: `docs/developer/story-handbook/2-2-complete-wizardprofile-in-business-language.md`
- Next story dependency seam: `docs/developer/story-handbook/2-4-wizard-readiness-export.md`
- Artifact chain for this epic: authenticated Manager workspace -> assessment creation -> WizardProfile completion -> readiness-only outputs.
- Workflow/state focus: assessment and wizard states from CREATED to WIZARD_PROFILE_READY to READINESS_EXPORT_GENERATED.

### Story-Specific Implementation Tasks

- Project readiness-only overview when WizardProfile exists but technical evidence does not.
- Lock classification with neutral status and missing-evidence checklist.
- Project explicit unknown-state and unresolved business/legal context in readiness messaging from `WIZARD-MAPPING.md` without implying final legal consequence.
- Audit transition when evidence later becomes available without mutating original WizardProfile version.

### Task to Acceptance Criteria Traceability

- `AC1`: Project readiness-only overview when WizardProfile exists but technical evidence does not.
- `AC1`: Lock classification with neutral status and missing-evidence checklist.
- `AC1`: Project explicit unknown-state and unresolved business/legal context in readiness messaging from `WIZARD-MAPPING.md` without implying final legal consequence.
- `AC2`: Audit transition when evidence later becomes available without mutating original WizardProfile version.

### Dependencies and Prerequisites

- Story 2.2 submitted WizardProfile.
- State labels from readiness authority.
- Wizard Epic 2 UX package: `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/EXPERIENCE.md`
- Wizard readiness projection contract: `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/WIZARD-MAPPING.md`

### Explicit Non-Goals

- No HIGH/MEDIUM/LOW or legal/non-compliance wording.
- No fake classification placeholder.
- No mutation of original WizardProfile submission.
- No final obligation mapping or legal article recommendation in this story; chỉ readiness semantics và next-step routing.

### Story-Specific Risks and Edge Cases

- UI implies final risk before evidence exists.
- Classification endpoint accidentally unlocked.
- Evidence arrival overwrites historical readiness state without audit.
- Unknown-state answers disappear from readiness panel, làm Manager tưởng đã trả lời đủ.

### Architecture Compliance

- Web owns wizard/readiness UX, nhưng state validation và authorization vẫn thuộc API control plane.
- Assessment aggregate phải giữ owner, organization scope và workflow state rõ ràng cho downstream repository/scan/legal chain.
- Readiness-only outputs không được nhảy cóc sang classification/final-report wording.
- Readiness panel phải đọc được từ Wizard projection + evidence availability projection; không hardcode từ một status string duy nhất nếu làm mất missing-context detail.
- `unresolved_unknown_items` phải được dựng từ mapping contract, không suy luận ad hoc từ text label trên UI.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 2: authenticated Manager workspace -> assessment creation -> WizardProfile completion -> readiness-only outputs.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 2 thường chạm `Assessment`, `WizardProfile`, wizard section drafts, readiness export metadata và UI projection read models.
- Business-language fields phải map được sang downstream technical/legal needs mà không lẫn implementation jargon trên UX.
- Versioning của WizardProfile và export artifact phải tương thích với immutable downstream chain.
- Readiness projection nên lưu riêng missing-evidence items, unresolved-unknown items, next-step CTA set, và classification lock reason để export/story 2.4 tiêu thụ sạch.
- Ít nhất các unknown critical fields của mapping contract phải projection được thành item riêng, không gộp vào một message tổng quát kiểu "cần thêm thông tin".

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
- Dùng phrasing kiểu `Cần thêm bằng chứng`, `Cần xác minh thông tin`, `Chưa đủ cơ sở`; tránh mọi wording khiến user hiểu đây là kết quả phân loại pháp lý.
- Nếu mapping contract đổi danh sách unknown-material fields, readiness projection phải bám contract mới thay vì hardcoded UI copy.

### Testing Requirements

- Assessment create/update/state-transition API tests.
- Wizard validation, draft/save/submit negative-path coverage.
- Readiness-only export/content guard tests và Manager-facing UX blocked states.
- Readiness panel tests cho:
  - không show risk badge
  - show unknown-state carry-over
  - classification CTA bị khóa đúng neutral reason
  - evidence đến sau không mutate WizardProfile version cũ

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
