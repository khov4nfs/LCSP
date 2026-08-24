# Story 3.1: Connect Read-Only GitHub Repository

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or scoped Developer, I want to connect an authorized GitHub repository read-only, so that LCSP can collect trusted technical evidence without granting write access.

## Acceptance Criteria

1. **Given** the actor has PBAC permission to connect a repository for the assessment
   **When** the actor starts GitHub App repository connection
   **Then** LCSP requests only read-only repository permissions required for trusted scan
   **And** the actor can select only authorized repositories and branches
   **And** LCSP stores RepositoryConnection metadata without exposing raw tokens in UI, logs, audit, or API responses
   **And** the Manager can complete repository connection without assigning a Developer.

2. **Given** OAuth/OIDC login exists for LCSP identity
   **When** the actor signs in through OAuth/OIDC
   **Then** LCSP does not treat identity login as repository authorization
   **And** no RepositoryConnection or scan permission is created until GitHub App connection is completed.

3. **Given** repository authorization is revoked, invalid, wrong-organization, or outside PBAC scope
   **When** LCSP validates the connection or receives a repository action
   **Then** LCSP blocks the action with a safe explanation
   **And** no repository content is scanned
   **And** the denial is audited.

## Tasks / Subtasks

- [ ] Implement GitHub App connection and managed installation update flow with read-only permissions and authorized repo selection. (AC: 1)
- [ ] Persist RepositoryConnection metadata without exposing raw tokens. (AC: 2)
- [ ] Separate OAuth identity login from repository authorization and audit denial paths. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `3-1-connect-read-only-github-repository`
- Official execution artifact: `docs/implementation-artifacts/3-1-connect-read-only-github-repository.md`
- Epic: `Epic 3 - Trusted Repository Evidence and TechnicalProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 3 là bridge từ assessment sang trusted technical evidence. Đây là boundary dễ phá privacy nhất nếu implementation lỏng tay.
- Story trong epic này phải giữ scanner là static-analysis only và không được kéo scan execution vào web request lifecycle.
- Handoff chính của epic là `RepositorySnapshot`, `TechnicalEvidenceReport`, rồi `TechnicalProfile`; ba artifact này phải giữ boundary rõ.

- Previous story context: none; đây là story mở đầu chuỗi của epic hoặc một entry boundary mới.
- Next story dependency seam: `docs/developer/story-handbook/3-2-pin-commit-and-create-repositorysnapshot.md`
- Artifact chain for this epic: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Workflow/state focus: repository/snapshot/scan/evidence/profile states from REPOSITORY_CONNECTED to TECHNICAL_PROFILE_READY.

### Story-Specific Implementation Tasks

- Implement GitHub App connection and managed installation update flow with read-only permissions and authorized repo selection.
- Persist RepositoryConnection metadata without exposing raw tokens.
- Separate OAuth identity login from repository authorization and audit denial paths.

### Task to Acceptance Criteria Traceability

- `AC1`: Implement GitHub App connection/update flow with read-only permissions and authorized repo selection.
- `AC2`: Persist RepositoryConnection metadata without exposing raw tokens.
- `AC3`: Separate OAuth identity login from repository authorization and audit denial paths.

### Dependencies and Prerequisites

- Epic 1 auth boundary and Epic 2 assessment context.
- PBAC scope for Manager or scoped Developer.

### Explicit Non-Goals

- No write access or mutation permissions.
- No source scan before connection validation.
- No treating OAuth login as repository authorization.

### Story-Specific Risks and Edge Cases

- Raw token leakage in logs/UI.
- Wrong-organization repo selected.
- Identity login accidentally grants repository scope.

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
- Source packet: `docs/developer/story-handbook/3-1-connect-read-only-github-repository.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/3-1-connect-read-only-github-repository.md
