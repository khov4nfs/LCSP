# Story 4.6 Developer Packet

Status: ready-for-dev

## Story

As a Manager, I want to review AIUsageFlow claims and uncertainty, so that I can understand the interpreted AI usage before reconciliation without seeing it as final legal classification.

## Acceptance Criteria

1. **Given** AIUsageFlow has been generated
   **When** Manager views the AI usage review surface
   **Then** LCSP shows claim summaries, source refs, confidence, unknown fields, conflict candidates, and evidence availability
   **And** distinguishes declaration-backed claims from scanner-backed claims.

2. **Given** AIUsageFlow is incomplete, uncertain, or conflict-bearing
   **When** Manager reviews it
   **Then** LCSP shows neutral next-action guidance
   **And** does not present final risk, legal conclusion, compliance status, or VerifiedProfile approval.

3. **Given** a Developer has scoped access to technical evidence only
   **When** the Developer requests AIUsageFlow review
   **Then** LCSP applies RBAC to hide Manager-only review actions and out-of-scope business declarations
   **And** audits access.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `4-6-aiusageflow-review-surface-without-final-authority`
- Official execution artifact: `docs/implementation-artifacts/4-6-aiusageflow-review-surface-without-final-authority.md`
- Epic: `Epic 4 - AIUsageFlow Claims and Uncertainty`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 4 chuyển từ technical observation sang business-usage claims. Đây là nơi dễ overclaim nếu dev không giữ ranh giới artifact.
- Story trong epic này phải ưu tiên evidence-backed claims, uncertainty preservation và conflict candidate generation.
- AIUsageFlow là đầu vào cho reconciliation, không phải final authority và không được ngầm trở thành VerifiedProfile.

- Previous story context: `docs/developer/story-handbook/4-5-conflict-candidate-detection-for-reconciliation.md`
- Next story dependency seam: none; story này là tail story hiện tại của epic.
- Artifact chain for this epic: WizardProfile + TechnicalProfile + accepted TechnicalEvidenceReport -> AIUsageFlow with claim refs/confidence/uncertainty.
- Workflow/state focus: TECHNICAL_PROFILE_READY -> AI_USAGE_FLOW_READY or AI_USAGE_FLOW_UNCLEAR and conflict-candidate emission.

### Story-Specific Implementation Tasks

- Create Manager review surface showing claim summaries, refs, confidence, unknowns and conflict candidates.
- Enforce RBAC-scoped view differences for Developers versus Managers.
- Keep review state neutral and clearly pre-reconciliation/pre-classification.

### Story-Specific Subtasks

- Build Manager review read model for claims, source refs, confidence, uncertainty and conflict candidates.
- Render declaration-backed versus scanner-backed claims distinctly so provenance is visible at a glance.
- Apply RBAC-scoped filtering for Developer access so out-of-scope business declarations and Manager-only actions stay hidden.
- Keep copy, labels and next actions neutral so the surface cannot be mistaken for VerifiedProfile approval or final classification.

### Task to Acceptance Criteria Traceability

- `AC1`: Create Manager review surface showing claim summaries, refs, confidence, unknowns and conflict candidates.
- `AC2`: Enforce RBAC-scoped view differences for Developers versus Managers.
- `AC3`: Keep review state neutral and clearly pre-reconciliation/pre-classification.

### Dependencies and Prerequisites

- Stories 4.1-4.5 AIUsageFlow artifact and conflict candidates.
- RBAC collaboration scope from Epic 1/3.

### Explicit Non-Goals

- No final legal classification or VerifiedProfile approval in this surface.
- No Manager-only actions visible to scoped Developer.
- No hiding of uncertainty/conflict to create false confidence.

### Story-Specific Risks and Edge Cases

- Review surface mistaken as final authority.
- Developer sees out-of-scope declarations/actions.
- Neutral guidance accidentally uses risk/compliance wording.

### Architecture Compliance

- Python Worker Platform sở hữu AIUsageFlow generation; API chỉ nên cung cấp status/read model và Manager-facing projection cần thiết.
- TechnicalProfile, TechnicalEvidenceReport và WizardProfile là ba input khác vai trò; không collapse chúng thành một merged artifact ở epic này.
- Nếu LLM được dùng như internal support trong pipeline, nó vẫn phải qua LLM Gateway và không override deterministic evidence.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 4: WizardProfile + TechnicalProfile + accepted TechnicalEvidenceReport -> AIUsageFlow with claim refs/confidence/uncertainty.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.
- Handoff contract cho story này tồn tại trong `docs/planning-artifacts/epics.md` và phải được giữ nguyên khi thiết kế artifact/output boundary.

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
- [Source: Handoff contract embedded in `docs/planning-artifacts/epics.md` for this story]
