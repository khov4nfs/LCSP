# Story 4.3: Evidence-Referenced AI Usage Claims

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Evidence-Referenced AI Usage Claims

## Acceptance Criteria

1. **Given** LCSP generates a material AIUsageFlow claim
   **When** the claim is stored
   **Then** the claim includes source refs, evidence refs where available, confidence, generation method, profile versions, and timestamp.

2. **Given** a claim is based only on Manager declaration
   **When** LCSP stores the claim
   **Then** LCSP marks the claim as declaration-backed
   **And** does not imply scanner confirmation.

3. **Given** a claim is based on technical evidence
   **When** LCSP stores the claim
   **Then** LCSP links to the accepted TechnicalEvidenceReport or TechnicalProfile ref
   **And** preserves related coverage limitations.

## Tasks / Subtasks

- [ ] Attach claim-level source refs, evidence refs, confidence, generation method and profile versions to each material claim. (AC: 1)
- [ ] Differentiate declaration-backed claims from evidence-backed claims in persistence and read models. (AC: 2)
- [ ] Preserve coverage limitations when claim depends on technical evidence. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `4-3-evidence-referenced-ai-usage-claims`
- Official execution artifact: `docs/implementation-artifacts/4-3-evidence-referenced-ai-usage-claims.md`
- Epic: `Epic 4 - AIUsageFlow Claims and Uncertainty`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 4 chuyển từ technical observation sang business-usage claims. Đây là nơi dễ overclaim nếu dev không giữ ranh giới artifact.
- Story trong epic này phải ưu tiên evidence-backed claims, uncertainty preservation và conflict candidate generation.
- AIUsageFlow là đầu vào cho reconciliation, không phải final authority và không được ngầm trở thành VerifiedProfile.

- Previous story context: `docs/developer/story-handbook/4-2-preserve-technicalprofile-and-aiusageflow-separation.md`
- Next story dependency seam: `docs/developer/story-handbook/4-4-unknown-unclear-and-low-confidence-usage-fields.md`
- Artifact chain for this epic: WizardProfile + TechnicalProfile + accepted TechnicalEvidenceReport -> AIUsageFlow with claim refs/confidence/uncertainty.
- Workflow/state focus: TECHNICAL_PROFILE_READY -> AI_USAGE_FLOW_READY or AI_USAGE_FLOW_UNCLEAR and conflict-candidate emission.

### Story-Specific Implementation Tasks

- Attach claim-level source refs, evidence refs, confidence, generation method and profile versions to each material claim.
- Differentiate declaration-backed claims from evidence-backed claims in persistence and read models.
- Preserve coverage limitations when claim depends on technical evidence.

### Task to Acceptance Criteria Traceability

- `AC1`: Attach claim-level source refs, evidence refs, confidence, generation method and profile versions to each material claim.
- `AC2`: Differentiate declaration-backed claims from evidence-backed claims in persistence and read models.
- `AC3`: Preserve coverage limitations when claim depends on technical evidence.

### Dependencies and Prerequisites

- Stories 4.1 and 4.2 AIUsageFlow base and artifact separation.
- Accepted evidence/profile refs from Epic 3.

### Explicit Non-Goals

- No implication that declaration-backed claim is scanner-confirmed.
- No unreferenced material claim.
- No dropping coverage limitation metadata.

### Story-Specific Risks and Edge Cases

- Material claim stored without provenance.
- Declaration-only claim rendered as evidence-backed.
- Evidence link points to stale or rejected artifact.

### Architecture Compliance

- Python Worker Platform sở hữu AIUsageFlow generation; API chỉ nên cung cấp status/read model và Manager-facing projection cần thiết.
- TechnicalProfile, TechnicalEvidenceReport và WizardProfile là ba input khác vai trò; không collapse chúng thành một merged artifact ở epic này.
- Nếu LLM được dùng như internal support trong pipeline, nó vẫn phải qua LLM Gateway và không override deterministic evidence.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 4: WizardProfile + TechnicalProfile + accepted TechnicalEvidenceReport -> AIUsageFlow with claim refs/confidence/uncertainty.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 4 thường chạm `AIUsageFlow`, claim-level refs, confidence, uncertainty reasons, conflict refs và workflow status projections.
- Mỗi material claim phải liên kết evidence refs hoặc explicit abstention/unknown; provider/package presence alone không đủ.
- Claim taxonomy và lifecycle phải bám `ai-usage-flow-domain-spec.md` để legal matching dùng lại được.

### State and Audit Requirements

- Trạng thái chính là `AI_USAGE_FLOW_READY` hoặc `AI_USAGE_FLOW_UNCLEAR` tùy chất lượng material facts.
- Critical unknown, low confidence material field hoặc provider-only signal phải block/degrade downstream thay vì fabricated completion.
- Audit cần phản ánh claim generation, abstention, uncertainty và conflict-candidate creation khi material disagreement xuất hiện.

### File Structure Notes

- `deepagents` cho AIUsageFlow worker, claim assembly và persistence.
- `apps/api` cho status projection, review surface orchestration và Manager-safe read model.
- `packages/*` cho claim schema, evidence-ref contract, uncertainty/conflict enums.

### Implementation Guidance for the Dev Agent

- Không suy luận business usage chỉ từ technical provider/framework presence nếu không có evidence material phù hợp.
- Tách bạch “unknown”, “unclear”, “low confidence” và “conflict candidate”; mỗi trạng thái có hậu quả downstream khác nhau.
- Review surface nếu có chỉ hỗ trợ quan sát và giải thích, không cấp quyền final authority ở Epic 4.

### Testing Requirements

- Worker tests cho claim refs/confidence/uncertainty generation.
- Negative-path coverage cho provider-only signal, low confidence material field, missing inputs.
- Status/read-model tests cho unclear/conflict surfaces và artifact separation assertions.

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
- [Source: docs/implementation/python-worker-platform-implementation.md]
- [Source: docs/implementation/llm-gateway-implementation.md]
- [Source: docs/implementation/tasks/modules/python-workers/intelligence/02-ai-usage-flow-worker.md]
- [Source: docs/implementation/handoffs/HANDOFF-ai-usage-flow-and-reconciliation.md]
- [Source: docs/implementation/readiness/state-transition-authority.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/4-3-evidence-referenced-ai-usage-claims.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/4-3-evidence-referenced-ai-usage-claims.md
