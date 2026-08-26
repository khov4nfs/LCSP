# Story 5.3 Developer Packet

Status: ready-for-dev

## Story

As a Manager, I want to resolve material conflicts with guided choices and evidence context, so that LCSP can produce a coherent verified assessment profile.

## Acceptance Criteria

1. **Given** unresolved material conflicts exist
   **When** Manager opens a conflict task
   **Then** LCSP shows available resolution choices, source refs, confidence, explanation, and downstream impact
   **And** Manager can choose, correct, or mark unknown according to allowed resolution rules.

2. **Given** Manager submits a resolution
   **When** LCSP validates the decision
   **Then** LCSP records selected value, rationale, actor, timestamp, policy decision, source refs, and conflict version
   **And** unresolved required conflicts continue blocking VerifiedProfile creation.

3. **Given** evidence, profile, AIUsageFlow, or reconciliation version changed after Manager opened a conflict task
   **When** Manager submits a resolution based on the stale version
   **Then** LCSP rejects the submission or requires refresh
   **And** no stale resolution is applied to the current reconciliation version.

4. **Given** a resolution attempts to overwrite scanner evidence or hide material uncertainty
   **When** LCSP validates the decision
   **Then** LCSP blocks or records it as Manager interpretation only
   **And** immutable evidence remains unchanged.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `5-3-manager-conflict-resolution`
- Official execution artifact: `docs/implementation-artifacts/5-3-manager-conflict-resolution.md`
- Epic: `Epic 5 - Reconciliation and VerifiedProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 5 là gate quyết định facts nào được hợp thức hóa cho legal matching. Đây là nơi sai một lần sẽ làm classification dùng dữ liệu disputed.
- Story trong epic này phải giữ conflict detection, score explanation, Manager-only resolution và immutable history cùng lúc.
- VerifiedProfile là output duy nhất được phép đi tiếp sang legal matching; không có shortcut từ AIUsageFlow.

- Previous story context: `docs/developer/story-handbook/5-2-explain-conflict-score-and-evidence-basis.md`
- Next story dependency seam: `docs/developer/story-handbook/5-4-preserve-scanner-evidence-during-resolution.md`
- Artifact chain for this epic: AIUsageFlow + WizardProfile + TechnicalProfile comparison -> conflict resolution -> VerifiedProfile.
- Workflow/state focus: AI_USAGE_FLOW_READY -> RECONCILIATION_REQUIRED / VERIFIED_PROFILE_READY / VERIFIED_PROFILE_APPROVED / VERIFIED_PROFILE_STALE.

### Story-Specific Implementation Tasks

- Provide guided resolution choices, rationale capture and downstream impact preview for each conflict.
- Validate stale-version submissions and reject refresh-required decisions.
- Persist Manager interpretation as separate reconciliation decision without overwriting evidence.

### Task to Acceptance Criteria Traceability

- `AC1`: Provide guided resolution choices, rationale capture and downstream impact preview for each conflict.
- `AC2`: Validate stale-version submissions and reject refresh-required decisions.
- `AC3`: Persist Manager interpretation as separate reconciliation decision without overwriting evidence.

### Dependencies and Prerequisites

- Story 5.2 explained conflict view.
- RBAC Manager-only enforcement and version-safe reconciliation contract.

### Explicit Non-Goals

- No Developer finalization of Manager conflict tasks.
- No overwriting scanner evidence.
- No accepting stale resolution against newer versions.

### Story-Specific Risks and Edge Cases

- Manager resolution applied to stale reconciliation version.
- Resolution hides uncertainty instead of capturing it.
- Downstream blocks lifted while required conflicts remain unresolved.

### Architecture Compliance

- Reconciliation logic thuộc Python Worker Platform, nhưng Manager resolution surfaces và approval endpoints vẫn cần RBAC/state enforcement ở API.
- Upstream artifacts `WizardProfile`, `TechnicalProfile`, `AIUsageFlow` là immutable inputs; worker chỉ tạo conflict/verified outputs mới.
- Manager-only actions phải được bảo vệ bằng RBAC subject/resource/action/context + version-safe checks.

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
