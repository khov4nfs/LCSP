# Story 2.1: Create Manager-Owned Assessment

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, I want to create an assessment in my organization workspace, so that I can start an evidence-based LCSP workflow for one AI-enabled system.

## Acceptance Criteria

1. **Given** an authenticated Manager has RBAC permission to create assessments
   **When** the Manager enters basic assessment identity and context
   **Then** LCSP creates a Manager-owned assessment in the active organization
   **And** the assessment starts in a pre-Wizard state or `WIZARD_IN_PROGRESS`
   **And** the assessment records owner, organization, creation timestamp, and audit event
   **And** no Developer is required to create or continue the assessment.

2. **Given** the Manager lacks permission or workspace scope is missing
   **When** the Manager attempts to create an assessment
   **Then** LCSP denies the action with a safe explanation
   **And** no assessment is created
   **And** the denial is audited.

## Tasks / Subtasks

- [x] Create assessment aggregate with Manager ownership, organization scope and initial workflow state. (AC: 1)
- [x] Add create-assessment UI/API path with RBAC gating and safe denial handling. (AC: 2)
- [x] Scaffold Wizard entry surfaces from assessment overview, including Wizard landing and initial section-progress projection. (AC: 1)
- [x] Emit audit event and neutral readiness/Wizard entry projection after creation without implying any legal/risk result. (AC: 1, AC: 2)

### Review Findings

- [x] [Review][Patch] Fix description maxLength attribute mismatch (change 2000 to 1000) [apps/web/src/features/workspace/components/organisms/create-assessment-form.tsx:97]
- [x] [Review][Patch] Add typeof string guard in assertValid for CreateAssessmentCommand [apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts:146]

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `2-1-create-manager-owned-assessment`
- Official execution artifact: `docs/implementation-artifacts/2-1-create-manager-owned-assessment.md`
- Epic: `Epic 2 - Manager Assessment and Wizard Readiness`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 2 là Manager golden path đầu tiên sau auth foundation. Nếu UX/business-language sai ở đây, downstream technical/legal chains sẽ khó sử dụng.
- Story trong epic này phải ưu tiên assessment ownership, wizard completeness và readiness-only behavior trước risk/classification.
- Developer vẫn là optional collaborator; Manager phải tự hoàn tất flow chính mà không phụ thuộc Developer assignment.

- Previous story context: none; đây là story mở đầu chuỗi của epic hoặc một entry boundary mới.
- Next story dependency seam: `docs/developer/story-handbook/2-2-complete-wizardprofile-in-business-language.md`
- Artifact chain for this epic: authenticated Manager workspace -> assessment creation -> WizardProfile completion -> readiness-only outputs.
- Workflow/state focus: assessment and wizard states from CREATED to WIZARD_PROFILE_READY to READINESS_EXPORT_GENERATED.

### Story-Specific Implementation Tasks

- Create assessment aggregate with Manager ownership, organization scope and initial workflow state.
- Add create-assessment UI/API path with RBAC gating and safe denial handling.
- Scaffold Wizard entry surfaces from assessment overview, including Wizard landing and initial section-progress projection.
- Emit audit event and neutral readiness/Wizard entry projection after creation without implying any legal/risk result.

### Task to Acceptance Criteria Traceability

- `AC1`: Create assessment aggregate with Manager ownership, organization scope and initial workflow state.
- `AC2`: Add create-assessment UI/API path with RBAC gating and safe denial handling.
- `AC1`: Scaffold Wizard entry surfaces from assessment overview, including Wizard landing and initial section-progress projection.
- `AC1`, `AC2`: Emit audit event and neutral readiness/Wizard entry projection after creation without implying any legal/risk result.

### Dependencies and Prerequisites

- Epic 1 workspace/RBAC foundation.
- Assessment state model from readiness authority.
- Wizard Epic 2 UX package: `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/EXPERIENCE.md`

### Explicit Non-Goals

- No Developer required to create or continue assessment.
- No repository connection or scan trigger.
- No risk/classification output.
- No pre-screen questionnaire execution in this story; chỉ scaffold entry và initial state.

### Story-Specific Risks and Edge Cases

- Assessment created without org scope.
- Manager denied path leaks internal policy details.
- Initial state not aligned with wizard flow.
- Assessment overview jumps thẳng vào detailed intake mà bỏ qua Wizard landing / phase framing.

### Architecture Compliance

- Web owns wizard/readiness UX, nhưng state validation và authorization vẫn thuộc API control plane.
- Assessment aggregate phải giữ owner, organization scope và workflow state rõ ràng cho downstream repository/scan/legal chain.
- Readiness-only outputs không được nhảy cóc sang classification/final-report wording.
- Wizard entry projection phải tách rõ `chưa bắt đầu`, `đang khai báo`, và `readiness-only`; không collapse thành một status mơ hồ.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior of story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 2: authenticated Manager workspace -> assessment creation -> WizardProfile completion -> readiness-only outputs.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 2 thường chạm `Assessment`, `WizardProfile`, wizard section drafts, readiness export metadata và UI projection read models.
- Business-language fields phải map được sang downstream technical/legal needs mà không lẫn implementation jargon trên UX.
- Versioning của WizardProfile và export artifact phải tương thích với immutable downstream chain.
- Story này tối thiểu phải chuẩn bị projection cho `wizard_phase`, `wizard_started_at`, `wizard_last_resumed_at`, hoặc equivalent neutral fields để UX 2 tầng hoạt động sạch ở story sau.

### State and Audit Requirements

- Transition authority trọng tâm là `CREATED`, `WIZARD_IN_PROGRESS`, `WIZARD_PROFILE_READY`, `READINESS_EXPORT_GENERATED`.
- Assessment create, wizard save/submit, readiness export request đều phải audited với correlation ID.
- Nếu chưa có accepted evidence hoặc final basis, UI class phải giữ `READINESS_ONLY` thay vị ám chỉ final legal/risk result.
- Assessment creation nên đẩy aggregate vào `CREATED` hoặc `WIZARD_IN_PROGRESS` theo authority cụ thể, nhưng UX phải vẫn hiển thị pha `Wizard chưa bắt đầu` nếu chưa qua Wizard landing.

### File Structure Notes

- `apps/web` cho assessment dashboard, wizard screens, readiness-only status và export entry points.
- `apps/api` cho assessment/wizard DTOs, state guards, RBAC checks và audit emission.
- `packages/*` cho section schema, validation contract và export/read-model types.

### Implementation Guidance for the Dev Agent

- Ưu tiên business-language và actionable next step cho Manager; không đẩy scanner/legal vocabulary vào bước wizard sớm.
- Readiness output là first-class artifact riêng; không chèn risk level hoặc legal certainty nếu story chưa mở gate đó.
- Mọi state-changing endpoint phải recheck assessment ownership, org scope và workflow guard ở service layer.
- Dùng story này để khóa seam vào Wizard package mới: assessment overview phải có CTA vào `Wizard landing`, không nhảy thẳng sang section form nếu chưa có draft.

### Testing Requirements

- Assessment create/update/state-transition API tests.
- Wizard validation, draft/save/submit negative-path coverage.
- Readiness-only export/content guard tests và Manager-facing UX blocked states.
- UI tests cho assessment vừa tạo: thấy Wizard landing CTA, chưa thấy risk/result badge, và không mở downstream surfaces ngoài scope.

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
- [Source: docs/implementation/backend-implementation.md]
- [Source: docs/implementation/readiness/state-transition-authority.md]

## Dev Agent Record

### Agent Model Used

Gemini 3.6 Flash (Medium)

### Debug Log References

- Verified Prisma Client generation and module resolution across `@lcsp/api` and `@lcsp/web`.
- Ran unit tests for Assessment domain entity, command handlers, query handlers, and web components.
- Ran e2e test suite (`assessment-create.e2e-spec.ts`) and web test suite (`pnpm test:web`).
- Verified static analysis (`pnpm lint`) and contract checks (`check:contracts`, `check:imports`).

### Completion Notes List

- Verified Manager-owned assessment creation aggregate in domain layer (`Assessment.create`), initializing with `WIZARD_IN_PROGRESS` status, owner ID, and organization ID.
- Verified RBAC gating and safe denial handling in API controller and command handler (`CreateAssessmentHandler`), with `ASSESSMENT_CREATED` audit event and outbox emission.
- Verified Manager UI creation page and overview components, ensuring Wizard landing CTA and section progress projection are present without requiring Developer involvement or implying legal/risk results.
- Validated 100% test pass rate across all unit, e2e, and contract checks.

### File List

- apps/api/src/modules/assessment/domain/entities/assessment.entity.ts
- apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts
- apps/api/src/modules/assessment/presentation/http/assessment.controller.ts
- apps/api/test/assessment-create.e2e-spec.ts
- apps/web/src/app/(workspace)/assessments/new/page.tsx
- apps/web/src/features/workspace/components/organisms/create-assessment-form.tsx
- apps/web/src/features/workspace/components/organisms/assessment-overview.tsx
- apps/web/src/app/(workspace)/assessments/[id]/page.tsx
- docs/implementation-artifacts/2-1-create-manager-owned-assessment.md

## Change Log

- 2026-07-30: Verified complete implementation and test coverage for Story 2.1; marked all tasks complete and updated status to `review`.
- 2026-07-30: Completed adversarial code review (`bmad-code-review`); resolved 2 patch findings (frontend description maxLength sync & backend payload type guards). Status set to `done`.


