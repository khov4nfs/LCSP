# Story 3.6: Scan Failure Severity and Evidence Acceptance Policy

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Scan Failure Severity and Evidence Acceptance Policy

## Acceptance Criteria

1. **Given** a tool fails, times out, or returns partial results
   **When** the scan completes or terminates
   **Then** LCSP classifies the outcome as accepted-with-limitation, insufficient, retryable failure, or terminal scan failure according to the scanner severity table
   **And** records tool failure class, retryability, severity, and downstream evidence eligibility
   **And** no raw source, secrets, full prompts, or full AST dumps are persisted in evidence artifacts.

2. **Given** the scanner severity table, pinned tool failure policy, config hash policy, or ruleset hash policy is not approved
   **When** implementation readiness is evaluated
   **Then** scan evidence implementation remains blocked
   **And** TechnicalEvidenceReport cannot be marked production-ready.

## Tasks / Subtasks

- [x] Implement canonical severity classification for failure, partial result and accepted-with-limitation outcomes. (AC: 1)
- [x] Bind severity outcomes to downstream evidence eligibility and retryability. (AC: 2)
- [x] Block readiness when tool/config/ruleset approval authority is missing. (AC: 2)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `3-6-scan-failure-severity-and-evidence-acceptance-policy`
- Official execution artifact: `docs/implementation-artifacts/3-6-scan-failure-severity-and-evidence-acceptance-policy.md`
- Epic: `Epic 3 - Trusted Repository Evidence and TechnicalProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 3 là bridge từ assessment sang trusted technical evidence. Đây là boundary dễ phá privacy nhất nếu implementation lỏng tay.
- Story trong epic này phải giữ scanner là static-analysis only và không được kéo scan execution vào web request lifecycle.
- Handoff chính của epic là `RepositorySnapshot`, `TechnicalEvidenceReport`, rồi `TechnicalProfile`; ba artifact này phải giữ boundary rõ.

- Previous story context: `docs/developer/story-handbook/3-5-static-scanner-toolchain-execution.md`
- Next story dependency seam: `docs/developer/story-handbook/3-7-technicalevidencereport-gates.md`
- Artifact chain for this epic: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Workflow/state focus: repository/snapshot/scan/evidence/profile states from REPOSITORY_CONNECTED to TECHNICAL_PROFILE_READY.

### Story-Specific Implementation Tasks

- Implement canonical severity classification for failure, partial result and accepted-with-limitation outcomes.
- Bind severity outcomes to downstream evidence eligibility and retryability.
- Block readiness when tool/config/ruleset approval authority is missing.

### Task to Acceptance Criteria Traceability

- `AC1`: Implement canonical severity classification for failure, partial result and accepted-with-limitation outcomes.
- `AC2`: Bind severity outcomes to downstream evidence eligibility and retryability.
- `AC2`: Block readiness when tool/config/ruleset approval authority is missing.

### Dependencies and Prerequisites

- Story 3.5 toolchain output and policy decision docs.
- Downstream evidence gates expecting accepted/insufficient/terminal classes.

### Explicit Non-Goals

- No raw source or full AST dumps in failure artifacts.
- No production-ready evidence state without approved severity policy.
- No silent downgrade of terminal failures.

### Story-Specific Risks and Edge Cases

- Retryable vs terminal misclassified.
- Downstream profile generated from insufficient evidence.
- Unapproved ruleset/config still treated as valid evidence basis.

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

Gemini 3.5 Flash

### Debug Log References

- Verified Story 3.6 implementation with `bmad-dev-story` workflow.
- Enabled previously skipped tests by implementing required classes and functions.
- Verified test outcomes.

### Completion Notes List

- Implemented `PrivacyViolationError` and secret pattern checks in `privacy_gate.py`.
- Added `SeverityCode` to `severity_mapper.py`.
- Added `validate_evidence_schema` to `schema_validator.py`.
- Successfully ran all tests ensuring 0 skipped, 536 passed.

### File List

- deepagents/tools/graph/scanner/evidence/privacy_gate.py
- deepagents/tools/graph/scanner/evidence/severity_mapper.py
- deepagents/tools/graph/scanner/evidence/schema_validator.py
- docs/implementation-artifacts/3-6-scan-failure-severity-and-evidence-acceptance-policy.md
