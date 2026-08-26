# Story 2.2: Complete WizardProfile in Business Language

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, I want to answer WizardProfile questions in business/legal language, so that LCSP captures assessment facts without requiring source-code expertise.

## Acceptance Criteria

1. **Given** a Manager-owned assessment exists
   **When** the Manager goes through a two-phase Wizard with `pre-screen` followed by `business/legal structured intake`
   **Then** LCSP saves a WizardProfile version linked to the assessment
   **And** the pre-screen phase captures scoping signals for prohibited/high-impact/transparency-relevant patterns without presenting a final legal conclusion
   **And** the detailed phase captures purpose, sector, data type, user group, user impact, decision role, human oversight, external LLM usage, and biometric/high-impact indicators
   **And** each critical answer maps to a structured WizardProfile field
   **And** questions avoid unexplained code-centric terms
   **And** complex questions include examples or progressive disclosure.

2. **Given** required critical fields are missing or invalid
   **When** the Manager attempts to submit the WizardProfile
   **Then** LCSP blocks submission with business-language validation messages
   **And** no risk/severity/non-compliant wording is shown
   **And** draft state is preserved where safe
   **And** explicit `unknown / chưa rõ` answers are preserved as structured gap states where policy allows.

## Tasks / Subtasks

- [ ] Implement the two-phase Wizard flow: `pre-screen` followed by detailed sectioned intake. (AC: 1)
- [ ] Implement the wizard question registry and structured field mapping from `WIZARD-MAPPING.md` for all critical facts. (AC: 1)
- [ ] Persist versioned WizardProfile drafts/submissions with business-language validation and explicit unknown-state support.
- [ ] Add progressive disclosure/examples and helper-drawer hooks while keeping code-centric terms out of Manager UX.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `2-2-complete-wizardprofile-in-business-language`
- Official execution artifact: `docs/implementation-artifacts/2-2-complete-wizardprofile-in-business-language.md`
- Epic: `Epic 2 - Manager Assessment and Wizard Readiness`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 2 là Manager golden path đầu tiên sau auth foundation. Nếu UX/business-language sai ở đây, downstream technical/legal chains sẽ khó sử dụng.
- Story trong epic này phải ưu tiên assessment ownership, wizard completeness và readiness-only behavior trước risk/classification.
- Developer vẫn là optional collaborator; Manager phải tự hoàn tất flow chính mà không phụ thuộc Developer assignment.

- Previous story context: `docs/developer/story-handbook/2-1-create-manager-owned-assessment.md`
- Next story dependency seam: `docs/developer/story-handbook/2-3-wizard-only-readiness-without-risk-level.md`
- Artifact chain for this epic: authenticated Manager workspace -> assessment creation -> WizardProfile completion -> readiness-only outputs.
- Workflow/state focus: assessment and wizard states from CREATED to WIZARD_PROFILE_READY to READINESS_EXPORT_GENERATED.

### Story-Specific Implementation Tasks

- Implement the two-phase Wizard flow: `pre-screen` followed by detailed sectioned intake.
- Implement the wizard question registry and structured field mapping from `WIZARD-MAPPING.md` for all critical facts.
- Persist versioned WizardProfile drafts/submissions with business-language validation and explicit unknown-state support.
- Add progressive disclosure/examples and helper-drawer hooks while keeping code-centric terms out of Manager UX.

### Task to Acceptance Criteria Traceability

- `AC1`: Implement the two-phase Wizard flow: `pre-screen` followed by detailed sectioned intake.
- `AC1`: Implement the wizard question registry and structured field mapping from `WIZARD-MAPPING.md` for required critical facts.
- `AC1`, `AC2`: Persist versioned WizardProfile drafts/submissions with business-language validation and explicit unknown-state support.
- `AC1`, `AC2`: Add progressive disclosure/examples and helper-drawer hooks while keeping code-centric terms out of Manager UX.

### Dependencies and Prerequisites

- Story 2.1 assessment ownership and initial state.
- Structured WizardProfile schema in shared contracts.
- Wizard Epic 2 UX package:
  - `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/EXPERIENCE.md`
  - `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/DESIGN.md`
  - `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/WIZARD-MAPPING.md`

### Explicit Non-Goals

- No technical evidence or scanner interpretation in wizard answers.
- No final risk/severity wording.
- No mutation of historical WizardProfile versions on later steps.
- No readiness result rendering beyond the minimal submit handoff seam; readiness semantics belong primarily to Story 2.3.

### Story-Specific Risks and Edge Cases

- Question wording leaks implementation jargon.
- Missing critical fields still accepted as submitted.
- Draft preservation lost on validation failure.
- Pre-screen and detailed intake collapse into one flat form, making the UX diverge from the approved Epic 2 package.
- `unknown` answers are treated as blanks and lost instead of stored as explicit unresolved business/legal context.

### Architecture Compliance

- Web owns wizard/readiness UX, nhưng state validation và authorization vẫn thuộc API control plane.
- Assessment aggregate phải giữ owner, organization scope và workflow state rõ ràng cho downstream repository/scan/legal chain.
- Readiness-only outputs không được nhảy cóc sang classification/final-report wording.
- `WIZARD-MAPPING.md` là contract chuẩn nối `question_id -> WizardProfile field -> downstream uses`; implementation không nên tự phát minh field names khác nếu chưa cập nhật artifact này.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 2: authenticated Manager workspace -> assessment creation -> WizardProfile completion -> readiness-only outputs.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 2 thường chạm `Assessment`, `WizardProfile`, wizard section drafts, readiness export metadata và UI projection read models.
- Business-language fields phải map được sang downstream technical/legal needs mà không lẫn implementation jargon trên UX.
- Versioning của WizardProfile và export artifact phải tương thích với immutable downstream chain.
- Pre-screen signals phải được lưu đủ sạch để phục vụ section branching, readiness messaging, hoặc downstream route hints mà không bị nhầm thành final legal classification data.
- Draft persistence nên hỗ trợ theo section/phase thay vì chỉ save nguyên form blob.
- `decisionRole` là field neo và không nên được model như optional free text; packet mapping đã coi đây là submit blocker field.

### State and Audit Requirements

- Transition authority trọng tâm là `CREATED`, `WIZARD_IN_PROGRESS`, `WIZARD_PROFILE_READY`, `READINESS_EXPORT_GENERATED`.
- Assessment create, wizard save/submit, readiness export request đều phải audited với correlation ID.
- Nếu chưa có accepted evidence hoặc final basis, UI class phải giữ `READINESS_ONLY` thay vì ám chỉ final legal/risk result.
- Wizard interaction states tối thiểu nên phân biệt: `pre_screen_in_progress`, `detailed_intake_in_progress`, `submitted_with_unknowns` hoặc equivalent projection states cho UX/debug/audit.

### File Structure Notes

- `apps/web` cho assessment dashboard, wizard screens, readiness-only status và export entry points.
- `apps/api` cho assessment/wizard DTOs, state guards, RBAC checks và audit emission.
- `packages/*` cho section schema, validation contract và export/read-model types.

### Implementation Guidance for the Dev Agent

- Ưu tiên business-language và actionable next step cho Manager; không đẩy scanner/legal vocabulary vào bước wizard sớm.
- Readiness output là first-class artifact riêng; không chèn risk level hoặc legal certainty nếu story chưa mở gate đó.
- Mọi state-changing endpoint phải recheck assessment ownership, org scope và workflow guard ở service layer.
- Freeze `canonical core` trước; đừng cố thêm sector overlays đầy đủ ở story này ngoài 3 scenario test seams: public chatbot, HR screening, credit/eligibility decision support.
- Mọi question critical phải có option/help path cho `Tôi chưa rõ` nếu authority cho phép; UX package mới đã xem đây là first-class behavior, không phải edge-case.
- Khi implementation DTO/API được tạo, ưu tiên stable `questionId` + `answerState` shape tương thích với `WIZARD-MAPPING.md`; đừng encode `unknown` bằng `null`.

### Testing Requirements

- Assessment create/update/state-transition API tests.
- Wizard validation, draft/save/submit negative-path coverage.
- Readiness-only export/content guard tests và Manager-facing UX blocked states.
- UI tests cho:
  - chuyển pha `pre-screen -> detailed intake`
  - helper drawer mở/đóng không mất draft
  - explicit unknown-state được lưu và hiển thị lại đúng
  - question copy không lộ jargon kỹ thuật ở main path

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

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/2-2-complete-wizardprofile-in-business-language.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/2-2-complete-wizardprofile-in-business-language.md
