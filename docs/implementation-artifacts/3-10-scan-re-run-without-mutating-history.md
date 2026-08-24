# Story 3.10: Scan Re-run Without Mutating History

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or scoped actor, I want to rerun scans as new immutable evidence versions, so that improved evidence does not overwrite prior assessment history.

## Acceptance Criteria

1. **Given** an assessment already has a scan job, TechnicalEvidenceReport, or TechnicalProfile
   **When** an authorized actor requests a scan rerun
   **Then** LCSP creates a new RepositoryScanJob and new evidence/profile version chain
   **And** previous snapshot, evidence report, TechnicalProfile, audit events, and artifact hashes remain immutable
   **And** the Manager can request rerun without assigning a Developer.

2. **Given** a rerun uses the same snapshot and valid idempotency key
   **When** duplicate rerun requests are received
   **Then** LCSP safely resumes or returns the existing rerun job
   **And** does not create duplicate accepted evidence.

3. **Given** users view scan history
   **When** multiple scan versions exist
   **Then** LCSP displays version, snapshot, status, timestamp, trigger source, and current/downstream usage state
   **And** audit trail preserves each transition.

## Tasks / Subtasks

- [ ] Add rerun request path that creates new scan generation from immutable snapshot/evidence lineage. (AC: 1)
- [ ] Mark superseded status/history without mutating prior accepted artifacts. (AC: 2)
- [ ] Project rerun status and audit trail clearly in history/read models. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `3-10-scan-re-run-without-mutating-history`
- Official execution artifact: `docs/implementation-artifacts/3-10-scan-re-run-without-mutating-history.md`
- Epic: `Epic 3 - Trusted Repository Evidence and TechnicalProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 3 là bridge từ assessment sang trusted technical evidence. Đây là boundary dễ phá privacy nhất nếu implementation lỏng tay.
- Story trong epic này phải giữ scanner là static-analysis only và không được kéo scan execution vào web request lifecycle.
- Handoff chính của epic là `RepositorySnapshot`, `TechnicalEvidenceReport`, rồi `TechnicalProfile`; ba artifact này phải giữ boundary rõ.

- Previous story context: `docs/developer/story-handbook/3-9-redacted-technical-findings-review-and-developer-scoped-view.md`
- Next story dependency seam: `docs/developer/story-handbook/3-11-removed-and-deferred-evidence-path-guardrails.md`
- Artifact chain for this epic: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Workflow/state focus: repository/snapshot/scan/evidence/profile states from REPOSITORY_CONNECTED to TECHNICAL_PROFILE_READY.

### Story-Specific Implementation Tasks

- Add rerun request path that creates new scan generation from immutable snapshot/evidence lineage.
- Mark superseded status/history without mutating prior accepted artifacts.
- Project rerun status and audit trail clearly in history/read models.

### Task to Acceptance Criteria Traceability

- `AC1`: Add rerun request path that creates new scan generation from immutable snapshot/evidence lineage.
- `AC2`: Mark superseded status/history without mutating prior accepted artifacts.
- `AC3`: Project rerun status and audit trail clearly in history/read models.

### Dependencies and Prerequisites

- Existing scan/evidence/profile chain from prior Epic 3 stories.
- Replay/idempotency rules from orchestration decision docs.

### Explicit Non-Goals

- No overwrite of previous evidence/profile versions.
- No silent rerun hidden from audit/history views.
- No reuse of stale classification/profile outputs as if current.

### Story-Specific Risks and Edge Cases

- Rerun mutates prior accepted artifacts.
- Current vs historical generation unclear to Manager.
- Replay and rerun semantics collide.

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

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/3-10-scan-re-run-without-mutating-history.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/3-10-scan-re-run-without-mutating-history.md
