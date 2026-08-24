# Story 3.3: Trusted Scan Trigger and Scan Job Orchestration

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Trusted Scan Trigger and Scan Job Orchestration

## Acceptance Criteria

1. **Given** a repository snapshot exists and assessment state permits technical scan
   **When** a trusted trigger or Manager action requests scan
   **Then** LCSP creates or resumes a RepositoryScanJob with assessment ID, snapshot ID, trigger source, idempotency key, state, attempt count, and correlation ID
   **And** valid duplicate requests return the existing job or safe resume state.

2. **Given** repository mapping or assessment context is incomplete
   **When** a scan trigger is received
   **Then** LCSP transitions to a controlled state such as `PENDING_MAPPING`, `BLOCKED_MAPPING`, `WAITING_FOR_CONTEXT`, or `READY_TO_SNAPSHOT`
   **And** the Manager sees the required next action without risk or legal classification wording.

3. **Given** duplicate, retry, out-of-order, or replayed scan commands occur
   **When** the worker or API processes them
   **Then** LCSP applies idempotency and state validation
   **And** creates no duplicate accepted evidence chain
   **And** records audit and queue outcome.

4. **Given** scan commands are persisted through the worker platform
   **When** retries, DLQ, or operator replay are required
   **Then** LCSP applies the canonical outbox owner, retry budget, DLQ reason codes, replay authority, and operator recovery rules
   **And** no replay can mutate prior accepted TechnicalEvidenceReport or TechnicalProfile versions.

## Tasks / Subtasks

- [ ] Create/resume RepositoryScanJob with canonical idempotency key and correlation fields.
- [ ] Map incomplete context into controlled pre-scan states instead of unsafe execution.
- [ ] Apply idempotency and state validation for duplicate, retry, out-of-order and replayed scan commands.
- [ ] Enforce canonical outbox owner, retry budget, DLQ reason codes and replay authority without mutating accepted evidence/profile chain.
- [ ] Story-specific subtasks
  - [ ] Persist `RepositoryScanJob` with `assessmentId`, `repositorySnapshotId`, `triggerSource`, `idempotencyKey`, `status`, `attemptCount`, and `correlationId`.
  - [ ] Return existing job or safe resume projection when duplicate trigger delivery matches canonical idempotency rules.
  - [ ] Resolve trigger context into exactly one of `READY_TO_SNAPSHOT`, `PENDING_MAPPING`, `BLOCKED_MAPPING`, or `WAITING_FOR_CONTEXT` before scan execution.
  - [ ] Surface Manager-visible recovery reason for missing or ambiguous repository/account/assessment mapping.
  - [ ] Reject out-of-order or replayed commands from mutating completed scan/evidence/profile history.
  - [ ] Persist audit and queue outcome for trusted-trigger authorization, enqueue, retry, DLQ, and replay handling.
  - [ ] Enforce replay authority and operator recovery rules from the trusted-trigger retry/DLQ/replay decision artifact.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `3-3-trusted-scan-trigger-and-scan-job-orchestration`
- Official execution artifact: `docs/implementation-artifacts/3-3-trusted-scan-trigger-and-scan-job-orchestration.md`
- Epic: `Epic 3 - Trusted Repository Evidence and TechnicalProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 3 là bridge từ assessment sang trusted technical evidence. Đây là boundary dễ phá privacy nhất nếu implementation lỏng tay.
- Story trong epic này phải giữ scanner là static-analysis only và không được kéo scan execution vào web request lifecycle.
- Handoff chính của epic là `RepositorySnapshot`, `TechnicalEvidenceReport`, rồi `TechnicalProfile`; ba artifact này phải giữ boundary rõ.

- Previous story context: `docs/developer/story-handbook/3-2-pin-commit-and-create-repositorysnapshot.md`
- Next story dependency seam: `docs/developer/story-handbook/3-4-static-scanner-workspace-and-sandbox.md`
- Artifact chain for this epic: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Workflow/state focus: repository/snapshot/scan/evidence/profile states from REPOSITORY_CONNECTED to TECHNICAL_PROFILE_READY.

### Story-Specific Implementation Tasks

- Create/resume RepositoryScanJob with canonical idempotency key and correlation fields.
- Map incomplete context into controlled pre-scan states instead of unsafe execution.
- Apply idempotency and state validation for duplicate, retry, out-of-order and replayed scan commands.
- Enforce canonical outbox owner, retry budget, DLQ reason codes and replay authority without mutating accepted evidence/profile chain.

### Story-Specific Subtasks

- Persist `RepositoryScanJob` with `assessmentId`, `repositorySnapshotId`, `triggerSource`, `idempotencyKey`, `status`, `attemptCount`, and `correlationId`.
- Return existing job or safe resume projection when duplicate trigger delivery matches canonical idempotency rules.
- Resolve trigger context into exactly one of `READY_TO_SNAPSHOT`, `PENDING_MAPPING`, `BLOCKED_MAPPING`, or `WAITING_FOR_CONTEXT` before scan execution.
- Surface Manager-visible recovery reason for missing or ambiguous repository/account/assessment mapping.
- Reject out-of-order or replayed commands from mutating completed scan/evidence/profile history.
- Persist audit and queue outcome for trusted-trigger authorization, enqueue, retry, DLQ, and replay handling.
- Enforce replay authority and operator recovery rules from the trusted-trigger retry/DLQ/replay decision artifact.

### Task to Acceptance Criteria Traceability

- `AC1.1`: Persist `assessment ID`, `snapshot ID`, `trigger source`, `idempotency key`, `state`, `attempt count`, and `correlation ID` on create/resume.
- `AC1.2`: Return existing job or safe resume state for valid duplicate requests instead of creating a second scan workflow.
- `AC2.1`: Resolve incomplete repository/account/assessment context into `PENDING_MAPPING`, `BLOCKED_MAPPING`, `WAITING_FOR_CONTEXT`, or `READY_TO_SNAPSHOT`.
- `AC2.2`: Expose Manager next action in neutral operational wording without risk/legal classification language.
- `AC3.1`: Apply idempotency and state validation across duplicate deliveries.
- `AC3.2`: Apply idempotency and state validation across retry events.
- `AC3.3`: Apply idempotency and state validation across out-of-order events.
- `AC3.4`: Apply idempotency and state validation across replay handling.
- `AC3.5`: Guarantee no duplicate accepted evidence chain is produced from any of the above paths.
- `AC3.6`: Record audit and queue outcome for each accepted, blocked, retried, ignored, or replayed command path.
- `AC4.1`: Use canonical outbox owner when persisting scan commands.
- `AC4.2`: Apply retry budget and DLQ reason codes from authority docs.
- `AC4.3`: Restrict replay to authorized operator recovery path.
- `AC4.4`: Prevent replay from mutating prior accepted `TechnicalEvidenceReport` versions.
- `AC4.5`: Prevent replay from mutating prior accepted `TechnicalProfile` versions.

### Dependencies and Prerequisites

- Story 3.2 RepositorySnapshot.
- Outbox/worker platform contract from Story 1.9 and queue decisions.

### Explicit Non-Goals

- No inline scanner execution in API.
- No duplicate accepted evidence chain from retries or replay.
- No risk/legal wording in pre-scan blocked states.

### Story-Specific Risks and Edge Cases

- Duplicate triggers create inconsistent jobs.
- Replay path mutates immutable evidence chain.
- Missing mapping context still starts scan.

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
- Idempotency matrix tests cho:
  - duplicate delivery same idempotency key
  - retry after transient enqueue/worker failure
  - out-of-order webhook/trigger arrival
  - operator replay after terminal safe recovery path
- Mapping-state tests cho:
  - missing mapping -> `PENDING_MAPPING`
  - ambiguous mapping -> `BLOCKED_MAPPING`
  - incomplete but wait-safe context -> `WAITING_FOR_CONTEXT`
  - complete context -> `READY_TO_SNAPSHOT` hoặc scan resume path

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
- Source packet: `docs/developer/story-handbook/3-3-trusted-scan-trigger-and-scan-job-orchestration.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/3-3-trusted-scan-trigger-and-scan-job-orchestration.md
