# Story 3.2: Pin Commit and Create RepositorySnapshot

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or scoped Developer, I want to pin a branch or commit snapshot, so that all scan evidence is tied to an immutable repository state.

## Acceptance Criteria

1. **Given** a valid RepositoryConnection exists
   **When** the actor selects a branch, ref, or commit for scan
   **Then** LCSP resolves and records immutable RepositorySnapshot metadata including repository ID, ref, commit SHA, provider metadata, actor, timestamp, and assessment ID
   **And** downstream scan jobs reference the snapshot instead of mutable branch state
   **And** the Manager can pin the snapshot without assigning a Developer.

2. **Given** the requested ref or commit cannot be resolved, is outside connection scope, or provider validation fails
   **When** the actor attempts to create a snapshot
   **Then** LCSP blocks snapshot creation with a safe explanation
   **And** no scan job is queued
   **And** the failure is audited.

3. **Given** source files are temporarily materialized for scan
   **When** the snapshot operation completes or fails
   **Then** LCSP retains only approved metadata and evidence artifacts
   **And** raw source is not persisted long-term outside the restricted scanner workspace.

## Tasks / Subtasks

- [x] Resolve branch/ref/commit into immutable RepositorySnapshot metadata tied to assessment. (AC: 1)
- [x] Ensure downstream scan references snapshot ID rather than mutable branch head. (AC: 2)
- [x] Enforce cleanup and no long-term raw source persistence after snapshot operations. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `3-2-pin-commit-and-create-repositorysnapshot`
- Official execution artifact: `docs/implementation-artifacts/3-2-pin-commit-and-create-repositorysnapshot.md`
- Epic: `Epic 3 - Trusted Repository Evidence and TechnicalProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 3 là bridge từ assessment sang trusted technical evidence. Đây là boundary dễ phá privacy nhất nếu implementation lỏng tay.
- Story trong epic này phải giữ scanner là static-analysis only và không được kéo scan execution vào web request lifecycle.
- Handoff chính của epic là `RepositorySnapshot`, `TechnicalEvidenceReport`, rồi `TechnicalProfile`; ba artifact này phải giữ boundary rõ.

- Previous story context: `docs/developer/story-handbook/3-1-connect-read-only-github-repository.md`
- Next story dependency seam: `docs/developer/story-handbook/3-3-trusted-scan-trigger-and-scan-job-orchestration.md`
- Artifact chain for this epic: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Workflow/state focus: repository/snapshot/scan/evidence/profile states from REPOSITORY_CONNECTED to TECHNICAL_PROFILE_READY.

### Story-Specific Implementation Tasks

- Resolve branch/ref/commit into immutable RepositorySnapshot metadata tied to assessment.
- Ensure downstream scan references snapshot ID rather than mutable branch head.
- Enforce cleanup and no long-term raw source persistence after snapshot operations.

### Task to Acceptance Criteria Traceability

- `AC1`: Resolve branch/ref/commit into immutable RepositorySnapshot metadata tied to assessment.
- `AC2`: Ensure downstream scan references snapshot ID rather than mutable branch head.
- `AC3`: Enforce cleanup and no long-term raw source persistence after snapshot operations.

### Dependencies and Prerequisites

- Story 3.1 valid RepositoryConnection.
- Provider metadata and assessment scope validation.

### Explicit Non-Goals

- No scan queue creation on unresolved refs.
- No long-term raw source store.
- No mutable branch-as-evidence behavior.

### Story-Specific Risks and Edge Cases

- Snapshot points to mutable ref rather than commit SHA.
- Out-of-scope ref accepted.
- Temporary source materialization persists beyond allowed workspace.

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
- Source packet: `docs/developer/story-handbook/3-2-pin-commit-and-create-repositorysnapshot.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Implemented `POST /assessments/:assessmentId/snapshots` with RBAC assessment scope enforcement and safe error codes.
- Added per-request GitHub App installation token creation, immutable commit resolution, and repository-scope validation without persisting credentials or raw source.
- Added atomic RepositorySnapshot/outbox persistence plus success and failure audit events.
- Added unit and E2E coverage; API build, typecheck, lint, import policy, and contract-literal checks pass.
- Status set to `review` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/3-2-pin-commit-and-create-repositorysnapshot.md
- docs/implementation-artifacts/sprint-status.yaml
- docs/implementation/tasks/modules/github-integration/03-pin-commit-snapshot-endpoint.md
- apps/api/.env.test
- apps/api/prisma/migrations/20260718120000_add_repository_snapshot/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/src/config/config.spec.ts
- apps/api/src/config/config.ts
- apps/api/src/config/config.types.ts
- apps/api/src/modules/github-integration/application/commands/github-app-callback/github-app-callback.handler.spec.ts
- apps/api/src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.command.ts
- apps/api/src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.handler.spec.ts
- apps/api/src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.handler.ts
- apps/api/src/modules/github-integration/application/contracts/github-integration/pin-snapshot.contract.ts
- apps/api/src/modules/github-integration/application/ports/persistence/repository-connection.repository.ts
- apps/api/src/modules/github-integration/application/ports/persistence/repository-snapshot.repository.ts
- apps/api/src/modules/github-integration/domain/entities/repository-snapshot.entity.ts
- apps/api/src/modules/github-integration/github-integration.module.ts
- apps/api/src/modules/github-integration/infrastructure/github/github-app.client.spec.ts
- apps/api/src/modules/github-integration/infrastructure/github/github-app.client.ts
- apps/api/src/modules/github-integration/infrastructure/persistence/prisma-github-integration.repository.ts
- apps/api/src/modules/github-integration/infrastructure/persistence/prisma-repository-snapshot.repository.spec.ts
- apps/api/src/modules/github-integration/infrastructure/persistence/prisma-repository-snapshot.repository.ts
- apps/api/src/modules/github-integration/presentation/http/dto/pin-snapshot.request.ts
- apps/api/src/modules/github-integration/presentation/http/github-integration.controller.spec.ts
- apps/api/src/modules/github-integration/presentation/http/github-integration.controller.ts
- apps/api/test/pin-commit-snapshot.e2e-spec.ts
- apps/api/test/support/auth-workspace-test-helpers.ts
- packages/contracts/src/github-integration/codes.ts
- packages/contracts/src/github-integration/events.ts
- packages/contracts/src/github-integration/statuses.ts
- packages/contracts/src/rbac/actions.ts
