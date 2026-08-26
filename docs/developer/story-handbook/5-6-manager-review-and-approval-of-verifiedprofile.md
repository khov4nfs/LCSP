# Story 5.6 Developer Packet

Status: ready-for-dev

## Story

As a Manager, I want to review and approve VerifiedProfile before downstream classification, so that I remain accountable for final assessment facts.

## Acceptance Criteria

1. **Given** VerifiedProfile is generated
   **When** Manager opens the review surface
   **Then** LCSP shows verified facts, source refs, remaining unknowns, confidence, evidence versions, reconciliation decisions, and downstream readiness state
   **And** the review avoids final legal classification wording.

2. **Given** Manager approves VerifiedProfile
   **When** all RBAC and state gates pass
   **Then** LCSP records approval actor, timestamp, policy version, VerifiedProfile version, and audit event
   **And** downstream legal matching can proceed.

3. **Given** Manager rejects or requests revision
   **When** the decision is saved
   **Then** LCSP records the reason and returns the assessment to the appropriate reconciliation or evidence-readiness state
   **And** classification remains blocked until a VerifiedProfile is approved.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `5-6-manager-review-and-approval-of-verifiedprofile`
- Official execution artifact: `docs/implementation-artifacts/5-6-manager-review-and-approval-of-verifiedprofile.md`
- Epic: `Epic 5 - Reconciliation and VerifiedProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 5 là gate quyết định facts nào được hợp thức hóa cho legal matching. Đây là nơi sai một lần sẽ làm classification dùng dữ liệu disputed.
- Story trong epic này phải giữ conflict detection, score explanation, Manager-only resolution và immutable history cùng lúc.
- VerifiedProfile là output duy nhất được phép đi tiếp sang legal matching; không có shortcut từ AIUsageFlow.

- Previous story context: `docs/developer/story-handbook/5-5-create-verifiedprofile-after-gates-pass.md`
- Next story dependency seam: none; story này là tail story hiện tại của epic.
- Artifact chain for this epic: AIUsageFlow + WizardProfile + TechnicalProfile comparison -> conflict resolution -> VerifiedProfile.
- Workflow/state focus: AI_USAGE_FLOW_READY -> RECONCILIATION_REQUIRED / VERIFIED_PROFILE_READY / VERIFIED_PROFILE_APPROVED / VERIFIED_PROFILE_STALE.

### Story-Specific Implementation Tasks

- Build review surface for verified facts, refs, remaining unknowns and readiness state.
- Persist Manager approval/rejection with policy version and audit event.
- Gate downstream legal matching on explicit approval plus current version checks.

### Task to Acceptance Criteria Traceability

- `AC1`: Build review surface for verified facts, refs, remaining unknowns and readiness state.
- `AC2`: Persist Manager approval/rejection with policy version and audit event.
- `AC3`: Gate downstream legal matching on explicit approval plus current version checks.

### Dependencies and Prerequisites

- Story 5.5 VerifiedProfile generation.
- RBAC Manager approval authority.

### Explicit Non-Goals

- No final legal classification wording in review surface.
- No automatic approval on generation.
- No stale approval applied to superseded profile.

### Story-Specific Risks and Edge Cases

- Approved version differs from reviewed version.
- Manager approves profile with unresolved critical unknown.
- Downstream legal matching starts without approval audit.

### Architecture Compliance

- Reconciliation logic thuộc Python Worker Platform, nhưng Manager resolution surfaces và approval endpoints vẫn cần RBAC/state enforcement ở API.
- Upstream artifacts `WizardProfile`, `TechnicalProfile`, `AIUsageFlow` là immutable inputs; worker chỉ tạo conflict/verified outputs mới.
- Manager-only actions phải được bảo vệ bằng RBAC subject/resource/action/context + version-safe checks.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 5: AIUsageFlow + WizardProfile + TechnicalProfile comparison -> conflict resolution -> VerifiedProfile.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.
- Handoff contract cho story này tồn tại trong `docs/planning-artifacts/epics.md` và phải được giữ nguyên khi thiết kế artifact/output boundary.

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
- [Source: Handoff contract embedded in `docs/planning-artifacts/epics.md` for this story]
