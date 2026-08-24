# Story 3.4: Static Scanner Workspace and Sandbox

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Static Scanner Workspace and Sandbox

## Acceptance Criteria

1. **Given** a RepositoryScanJob is ready
   **When** the Python scanner worker locks the job
   **Then** it obtains the pinned archive through the authenticated internal snapshot service and materializes it in a restricted temporary workspace
   **And** the scanner does not call GitHub directly or receive GitHub credentials
   **And** records workspace ID, snapshot ID, worker lease, start time, and cleanup policy
   **And** does not persist raw source outside the restricted workspace.

2. **Given** scanner execution is in progress
   **When** project code would require install, build, test, Docker execution, endpoint probing, or arbitrary runtime execution
   **Then** the scanner does not perform that action
   **And** records the limitation as unsupported or coverage-limited evidence.

3. **Given** scan workspace processing completes, fails, or times out
   **When** cleanup runs
   **Then** LCSP verifies temporary workspace cleanup
   **And** records cleanup status and any safe residual cleanup action.

## Tasks / Subtasks

- [ ] Add the GitHub Integration-owned internal snapshot archive endpoint with worker authentication and scan/snapshot scope validation. (AC: 1)
- [ ] Materialize the pinned snapshot through `SnapshotServiceClient` into the restricted temporary scanner workspace with lease metadata. (AC: 1)
- [ ] Enforce that scanner code, configuration, and queue payloads contain no GitHub client or credential. (AC: 1)
- [ ] Block build/test/install/docker/runtime execution inside scanner flow. (AC: 2)
- [ ] Verify cleanup on success, failure and timeout before marking job outcome. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `3-4-static-scanner-workspace-and-sandbox`
- Official execution artifact: `docs/implementation-artifacts/3-4-static-scanner-workspace-and-sandbox.md`
- Epic: `Epic 3 - Trusted Repository Evidence and TechnicalProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 3 là bridge từ assessment sang trusted technical evidence. Đây là boundary dễ phá privacy nhất nếu implementation lỏng tay.
- Story trong epic này phải giữ scanner là static-analysis only và không được kéo scan execution vào web request lifecycle.
- Handoff chính của epic là `RepositorySnapshot`, `TechnicalEvidenceReport`, rồi `TechnicalProfile`; ba artifact này phải giữ boundary rõ.

- Previous story context: `docs/developer/story-handbook/3-3-trusted-scan-trigger-and-scan-job-orchestration.md`
- Next story dependency seam: `docs/developer/story-handbook/3-5-static-scanner-toolchain-execution.md`
- Artifact chain for this epic: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Workflow/state focus: repository/snapshot/scan/evidence/profile states from REPOSITORY_CONNECTED to TECHNICAL_PROFILE_READY.

### Story-Specific Implementation Tasks

- Stream the pinned archive from the GitHub Integration-owned internal snapshot service; keep GitHub credentials inside the API boundary.
- Materialize through `SnapshotServiceClient` into the restricted temporary scanner workspace with lease metadata.
- Block build/test/install/docker/runtime execution inside scanner flow.
- Verify cleanup on success, failure and timeout before marking job outcome.

### Task to Acceptance Criteria Traceability

- `AC1`: Internal service authenticates the worker, validates scan/snapshot scope and pinned commit, then streams the archive; scanner materializes it without direct GitHub access.
- `AC2`: Block build/test/install/docker/runtime execution inside scanner flow.
- `AC3`: Verify cleanup on success, failure and timeout before marking job outcome.

### Dependencies and Prerequisites

- Story 3.3 scan job orchestration.
- GitHub Integration repository connection and pinned snapshot authority.
- Python worker platform and scanner runtime authority.

### Explicit Non-Goals

- No persistent raw source outside restricted workspace.
- No direct GitHub access, GitHub SDK, installation token, or GitHub App private key in the scanner runtime.
- No arbitrary command execution.
- No completed event before cleanup verification.

### Story-Specific Risks and Edge Cases

- Workspace leak after failure.
- Credential leakage across the API/worker boundary or a scan job requesting an unrelated snapshot.
- Archive traversal, unsafe links, decompression bomb, or commit mismatch during materialization.
- Unsupported runtime action accidentally executed.
- Cleanup failure hidden behind successful scan status.

### Architecture Compliance

- NestJS API sở hữu GitHub Integration, GitHub credentials và internal snapshot streaming endpoint; Python Worker Platform chỉ sở hữu restricted workspace, scan/tool execution và downstream profile work.
- Queue payload chỉ chứa reference; scanner dùng worker service authentication để lấy đúng snapshot đã pin và không gọi GitHub trực tiếp.
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

- API/worker contract tests cho trusted trigger, internal snapshot authorization/scope/commit integrity, outbox enqueue và status projection.
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
- Source packet: `docs/developer/story-handbook/3-4-static-scanner-workspace-and-sandbox.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/3-4-static-scanner-workspace-and-sandbox.md
