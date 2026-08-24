# Story 5.1: Detect Material Profile Conflicts

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Detect Material Profile Conflicts

## Acceptance Criteria

1. **Given** WizardProfile, TechnicalProfile, and AIUsageFlow versions exist for an assessment
   **When** reconciliation runs
   **Then** LCSP compares material dimensions including AI purpose, input/output categories, affected subjects, decision role, human review, external LLM usage, biometric/high-impact indicators, and technical evidence confidence
   **And** records conflict candidates or no-conflict decisions with source refs and version IDs.

2. **Given** a material dimension is missing from one source
   **When** reconciliation evaluates the dimension
   **Then** LCSP records missing evidence or unknown state
   **And** does not infer the missing value as agreed.

3. **Given** a conflict is below materiality threshold or explained by known coverage limitation
   **When** reconciliation evaluates it
   **Then** LCSP records the reason
   **And** avoids creating unnecessary Manager conflict tasks.

## Tasks / Subtasks

- [ ] Compare WizardProfile, TechnicalProfile and AIUsageFlow across material dimensions. (AC: 1)
- [ ] Record conflict candidates, no-conflict decisions and missing/unknown states with version refs. (AC: 2)
- [ ] Apply materiality threshold and known coverage limitation rules before creating review work. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `5-1-detect-material-profile-conflicts`
- Official execution artifact: `docs/implementation-artifacts/5-1-detect-material-profile-conflicts.md`
- Epic: `Epic 5 - Reconciliation and VerifiedProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 5 là gate quyết định facts nào được hợp thức hóa cho legal matching. Đây là nơi sai một lần sẽ làm classification dùng dữ liệu disputed.
- Story trong epic này phải giữ conflict detection, score explanation, Manager-only resolution và immutable history cùng lúc.
- VerifiedProfile là output duy nhất được phép đi tiếp sang legal matching; không có shortcut từ AIUsageFlow.

- Previous story context: none; đây là story mở đầu chuỗi của epic hoặc một entry boundary mới.
- Next story dependency seam: `docs/developer/story-handbook/5-2-explain-conflict-score-and-evidence-basis.md`
- Artifact chain for this epic: AIUsageFlow + WizardProfile + TechnicalProfile comparison -> conflict resolution -> VerifiedProfile.
- Workflow/state focus: AI_USAGE_FLOW_READY -> RECONCILIATION_REQUIRED / VERIFIED_PROFILE_READY / VERIFIED_PROFILE_APPROVED / VERIFIED_PROFILE_STALE.

### Story-Specific Implementation Tasks

- Compare WizardProfile, TechnicalProfile and AIUsageFlow across material dimensions.
- Record conflict candidates, no-conflict decisions and missing/unknown states with version refs.
- Apply materiality threshold and known coverage limitation rules before creating review work.

### Task to Acceptance Criteria Traceability

- `AC1`: Compare WizardProfile, TechnicalProfile and AIUsageFlow across material dimensions.
- `AC2`: Record conflict candidates, no-conflict decisions and missing/unknown states with version refs.
- `AC3`: Apply materiality threshold and known coverage limitation rules before creating review work.

### Dependencies and Prerequisites

- Epic 2 WizardProfile, Epic 3 TechnicalProfile, Epic 4 AIUsageFlow.
- Reconciliation worker foundation from `MW-intel-004`.

### Explicit Non-Goals

- No inference of agreement from missing value.
- No automatic conflict resolution.
- No classification use before reconciliation completes.

### Story-Specific Risks and Edge Cases

- Material conflict missed due to weak threshold logic.
- Low-signal disagreement floods Manager queue.
- Missing version refs make conflict unreproducible.

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

- `deepagents` cho reconciliation worker, score calculation, VerifiedProfile generation.
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
- Source packet: `docs/developer/story-handbook/5-1-detect-material-profile-conflicts.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/5-1-detect-material-profile-conflicts.md
