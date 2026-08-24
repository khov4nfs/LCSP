# Story 3.7 Developer Packet

Status: ready-for-dev

## Story

TechnicalEvidenceReport Gates

## Acceptance Criteria

1. **Given** scanner outputs are available
   **When** LCSP builds a TechnicalEvidenceReport
   **Then** the report includes required schema fields, snapshot provenance, tool versions, config hash, ruleset hash, finding references, confidence, privacy flags, coverage limitations, report hash, and generation timestamp.

2. **Given** TechnicalEvidenceReport contains raw source, secrets, full prompts, unsafe identifiers, schema-invalid data, or missing required provenance
   **When** evidence gates run
   **Then** LCSP rejects the report for downstream use
   **And** records a safe gate failure audit event.

3. **Given** evidence passes schema and privacy gates
   **When** quality gates evaluate sufficiency
   **Then** LCSP marks the evidence ready or insufficient with explicit reasons
   **And** downstream TechnicalProfile generation can proceed only from accepted evidence.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `3-7-technicalevidencereport-gates`
- Official execution artifact: `docs/implementation-artifacts/3-7-technicalevidencereport-gates.md`
- Epic: `Epic 3 - Trusted Repository Evidence and TechnicalProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 3 là bridge từ assessment sang trusted technical evidence. Đây là boundary dễ phá privacy nhất nếu implementation lỏng tay.
- Story trong epic này phải giữ scanner là static-analysis only và không được kéo scan execution vào web request lifecycle.
- Handoff chính của epic là `RepositorySnapshot`, `TechnicalEvidenceReport`, rồi `TechnicalProfile`; ba artifact này phải giữ boundary rõ.

- Previous story context: `docs/developer/story-handbook/3-6-scan-failure-severity-and-evidence-acceptance-policy.md`
- Next story dependency seam: `docs/developer/story-handbook/3-8-technicalprofile-generation.md`
- Artifact chain for this epic: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Workflow/state focus: repository/snapshot/scan/evidence/profile states from REPOSITORY_CONNECTED to TECHNICAL_PROFILE_READY.

### Story-Specific Implementation Tasks

- Assemble TechnicalEvidenceReport schema with provenance, tool metadata, refs, privacy flags and coverage limitations.
- Run schema/privacy/provenance gate checks before downstream use.
- Emit accepted vs insufficient vs rejected outcome with explicit reasons and audit trail.

### Task to Acceptance Criteria Traceability

- `AC1`: Assemble TechnicalEvidenceReport schema with provenance, tool metadata, refs, privacy flags and coverage limitations.
- `AC2`: Run schema/privacy/provenance gate checks before downstream use.
- `AC3`: Emit accepted vs insufficient vs rejected outcome with explicit reasons and audit trail.

### Dependencies and Prerequisites

- Stories 3.4-3.6 workspace, toolchain and severity outputs.
- Evidence gate contract from `MW-scan-py-004`.

### Explicit Non-Goals

- No downstream profile from rejected evidence.
- No raw source, secrets or unsafe identifiers in report.
- No bypass of provenance/quality gating for convenience.

### Story-Specific Risks and Edge Cases

- Schema-valid but provenance-invalid report treated as accepted.
- Privacy leak via finding refs or unsafe identifiers.
- Quality-insufficient evidence still drives TechnicalProfile.

### Architecture Compliance

- NestJS API chỉ tạo trusted trigger, persist status và enqueue command qua outbox; Python Worker Platform sở hữu scan/tool execution và downstream profile work.
- Scanner worker phải dùng restricted workspace, pinned tools, bounded resources và cleanup verification trước completed event.
- TechnicalProfile là artifact kỹ thuật bất biến; không được dùng như AIUsageFlow, VerifiedProfile hay compliance status.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 3: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


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
