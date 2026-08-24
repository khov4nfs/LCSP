# Story 3.8 Developer Packet

Status: ready-for-dev

## Story

TechnicalProfile Generation

## Acceptance Criteria

1. **Given** an accepted TechnicalEvidenceReport exists
   **When** TechnicalProfile generation runs
   **Then** LCSP creates an evidence-derived TechnicalProfile with AI detection indicators, providers, frameworks, model invocation count or ranges, input and output categories, decision-flow signals, human-review signals, coverage limitations, confidence, and evidence references.

2. **Given** a material TechnicalProfile dimension cannot be determined from accepted evidence
   **When** LCSP generates the profile
   **Then** LCSP marks the dimension as unknown, low-confidence, or coverage-limited
   **And** does not infer unsupported facts from Manager statements alone.

3. **Given** downstream workflows consume TechnicalProfile
   **When** they build AIUsageFlow, reconciliation, legal matching, or classification inputs
   **Then** TechnicalProfile remains technical evidence only
   **And** it is not treated as AIUsageFlow, VerifiedProfile, risk level, legal conclusion, or compliance status.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `3-8-technicalprofile-generation`
- Official execution artifact: `docs/implementation-artifacts/3-8-technicalprofile-generation.md`
- Epic: `Epic 3 - Trusted Repository Evidence and TechnicalProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 3 là bridge từ assessment sang trusted technical evidence. Đây là boundary dễ phá privacy nhất nếu implementation lỏng tay.
- Story trong epic này phải giữ scanner là static-analysis only và không được kéo scan execution vào web request lifecycle.
- Handoff chính của epic là `RepositorySnapshot`, `TechnicalEvidenceReport`, rồi `TechnicalProfile`; ba artifact này phải giữ boundary rõ.

- Previous story context: `docs/developer/story-handbook/3-7-technicalevidencereport-gates.md`
- Next story dependency seam: `docs/developer/story-handbook/3-9-redacted-technical-findings-review-and-developer-scoped-view.md`
- Artifact chain for this epic: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Workflow/state focus: repository/snapshot/scan/evidence/profile states from REPOSITORY_CONNECTED to TECHNICAL_PROFILE_READY.

### Story-Specific Implementation Tasks

- Consume only accepted TechnicalEvidenceReport versions to derive TechnicalProfile observations.
- Persist immutable TechnicalProfile with evidence refs, confidence and coverage limitations.
- Enqueue downstream AIUsageFlow request only when profile gates pass.

### Story-Specific Subtasks

- Load only accepted `TechnicalEvidenceReport` versions and reject stale or insufficient evidence before profile derivation.
- Derive technical observations into immutable `TechnicalProfile` fields with evidence refs, confidence and coverage limitation metadata.
- Mark unknown or low-confidence technical dimensions explicitly instead of inferring unsupported facts from declarations.
- Emit downstream AIUsageFlow request only from current accepted profile version and preserve immutable lineage for reruns.

### Task to Acceptance Criteria Traceability

- `AC1`: Consume only accepted TechnicalEvidenceReport versions to derive TechnicalProfile observations.
- `AC2`: Persist immutable TechnicalProfile with evidence refs, confidence and coverage limitations.
- `AC3`: Enqueue downstream AIUsageFlow request only when profile gates pass.

### Dependencies and Prerequisites

- Story 3.7 accepted TechnicalEvidenceReport.
- TechnicalProfile worker contract from `MW-intel-001`.

### Explicit Non-Goals

- No AIUsageFlow or legal conclusion generation here.
- No mutation of TechnicalEvidenceReport.
- No consumption of insufficient/rejected evidence.

### Story-Specific Risks and Edge Cases

- TechnicalProfile confused with business usage interpretation.
- Stale evidence version produces current profile.
- Coverage limitations lost in downstream handoff.

### Architecture Compliance

- NestJS API chỉ tạo trusted trigger, persist status và enqueue command qua outbox; Python Worker Platform sở hữu scan/tool execution và downstream profile work.
- Scanner worker phải dùng restricted workspace, pinned tools, bounded resources và cleanup verification trước completed event.
- TechnicalProfile là artifact kỹ thuật bất biến; không được dùng như AIUsageFlow, VerifiedProfile hay compliance status.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 3: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.
- Handoff contract cho story này tồn tại trong `docs/planning-artifacts/epics.md` và phải được giữ nguyên khi thiết kế artifact/output boundary.

### Data and Persistence Requirements

- Các story Epic 3 thường chạm `RepositoryConnection`, `RepositorySnapshot`, `ScanJob`, `TechnicalEvidenceReport`, `TechnicalProfile`, outbox event và audit metadata.
- Raw source không được thành persistent store thông thường; snapshot/workspace là ephemeral hoặc tightly-controlled artifact boundary.
- Tool provenance, config/ruleset hash, severity policy và evidence refs là dữ liệu bắt buộc cho downstream trust.

### State and Audit Requirements

- State authority trọng tâm gồm `REPOSITORY_CONNECTED`, `TRUSTED_SCAN_TRIGGERED`, `SNAPSHOT_CREATED`, `SCAN_REQUESTED`, `SCAN_RUNNING`, `SCAN_COMPLETED`, `TECHNICAL_EVIDENCE_READY`, `TECHNICAL_PROFILE_READY`.
- Cleanup/privacy/provenance failure phải block chain và không cho TechnicalProfile downstream.
- Rerun phải tạo immutable chain mới thay vì mutate scan/evidence/profile lịch sử.

### File Structure Notes

- `apps/api` cho repository selection, scan request/status API và outbox command creation.
- `deepagents` cho queue consumer, scanner runtime, evidence gates, TechnicalProfile worker.
- `packages/*` cho command/event schemas, status projection contracts, evidence/profile DTOs.

### Implementation Guidance for the Dev Agent

- Không reintroduce manual upload path hoặc Local/CI report upload; trusted scan là golden path duy nhất.
- Command/event naming, idempotency key và retry/DLQ behavior phải bám authority docs thay vì tự phát minh.
- Khi evidence chưa đủ hoặc provenance/privacy fail, hãy block/degrade rõ ràng thay vì overclaim “scan completed”.

### Testing Requirements

- API/worker contract tests cho trusted trigger, outbox enqueue và status projection.
- Scanner sandbox/cleanup security tests, provenance/severity policy assertions.
- TechnicalEvidenceReport gate coverage và immutable TechnicalProfile versioning tests.

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
- [Source: docs/specs/scanner-spec.md]
- [Source: docs/implementation/scanner-implementation.md]
- [Source: docs/implementation/scanner-worker-implementation.md]
- [Source: docs/implementation/python-worker-platform-implementation.md]
- [Source: docs/implementation/queue-implementation.md]
- [Source: docs/implementation/decisions/trusted-scan-trigger-retry-dlq-replay-decision.md]
- [Source: docs/implementation/decisions/scanner-severity-tool-provenance-decision.md]
- [Source: docs/implementation/tasks/modules/scan/01-scan-job-status-endpoint.md]
- [Source: docs/implementation/tasks/modules/python-workers/platform/01-worker-platform-bootstrap.md]
- [Source: docs/implementation/tasks/modules/python-workers/scanner/01-scanner-workspace-setup.md]
- [Source: docs/implementation/tasks/modules/python-workers/scanner/04-evidence-report-assembly.md]
- [Source: docs/implementation/tasks/modules/python-workers/intelligence/01-technical-profile-worker.md]
- [Source: docs/implementation/handoffs/HANDOFF-scanner-evidence-to-technical-profile.md]
- [Source: Handoff contract embedded in `docs/planning-artifacts/epics.md` for this story]
