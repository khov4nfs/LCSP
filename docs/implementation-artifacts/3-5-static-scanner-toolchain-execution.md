---
baseline_commit: 98f34e2598d781ab58157344757280203e116fd3
---

# Story 3.5: Static Scanner Toolchain Execution

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Static Scanner Toolchain Execution

## Acceptance Criteria

1. **Given** a RepositoryScanJob is locked in a restricted workspace
   **When** scanner execution starts
   **Then** LCSP runs approved bounded static analysis tools including Syft, Knip, deptry, Python `ast`/`libcst`, `ts-morph`, tree-sitter/custom parser, and Semgrep as applicable by repository language profile
   **And** records tool versions, config hash, ruleset hash, start/end time, language profile, and coverage limitations.

2. **Given** a repository language profile does not support a tool
   **When** the scanner builds the execution plan
   **Then** LCSP skips the unsupported tool with an explicit coverage limitation
   **And** does not treat the skip as successful evidence for that capability.

## Tasks / Subtasks

- [x] Build language-profile-aware execution plan for approved static tools. (AC: 1)
- [x] Record tool versions, config hash, ruleset hash and coverage limitations per run. (AC: 2)
- [x] Skip unsupported tools explicitly instead of treating absence as success. (AC: 2)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `3-5-static-scanner-toolchain-execution`
- Official execution artifact: `docs/implementation-artifacts/3-5-static-scanner-toolchain-execution.md`
- Epic: `Epic 3 - Trusted Repository Evidence and TechnicalProfile`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`

### Current State and Scope Guardrails

- Epic 3 là bridge từ assessment sang trusted technical evidence. Đây là boundary dễ phá privacy nhất nếu implementation lỏng tay.
- Story trong epic này phải giữ scanner là static-analysis only và không được kéo scan execution vào web request lifecycle.
- Handoff chính của epic là `RepositorySnapshot`, `TechnicalEvidenceReport`, rồi `TechnicalProfile`; ba artifact này phải giữ boundary rõ.

- Previous story context: `docs/developer/story-handbook/3-4-static-scanner-workspace-and-sandbox.md`
- Next story dependency seam: `docs/developer/story-handbook/3-6-scan-failure-severity-and-evidence-acceptance-policy.md`
- Artifact chain for this epic: repository connection -> commit-pinned snapshot -> trusted scan trigger -> scanner execution -> TechnicalEvidenceReport -> TechnicalProfile.
- Workflow/state focus: repository/snapshot/scan/evidence/profile states from REPOSITORY_CONNECTED to TECHNICAL_PROFILE_READY.

### Story-Specific Implementation Tasks

- Build language-profile-aware execution plan for approved static tools.
- Record tool versions, config hash, ruleset hash and coverage limitations per run.
- Skip unsupported tools explicitly instead of treating absence as success.

### Task to Acceptance Criteria Traceability

- `AC1`: Build language-profile-aware execution plan for approved static tools.
- `AC2`: Record tool versions, config hash, ruleset hash and coverage limitations per run.
- `AC2`: Skip unsupported tools explicitly instead of treating absence as success.

### Dependencies and Prerequisites

- Story 3.4 restricted workspace.
- Pinned toolchain and language-profile metadata.

### Explicit Non-Goals

- No unapproved tools or dynamic installs.
- No semantic conclusion from skipped tool.
- No long-running unbounded analysis outside resource policy.

### Story-Specific Risks and Edge Cases

- Unsupported tool treated as positive evidence.
- Tool provenance not captured for downstream trust.
- Execution plan exceeds bounded resource policy.

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

### Implementation Plan

- Task 1: derive a deterministic repository language profile from bounded file classifications, then build an allowlisted RUN/SKIP plan for Syft, Knip, deptry, Python AST/libcst, ts-morph, tree-sitter/custom parsing, and Semgrep.
- Task 2: capture immutable per-run provenance at each execution boundary and serialize version/hash/time/language/limitation metadata into the redacted scan callback; replace the AST fallback with pinned real `libcst` execution.
- Task 3: short-circuit unsupported tools at the execution-plan boundary, persist non-evidentiary skip provenance, and propagate explicit coverage limitations/partial callback state without invoking the unsupported runtime.

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/3-5-static-scanner-toolchain-execution.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.
- Task 1 complete: added deterministic language-profile-aware planning, basic-signal language classification, and unit/routing coverage; full Python worker regression suite passes (330 passed, 5 skipped).
- Task 2 complete: added end-to-end tool provenance, real pinned `libcst` parsing, failure-safe structural provenance, callback integration coverage, static compilation, and a passing full regression suite (333 passed, 5 skipped).
- Task 3 complete: unsupported tools are not invoked, skips are `skipped_unsupported` and `evidence_eligible: false`, basic-only/Python/TS inverse routing is covered, and the full regression suite passes (336 passed, 5 skipped).
- Story definition of done complete: all acceptance criteria and tasks are satisfied; static compilation and `git diff --check` pass; final full regression suite passes (336 passed, 5 skipped).

### File List

- docs/implementation-artifacts/3-5-static-scanner-toolchain-execution.md
- docs/implementation-artifacts/sprint-status.yaml
- deepagents/tools/graph/scanner/inventory/language_classifier.py
- deepagents/tools/graph/scanner/inventory/language_types.py
- deepagents/tools/graph/scanner/evidence_assembler.py
- deepagents/tools/graph/scanner/parsers/python_cst_parser.py
- deepagents/tools/graph/scanner/scan_consumer.py
- deepagents/tools/graph/scanner/tool_registry.py
- deepagents/tools/graph/scanner/toolchain_execution.py
- deepagents/tools/graph/scanner/tools/tool_base.py
- deepagents/pyproject.toml
- deepagents/tests/scanner/test_toolchain_execution_plan.py
- deepagents/tests/test_evidence_assembler.py
- deepagents/tests/test_language_classifier.py
- deepagents/tests/test_scanner_analyzer.py
- deepagents/tests/test_scanner_workspace.py

## Change Log

- 2026-08-11: Implemented language-profile-aware bounded scanner toolchain execution, complete per-run provenance, real pinned `libcst`, and explicit non-evidentiary unsupported-tool skips; moved story to `review`.
