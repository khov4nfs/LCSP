# Story 4.1 Developer Packet

Status: ready-for-dev

## Story

Build AIUsageFlow From Wizard and Technical Evidence

## Acceptance Criteria

1. **Given** a submitted WizardProfile and accepted TechnicalProfile exist
   **When** AIUsageFlow generation runs
   **Then** LCSP creates AIUsageFlow claims for business process, AI purpose, input categories, output categories, downstream action, affected subjects, human review, automation level, harm categories, and evidence summary
   **And** each material generated claim includes source profile refs, evidence or declaration refs, confidence, and uncertainty reason.

2. **Given** required evidence for AIUsageFlow is unavailable
   **When** generation runs
   **Then** LCSP does not create unsupported authoritative claims
   **And** marks the missing dimensions as unknown, unclear, or pending evidence
   **And** records generation status and audit event.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `4-1-build-aiusageflow-from-wizard-and-technical-evidence`
- Official execution artifact: `docs/implementation-artifacts/4-1-build-aiusageflow-from-wizard-and-technical-evidence.md`
- Epic: `Epic 4 - AIUsageFlow Claims and Uncertainty`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 4 chuyển từ technical observation sang business-usage claims. Đây là nơi dễ overclaim nếu dev không giữ ranh giới artifact.
- Story trong epic này phải ưu tiên evidence-backed claims, uncertainty preservation và conflict candidate generation.
- AIUsageFlow là đầu vào cho reconciliation, không phải final authority và không được ngầm trở thành VerifiedProfile.

- Previous story context: none; đây là story mở đầu chuỗi của epic hoặc một entry boundary mới.
- Next story dependency seam: `docs/developer/story-handbook/4-2-preserve-technicalprofile-and-aiusageflow-separation.md`
- Artifact chain for this epic: WizardProfile + TechnicalProfile + accepted TechnicalEvidenceReport -> AIUsageFlow with claim refs/confidence/uncertainty.
- Workflow/state focus: TECHNICAL_PROFILE_READY -> AI_USAGE_FLOW_READY or AI_USAGE_FLOW_UNCLEAR and conflict-candidate emission.

### Story-Specific Implementation Tasks

- Load WizardProfile, TechnicalProfile and accepted TechnicalEvidenceReport refs into AIUsageFlow generation.
- Create claim set for business process, purpose, inputs/outputs, downstream action, subjects, human review, automation and harm categories.
- Preserve unknown/unclear material dimensions with audit trail instead of inventing claims.

### Task to Acceptance Criteria Traceability

- `AC1`: Load WizardProfile, TechnicalProfile and accepted TechnicalEvidenceReport refs into AIUsageFlow generation.
- `AC2`: Create claim set for business process, purpose, inputs/outputs, downstream action, subjects, human review, automation and harm categories.
- `AC2`: Preserve unknown/unclear material dimensions with audit trail instead of inventing claims.

### Dependencies and Prerequisites

- Story 3.8 TechnicalProfile and submitted WizardProfile from Epic 2.
- AIUsageFlow worker contract from `MW-intel-002`.

### Explicit Non-Goals

- No VerifiedProfile or legal classification generation.
- No overwriting TechnicalProfile.
- No unsupported authoritative claims when evidence is missing.

### Story-Specific Risks and Edge Cases

- Material claim generated without evidence or declaration ref.
- Technical observation confused with business interpretation.
- Unknown dimensions defaulted to certainty.

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
