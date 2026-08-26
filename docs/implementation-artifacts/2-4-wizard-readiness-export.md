---
baseline_commit: a56969fdf6ea7616b8f12fcad37d32659549e15f
---

# Story 2.4: Wizard Readiness Export

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

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

## Tasks / Subtasks

- [x] Create readiness-only export generation path from wizard/assessment entry points. (AC: 1)
- [x] Apply output guardrails to title, metadata, artifact history and file content. (AC: 2)
- [x] Persist versioned export artifact with owner, assessment ID, timestamp and audit event. (AC: 1)
- [x] Ensure readiness export template mirrors Wizard package semantics and `WIZARD-MAPPING.md`: readiness-only badge, missing-evidence checklist, unresolved unknowns, and next-step CTA set.

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

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/2-4-wizard-readiness-export.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.
- Captured baseline commit `a56969fdf6ea7616b8f12fcad37d32659549e15f` before implementation.
- Added failing e2e coverage for readiness export generation, blocked preconditions, RBAC denial, and immutable versioning before implementation.
- Validation passed: focused guardrail unit, focused readiness export e2e, full API unit, full API e2e, root lint/typecheck contract checks, web tests, API build, and `git diff --check`.
- PDF follow-up validation: `git diff --check` and contract value-set scan passed; automated test/typecheck could not run because `pnpm` attempted to recreate `node_modules` and registry access was unavailable in the sandbox.
- Completion re-audit on 2026-08-05 found and closed the missing Manager-facing web entry point, authenticated BFF PDF proxy, canonical export metadata, safe blocked-response contract, and misleading unlocked-readiness copy.
- Re-audit validation passed: API unit `430 passed` (`1 todo`), focused Wizard/PDF unit `15 passed`, web `87 passed`, TypeScript project build, API ESLint (0 errors), API build, and `git diff --check`.
- Environment-limited validation: focused API e2e could not start because Docker Desktop/Postgres was unavailable; web production build reached compilation but Google Fonts fetch was blocked by restricted network access. Root contract check remains blocked by pre-existing raw constants in `mock-evidence.handler.ts` and `github-app-start.e2e-spec.ts` outside Story 2.4.
- Template-alignment follow-up used `Copy of LCSP_Wizard_Export_Template_Legal_Business.docx` as the structural reference and passed the focused PDF renderer test with Watchman disabled for the sandbox.
- Fixed the PDF demo validator and download e2e expectations to use the template-aligned section names; focused demo assertions now pass.
- The real Docker-backed demo remains environment-blocked when the Docker socket is inaccessible (`permission denied` for `~/.docker/run/docker.sock`).

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.
- Implemented `POST /assessments/:assessmentId/wizard/readiness-export` with Manager RBAC, ownership/org checks, submitted-wizard gate, and missing-technical-evidence lock gate.
- Added readiness-only export contracts, guardrail service, append-only persistence, versioning, and safe audit events for generated/blocked export outcomes.
- Export content now carries readiness-only labels, missing evidence checklist, unresolved unknown items, preparation guidance, version, timestamp, owner, assessment ID, and wizard profile version without final risk/classification/legal conclusion wording.
- Updated RBAC/action and wizard event contracts so Manager policy and existing auth/readiness tests include the new export action and event types.
- Added versioned PDF download metadata and a protected download endpoint that renders the persisted readiness snapshot as `application/pdf` without adding a runtime dependency.
- Refined the dependency-free PDF into an institutional readiness brief with a clear metadata grid, printable section cards, page continuation, and readiness-only guardrail copy.
- Added a Docker-backed demo command that exercises real sign-in, generation, binary download, and PDF-content validation before writing `output/readiness-export-demo.pdf`.
- Added e2e assertions for PDF headers, filename, PDF signature, readiness-only sections, and prohibited wording.
- Added the readiness-page PDF action, web API generation route, and authenticated binary download proxy so a Manager can complete the real browser flow without exposing the bearer token.
- Aligned persisted/exported metadata with `WIZARD-MAPPING.md`: artifact type, readiness-only flag, locked-evidence classification status, Wizard profile version, assessment, generator, timestamp, and version.
- Blocked guardrail results no longer expose unsafe content or advertise a download URL, and the readiness page no longer displays readiness-only copy after technical evidence unlocks the next gate.
- Aligned the generated PDF with the supplied legal/business template: numbered sections 1-8, profile identification, preliminary screening, business context, data subjects, oversight, provider scope, review indicators, consolidated record status/actions, and an export-time declaration while preserving readiness-only guardrails.
- Removed the dark institutional card format and rebuilt the PDF as the supplied DOCX-style administrative form with A4 margins, Times fonts, bordered tables, vector checkboxes, section 1-9 hierarchy, signature placeholders, and `Page N / total` footers.
- Closed the DOCX review findings: checkbox state now follows `answer_state`, arrays and additional fields remain visible, long rows paginate safely, Unicode survives export, and demo validation rejects malformed PDFs.
- Final validation passed: API unit `432 passed` (`1 todo`), focused PDF `3 passed`, API ESLint, TypeScript project build, contract value-set scan, and `git diff --check`; Docker-backed demo remains sandbox-blocked by Docker socket permissions.

### File List

- apps/api/prisma/migrations/20260726014847_add_readiness_export/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/scripts/demo-readiness-export-pdf.ts
- apps/api/scripts/readiness-export-pdf-demo.helpers.ts
- apps/api/src/modules/document/application/commands/process-document-callback/process-document-callback.handler.spec.ts
- apps/api/src/modules/wizard/application/commands/generate-readiness-export/generate-readiness-export.command.ts
- apps/api/src/modules/wizard/application/commands/generate-readiness-export/generate-readiness-export.handler.ts
- apps/api/src/modules/wizard/application/contracts/wizard/readiness-export.contract.ts
- apps/api/src/modules/wizard/application/queries/get-readiness/get-readiness.handler.spec.ts
- apps/api/src/modules/wizard/application/queries/get-readiness/get-readiness.handler.ts
- apps/api/src/modules/wizard/application/queries/download-readiness-export/download-readiness-export.handler.ts
- apps/api/src/modules/wizard/application/queries/download-readiness-export/download-readiness-export.query.ts
- apps/api/src/modules/wizard/application/services/wizard/readiness-evaluator.service.spec.ts
- apps/api/src/modules/wizard/application/services/wizard/readiness-evaluator.service.ts
- apps/api/src/modules/wizard/application/services/wizard/readiness-export-guardrail.service.spec.ts
- apps/api/src/modules/wizard/application/services/wizard/readiness-export-guardrail.service.ts
- apps/api/src/modules/wizard/application/services/wizard/readiness-export-pdf.service.ts
- apps/api/src/modules/wizard/application/services/wizard/readiness-export-pdf.service.spec.ts
- apps/api/src/modules/wizard/domain/entities/readiness-export.entity.ts
- apps/api/src/modules/wizard/domain/exceptions/wizard.exceptions.ts
- apps/api/src/modules/wizard/presentation/http/wizard.controller.ts
- apps/api/src/modules/wizard/wizard.module.ts
- apps/api/test/auth-workspace.e2e-spec.ts
- apps/api/test/document-gap-analysis.e2e-spec.ts
- apps/api/test/readiness-export-pdf-demo.spec.ts
- apps/api/test/support/auth-workspace-test-helpers.ts
- apps/api/test/wizard-endpoints.e2e-spec.ts
- apps/api/test/wizard-readiness-export.e2e-spec.ts
- apps/web/src/features/document/components/organisms/document-request-panel.tsx
- apps/web/src/app/api/assessments/[id]/wizard/readiness-export/route.ts
- apps/web/src/app/api/assessments/[id]/wizard/readiness-exports/[exportId]/download/route.ts
- apps/web/src/features/readiness/components/organisms/readiness-status-page.tsx
- apps/web/src/lib/api/assessment-queries.ts
- apps/web/src/lib/api/readiness-client.ts
- apps/web/src/lib/server/upstream-request.ts
- apps/web/src/public/assets/mocks/readiness.json
- apps/web/tests/readiness-client.test.ts
- docs/implementation-artifacts/2-4-wizard-readiness-export.md
- docs/implementation-artifacts/sprint-status.yaml
- packages/contracts/src/rbac/actions.ts
- packages/contracts/src/rbac/manager-policy.ts
- packages/contracts/src/wizard/events.ts
- packages/i18n/src/locales/en/pages.ts
- packages/i18n/src/locales/vi/pages.ts
- packages/i18n/src/types.ts
- tests/story-1-6.web.test.ts

### Change Log

- 2026-07-26: Implemented Wizard Readiness Export API slice with readiness-only contracts, guardrails, persistence, audit events, RBAC wiring, and focused/full validation coverage.
- 2026-08-04: Added immutable Wizard Readiness Export PDF download generation and e2e coverage.
- 2026-08-05: Closed Story 2.4 browser-flow and guardrail completion gaps; added BFF generation/download routes, readiness-page PDF action, canonical metadata, safe blocked responses, and expanded validation.
- 2026-08-05: Refined the generated PDF into an institutional readiness brief and added a real API-to-PDF demo command with focused content checks.
- 2026-08-05: Aligned the readiness PDF structure and section hierarchy with the supplied Legal/Business DOCX template without importing prohibited classification or legal-outcome semantics.
- 2026-08-05: Replaced the prior card-based PDF renderer with an A4 administrative form modeled on `output/readiness_template.docx`, including Times typography, form tables, checkbox marks, approval cells, repeated headers, and page footers.
- 2026-08-05: Remediated blind/edge review findings for checkbox semantics, snapshot fidelity, additional answers, Unicode, pagination, PDF structure validation, and reproducible focused tests.
