# Story 5.5: Create VerifiedProfile After Gates Pass

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Create VerifiedProfile After Gates Pass

## Acceptance Criteria

1. **Given** required WizardProfile, TechnicalProfile, AIUsageFlow, evidence gates, and reconciliation decisions are complete
   **When** VerifiedProfile generation runs
   **Then** LCSP creates a versioned VerifiedProfile with verified assessment facts, source refs, non-critical unresolved unknowns, confidence, gate status, and audit metadata.

2. **Given** required conflicts are unresolved, technical evidence is insufficient, or critical dimensions remain blocked
   **When** VerifiedProfile generation is requested
   **Then** LCSP denies generation with neutral blocker explanation
   **And** legal matching and classification remain unavailable.

3. **Given** a critical dimension remains unknown, unclear, conflict-bearing, or insufficiently evidenced
   **When** VerifiedProfile approval or downstream classification eligibility is evaluated
   **Then** LCSP blocks approval or marks classification ineligible according to gate policy
   **And** does not carry the critical unknown as an approved final fact.

4. **Given** VerifiedProfile exists
   **When** downstream legal matching or classification reads assessment facts
   **Then** LCSP uses VerifiedProfile as the canonical assessment input
   **And** does not read unresolved WizardProfile, TechnicalProfile, or AIUsageFlow values directly as final facts.

## Tasks / Subtasks

- [ ] Check required profile/evidence/reconciliation gates before generating VerifiedProfile.
- [ ] Persist versioned VerifiedProfile with source refs, gate status, confidence and allowed non-critical unknowns.
- [ ] Block generation, approval and downstream eligibility when unresolved conflicts, insufficient evidence or critical unknowns remain.
- [ ] Ensure downstream legal matching and classification consume VerifiedProfile as the only canonical final-fact source.
- [ ] Story-specific subtasks
  - [ ] Verify immutable input set for current run: `WizardProfile`, `TechnicalProfile`, `AIUsageFlow`, evidence-gate status, and Manager reconciliation outcomes.
  - [ ] Persist `VerifiedProfile` version with source profile version refs, evidence refs, confidence, gate outcome, and allowed non-critical unresolved unknowns.
  - [ ] Reject generation when any material conflict remains unresolved or required evidence gate is not satisfied.
  - [ ] Distinguish `non-critical unresolved unknowns` that may be preserved from `critical unknown/unclear/conflicted` dimensions that must block approval/classification.
  - [ ] Mark downstream legal matching and classification readers to consume only `VerifiedProfile` facts, never raw unresolved upstream fields.
  - [ ] Preserve stale/superseded behavior when upstream evidence or reconciliation inputs change after profile creation.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `5-5-create-verifiedprofile-after-gates-pass`
- Official execution artifact: `docs/implementation-artifacts/5-5-create-verifiedprofile-after-gates-pass.md`
- Epic: `Epic 5 - Reconciliation and VerifiedProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 5 là gate quyết định facts nào được hợp thức hóa cho legal matching. Đây là nơi sai một lần sẽ làm classification dùng dữ liệu disputed.
- Story trong epic này phải giữ conflict detection, score explanation, Manager-only resolution và immutable history cùng lúc.
- VerifiedProfile là output duy nhất được phép đi tiếp sang legal matching; không có shortcut từ AIUsageFlow.

- Previous story context: `docs/developer/story-handbook/5-4-preserve-scanner-evidence-during-resolution.md`
- Next story dependency seam: `docs/developer/story-handbook/5-6-manager-review-and-approval-of-verifiedprofile.md`
- Artifact chain for this epic: AIUsageFlow + WizardProfile + TechnicalProfile comparison -> conflict resolution -> VerifiedProfile.
- Workflow/state focus: AI_USAGE_FLOW_READY -> RECONCILIATION_REQUIRED / VERIFIED_PROFILE_READY / VERIFIED_PROFILE_APPROVED / VERIFIED_PROFILE_STALE.

### Story-Specific Implementation Tasks

- Check required profile/evidence/reconciliation gates before generating VerifiedProfile.
- Persist versioned VerifiedProfile with source refs, gate status, confidence and allowed non-critical unknowns.
- Block generation, approval and downstream eligibility when unresolved conflicts, insufficient evidence or critical unknowns remain.
- Ensure downstream legal matching and classification consume VerifiedProfile as the only canonical final-fact source.

### Story-Specific Subtasks

- Verify immutable input set for current run: `WizardProfile`, `TechnicalProfile`, `AIUsageFlow`, evidence-gate status, and Manager reconciliation outcomes.
- Persist `VerifiedProfile` version with source profile version refs, evidence refs, confidence, gate outcome, and allowed non-critical unresolved unknowns.
- Reject generation when any material conflict remains unresolved or required evidence gate is not satisfied.
- Distinguish `non-critical unresolved unknowns` that may be preserved from `critical unknown/unclear/conflicted` dimensions that must block approval/classification.
- Mark downstream legal matching and classification readers to consume only `VerifiedProfile` facts, never raw unresolved upstream fields.
- Preserve stale/superseded behavior when upstream evidence or reconciliation inputs change after profile creation.

### Task to Acceptance Criteria Traceability

- `AC1.1`: Verify required `WizardProfile`, `TechnicalProfile`, `AIUsageFlow`, evidence gates, and reconciliation decisions are complete before generation.
- `AC1.2`: Create a versioned `VerifiedProfile` only from the current immutable input set.
- `AC1.3`: Persist verified assessment facts in the generated profile.
- `AC1.4`: Persist source refs and source profile version refs.
- `AC1.5`: Persist allowed non-critical unresolved unknowns explicitly, not as silent omissions.
- `AC1.6`: Persist confidence, gate status, and audit metadata.
- `AC2.1`: Deny generation when required conflicts remain unresolved.
- `AC2.2`: Deny generation when technical evidence is insufficient.
- `AC2.3`: Deny generation when critical dimensions remain blocked.
- `AC2.4`: Return neutral blocker explanation rather than legal/risk wording.
- `AC2.5`: Keep legal matching unavailable while VerifiedProfile generation is denied.
- `AC2.6`: Keep classification unavailable while VerifiedProfile generation is denied.
- `AC3.1`: Evaluate whether any critical dimension remains `unknown`.
- `AC3.2`: Evaluate whether any critical dimension remains `unclear`.
- `AC3.3`: Evaluate whether any critical dimension remains conflict-bearing.
- `AC3.4`: Evaluate whether any critical dimension remains insufficiently evidenced.
- `AC3.5`: Block approval when any of the above critical conditions remain.
- `AC3.6`: Mark downstream classification ineligible when any of the above critical conditions remain.
- `AC3.7`: Prevent carrying critical unknowns as approved final facts.
- `AC4.1`: Route downstream legal matching to `VerifiedProfile` as canonical input.
- `AC4.2`: Route downstream classification to `VerifiedProfile` as canonical input.
- `AC4.3`: Prevent direct reads of unresolved `WizardProfile` values as final facts.
- `AC4.4`: Prevent direct reads of unresolved `TechnicalProfile` values as final facts.
- `AC4.5`: Prevent direct reads of unresolved `AIUsageFlow` values as final facts.

### Dependencies and Prerequisites

- Stories 5.1-5.4 reconciliation outcomes.
- State transition authority for VERIFIED_PROFILE_READY eligibility.

### Explicit Non-Goals

- No use of unresolved WizardProfile/TechnicalProfile/AIUsageFlow values as final facts.
- No VerifiedProfile generation from insufficient evidence.
- No classification handoff while gates fail.

### Story-Specific Risks and Edge Cases

- Critical unknowns carried as approved facts.
- VerifiedProfile created before all required conflicts resolved.
- Downstream consumers bypass VerifiedProfile and read raw sources.

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
- `VerifiedProfile` nên lưu rõ:
  - upstream version refs cho `WizardProfile`, `TechnicalProfile`, `AIUsageFlow`
  - `gateStatus`
  - `classificationEligibility` hoặc equivalent downstream-ready flag
  - `preservedNonCriticalUnknowns`
  - `blockingCriticalDimensions` khi generation bị deny

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
- Gate matrix tests cho:
  - all required inputs complete -> create profile
  - unresolved conflict -> deny
  - insufficient technical evidence -> deny
  - critical unknown/unclear/conflicted dimension -> deny approval/classification eligibility
- Consumer contract tests bảo đảm legal matching/classification không đọc trực tiếp raw upstream profile khi `VerifiedProfile` đã là canonical source.

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
- Source packet: `docs/developer/story-handbook/5-5-create-verifiedprofile-after-gates-pass.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/5-5-create-verifiedprofile-after-gates-pass.md
