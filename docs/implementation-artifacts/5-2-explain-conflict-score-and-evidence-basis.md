---
baseline_commit: c871b095244694d88bd4eb9c8b7f7b19ed83c37d
---

# Story 5.2: Explain Conflict Score and Evidence Basis

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, I want conflict score and conflict explanations, so that I understand which differences require review and why.

## Acceptance Criteria

1. **Given** reconciliation identifies one or more material conflicts
   **When** Manager opens the reconciliation view
   **Then** LCSP shows each conflict with affected field, source values, evidence refs, confidence, materiality reason, and conflict score explanation
   **And** the explanation uses business language rather than scanner-only terminology.

2. **Given** conflict score is shown
   **When** Manager reviews the score
   **Then** LCSP explains that the score prioritizes review effort
   **And** does not present it as legal risk, compliance status, or final classification.

3. **Given** a conflict references technical evidence
   **When** Manager inspects the evidence basis
   **Then** LCSP shows redacted evidence context and coverage limitations
   **And** does not expose raw source, secrets, full prompts, or out-of-scope data.

## Tasks / Subtasks

- [x] Compute conflict score with business-language explanation and evidence/materiality rationale. (AC: 1)
- [x] Expose redacted evidence context and coverage limitations in review view. (AC: 2)
- [x] Persist score explanation separately from legal risk or compliance labels. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `5-2-explain-conflict-score-and-evidence-basis`
- Official execution artifact: `docs/implementation-artifacts/5-2-explain-conflict-score-and-evidence-basis.md`
- Epic: `Epic 5 - Reconciliation and VerifiedProfile`
- Runtime ownership: `apps/api`, `lcsp-python-workers`, `packages/*`

### Current State and Scope Guardrails

- Epic 5 là gate quyết định facts nào được hợp thức hóa cho legal matching. Đây là nơi sai một lần sẽ làm classification dùng dữ liệu disputed.
- Story trong epic này phải giữ conflict detection, score explanation, Manager-only resolution và immutable history cùng lúc.
- VerifiedProfile là output duy nhất được phép đi tiếp sang legal matching; không có shortcut từ AIUsageFlow.

- Previous story context: `docs/developer/story-handbook/5-1-detect-material-profile-conflicts.md`
- Next story dependency seam: `docs/developer/story-handbook/5-3-manager-conflict-resolution.md`
- Artifact chain for this epic: AIUsageFlow + WizardProfile + TechnicalProfile comparison -> conflict resolution -> VerifiedProfile.
- Workflow/state focus: AI_USAGE_FLOW_READY -> RECONCILIATION_REQUIRED / VERIFIED_PROFILE_READY / VERIFIED_PROFILE_APPROVED / VERIFIED_PROFILE_STALE.

### Story-Specific Implementation Tasks

- Compute conflict score with business-language explanation and evidence/materiality rationale.
- Expose redacted evidence context and coverage limitations in review view.
- Persist score explanation separately from legal risk or compliance labels.

### Task to Acceptance Criteria Traceability

- `AC1`: Compute conflict score with business-language explanation and evidence/materiality rationale.
- `AC2`: Expose redacted evidence context and coverage limitations in review view.
- `AC3`: Persist score explanation separately from legal risk or compliance labels.

### Dependencies and Prerequisites

- Story 5.1 conflict candidates and evidence refs.
- Manager review surface expectations.

### Explicit Non-Goals

- No presenting conflict score as legal risk.
- No raw source/full prompts/secrets in evidence drawer.
- No opaque score without field-level explanation.

### Story-Specific Risks and Edge Cases

- Manager misreads prioritization score as final risk.
- Explanation too technical for business users.
- Evidence basis insufficiently redacted.

### Architecture Compliance

- Reconciliation logic thuộc Python Worker Platform, nhưng Manager resolution surfaces và approval endpoints vẫn cần PBAC/state enforcement ở API.
- Upstream artifacts `WizardProfile`, `TechnicalProfile`, `AIUsageFlow` là immutable inputs; worker chỉ tạo conflict/verified outputs mới.
- Manager-only actions phải được bảo vệ bằng PBAC subject/resource/action/context + version-safe checks.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 5: AIUsageFlow + WizardProfile + TechnicalProfile comparison -> conflict resolution -> VerifiedProfile.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 5 thường chạm `ConflictCandidate`, `ConflictResolution`, `VerifiedProfile`, profile versions, approval records và audit events.
- Conflict score/rationale phải trace được về evidence refs và source profile versions để reviewer/Manager hiểu vì sao bị block.
- Scanner evidence, TechnicalProfile và AIUsageFlow refs phải được preserve nguyên vẹn trong output chain.

### State and Audit Requirements

- Unresolved material conflict phải giữ state `RECONCILIATION_REQUIRED` và block classification.
- Manager resolution, VerifiedProfile creation, approval và stale transitions đều phải audit với version/correlation metadata.
- Upstream rerun phải có thể supersede VerifiedProfile cũ mà không mutate lịch sử.

### File Structure Notes

- `lcsp-python-workers` cho reconciliation worker, score calculation, VerifiedProfile generation.
- `apps/api` cho Manager resolution/approval command surface và status projection.
- `packages/*` cho conflict schema, score explanation contract, verified profile DTOs.

### Implementation Guidance for the Dev Agent

- Không để Developer finalize conflict resolution hoặc approval paths vốn Manager-scoped.
- Giải thích conflict score phải bám evidence-basis thật; không trả opaque score mà không có rationale.
- Nếu input version stale, reject rõ ràng và buộc refresh thay vì silently accept resolution.

### Testing Requirements

- Worker tests cho conflict detection/materiality threshold/VerifiedProfile gates.
- API tests cho Manager-only resolution/approval and stale-submission rejection.
- Immutable history, superseded version và audit trace assertions.

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
- [Source: docs/specs/ai-usage-flow-domain-spec.md]
- [Source: docs/specs/domain-state-machines.md]
- [Source: docs/specs/user-task-flows.md]
- [Source: docs/implementation/python-worker-platform-implementation.md]
- [Source: docs/implementation/tasks/modules/python-workers/intelligence/04-verified-profile-worker.md]
- [Source: docs/implementation/handoffs/HANDOFF-ai-usage-flow-and-reconciliation.md]
- [Source: docs/implementation/readiness/state-transition-authority.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/5-2-explain-conflict-score-and-evidence-basis.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.
- Added `ConflictRecord.explanationBasis` persistence so score explanation, materiality rationale, source summaries, confidence, and evidence coverage limits stay separate from legal risk/compliance/classification labels.
- Extended the conflict callback/list contracts and Manager conflict card to surface affected field, source values, evidence refs, redacted evidence context, confidence, materiality reason, and review-priority score copy.
- Added worker, API, web sanitizer, mock, and i18n coverage for the business-language explanation basis.
- Validation passed: `pnpm --filter @lcsp/api build`, `pnpm run test:web`, and `lcsp-python-workers/.venv/bin/python -m pytest lcsp-python-workers/tests/test_conflict_detection_worker.py`.
- Validation blocked by local environment: API e2e could not start because Docker daemon was unavailable; root typecheck is blocked by stale `.next` validator references to `mock-evidence`; `check:contracts` reports unrelated pre-existing literal violations outside this story.

### File List

- docs/implementation-artifacts/5-2-explain-conflict-score-and-evidence-basis.md
- docs/implementation-artifacts/sprint-status.yaml
- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260815090000_add_conflict_explanation_basis/migration.sql
- apps/api/src/modules/reconciliation/application/commands/accept-conflict/accept-conflict.handler.ts
- apps/api/src/modules/reconciliation/application/contracts/reconciliation/conflict-detection-callback.contract.ts
- apps/api/src/modules/reconciliation/application/contracts/reconciliation/conflict-list.contract.ts
- apps/api/src/modules/reconciliation/application/queries/list-conflicts/list-conflicts.handler.ts
- apps/api/test/list-conflicts.e2e-spec.ts
- apps/web/src/features/reconciliation/components/molecules/conflict-card.tsx
- apps/web/src/lib/api/conflict-client.ts
- apps/web/src/public/assets/mocks/conflicts.json
- apps/web/tests/conflict-client.test.ts
- lcsp-python-workers/src/lcsp_workers/intelligence/conflict_detector.py
- lcsp-python-workers/tests/test_conflict_detection_worker.py
- packages/i18n/src/locales/en/pages.ts
- packages/i18n/src/locales/vi/pages.ts
- packages/i18n/src/types.ts

### Change Log

- 2026-08-15: Implemented Story 5.2 conflict score explanation and evidence basis surface; story moved to review.
