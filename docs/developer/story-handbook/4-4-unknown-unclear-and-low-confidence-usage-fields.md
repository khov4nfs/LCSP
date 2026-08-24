# Story 4.4 Developer Packet

Status: ready-for-dev

## Story

Unknown, Unclear, and Low-Confidence Usage Fields

## Acceptance Criteria

1. **Given** AIUsageFlow generation cannot determine a material usage dimension
   **When** LCSP evaluates the dimension
   **Then** LCSP records `UNKNOWN`, `UNCLEAR`, or low-confidence state with reason
   **And** avoids substituting defaults that imply factual certainty.

2. **Given** provider or framework evidence exists without usage context
   **When** LCSP generates AIUsageFlow
   **Then** LCSP does not infer downstream decision role, human review, affected subjects, or harm category from provider presence alone.

3. **Given** uncertainty affects downstream readiness
   **When** Manager views the assessment
   **Then** LCSP explains the missing or unclear dimension in business language
   **And** does not show final risk or legal classification based only on uncertain AIUsageFlow.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `4-4-unknown-unclear-and-low-confidence-usage-fields`
- Official execution artifact: `docs/implementation-artifacts/4-4-unknown-unclear-and-low-confidence-usage-fields.md`
- Epic: `Epic 4 - AIUsageFlow Claims and Uncertainty`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 4 chuyển từ technical observation sang business-usage claims. Đây là nơi dễ overclaim nếu dev không giữ ranh giới artifact.
- Story trong epic này phải ưu tiên evidence-backed claims, uncertainty preservation và conflict candidate generation.
- AIUsageFlow là đầu vào cho reconciliation, không phải final authority và không được ngầm trở thành VerifiedProfile.

- Previous story context: `docs/developer/story-handbook/4-3-evidence-referenced-ai-usage-claims.md`
- Next story dependency seam: `docs/developer/story-handbook/4-5-conflict-candidate-detection-for-reconciliation.md`
- Artifact chain for this epic: WizardProfile + TechnicalProfile + accepted TechnicalEvidenceReport -> AIUsageFlow with claim refs/confidence/uncertainty.
- Workflow/state focus: TECHNICAL_PROFILE_READY -> AI_USAGE_FLOW_READY or AI_USAGE_FLOW_UNCLEAR and conflict-candidate emission.

### Story-Specific Implementation Tasks

- Model explicit UNKNOWN/UNCLEAR/low-confidence states per material usage dimension.
- Prevent provider/framework-only evidence from inferring business usage facts.
- Explain uncertainty in business-language status/read models.

### Task to Acceptance Criteria Traceability

- `AC1`: Model explicit UNKNOWN/UNCLEAR/low-confidence states per material usage dimension.
- `AC2`: Prevent provider/framework-only evidence from inferring business usage facts.
- `AC3`: Explain uncertainty in business-language status/read models.

### Dependencies and Prerequisites

- Story 4.3 claim provenance model.
- Classification/blocking semantics from readiness authority.

### Explicit Non-Goals

- No default substitution that implies certainty.
- No final risk/legal language based only on uncertainty.
- No provider-only inference for subjects/review/harm/action.

### Story-Specific Risks and Edge Cases

- Uncertain field collapsed into false certainty.
- Manager sees unexplained technical uncertainty labels.
- Downstream gate ignores low-confidence status.

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
