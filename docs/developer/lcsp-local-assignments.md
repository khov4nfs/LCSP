# LCSP Local Assignments

Local-only assignment plan generated from `docs/implementation/tasks/modules` via Jira import artifacts.

## Team Roster

| Assignee | Name | Jira Email | GitHub Username |
|---|---|---|---|
| Khovan | Phan Nguyễn Quốc Minh (leader, PM) | minhpnq1807@gmail.com | khovan123 |
| nhibao08 | Lê Bảo Nhi | lebaonhi0805@gmail.com | nhibao08 |
| Nta1210 | Nguyễn Tuấn Anh | anhkn7@gmail.com | Nta1210 |
| DthuyInk | Trần Nguyễn Đăng Thụy | trannguyendangthuy120701@gmail.com | DthuyInk |
| anhtunguyen05 | Nguyễn Anh Tú | anhtunguyen643@gmail.com | anhtunguyen05 |

## Rules

- `Khovan` owns the critical/main flow and integration seams.
- `nhibao08`, `Nta1210`, `DthuyInk`, `anhtunguyen05` rotate across every module (auth, web, wizard, scanner, legal RAG, reconciliation, classification, reporting, audit, etc.) so no single module has one fixed owner and everyone builds context on the whole system.
- Within a module, pipeline-adjacent tasks are kept in contiguous segments (max 5 tasks) rather than interleaved task-by-task, so a dependent chain of steps stays with one person instead of forcing a handoff after every single task.
- Segments are bin-packed onto whichever rotating member currently carries the least load, so total workload stays balanced across the 4 members even though segment sizes vary.
- Rotation and balancing are computed by `scripts/generate-local-assignments.mjs`; re-run it whenever `jira-lcsp-tasks-import.csv` changes.

## Summary

| Assignee | Role | Total | P0 | P1 | Done | Ready | Main Flow |
|---|---|---:|---:|---:|---:|---:|---:|
| Khovan | Main flow lead / backend orchestration | 26 | 23 | 3 | 0 | 26 | 26 |
| nhibao08 | Rotating contributor across all modules | 16 | 14 | 2 | 0 | 16 | 0 |
| Nta1210 | Rotating contributor across all modules | 16 | 15 | 1 | 3 | 13 | 0 |
| DthuyInk | Rotating contributor across all modules | 16 | 10 | 6 | 3 | 13 | 0 |
| anhtunguyen05 | Rotating contributor across all modules | 16 | 11 | 5 | 1 | 15 | 0 |

## Tasks By Assignee

### anhtunguyen05 - Rotating contributor across all modules (16)

- `LCSP-70` `MW-auth-007`: Update Profile Endpoint (auth-workspace, Story 1.2, P0, DONE, support)
- `LCSP-71` `MW-auth-008`: OAuth/OIDC Start Endpoint (auth-workspace, Story 1.3, P0, READY_FOR_DEV, support)
- `LCSP-72` `MW-auth-009`: OAuth/OIDC Callback Endpoint (auth-workspace, Story 1.3, P0, READY_FOR_DEV, support)
- `LCSP-94` `MW-outbox-003`: DLQ Handler — Dead Letter Queue Management (platform/outbox, Story 2.1, P1, READY_FOR_DEV, support)
- `LCSP-99` `MW-cls-py-001`: Classification Worker (python-workers/classification, Story 6.2, P0, SUPERSEDED_FOR_ACTIVE_MVP, support)
- `LCSP-105` `MW-llm-001`: LLM Gateway Client (python-workers/llm, Story 4.1, P0, READY_FOR_DEV, support)
- `LCSP-110` `MW-rep-001`: Gap Analysis Report Worker (python-workers/reporting, Story 8.1, P1, READY_FOR_DEV, support)
- `LCSP-111` `MW-rep-002`: Final Report Worker (python-workers/reporting, Story 8.3, P1, READY_FOR_DEV, support)
- `LCSP-112` `MW-rep-003`: Audit Export Worker (python-workers/reporting, Story 8.7, P1, READY_FOR_DEV, support)
- `LCSP-122` `MW-scan-py-010`: Decision Flow Tracer (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-123` `MW-scan-py-011`: Evidence Graph Assembler (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-124` `MW-scan-py-012`: Schema, Privacy, and Quality Gates (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-137` `MW-scan-003`: Re-Run Scan Endpoint (scan, Story 3.3, P1, READY_FOR_DEV, support)
- `LCSP-144` `MW-wiz-001`: Save Wizard Draft Endpoint (wizard, Story 2.2, P0, READY_FOR_DEV, support)
- `LCSP-145` `MW-wiz-002`: Submit Wizard Endpoint (wizard, Story 2.2, P0, READY_FOR_DEV, support)
- `LCSP-146` `MW-wiz-003`: Wizard Readiness State Endpoint (wizard, Story 2.3, P0, READY_FOR_DEV, support)

### DthuyInk - Rotating contributor across all modules (16)

- `LCSP-67` `MW-auth-004`: MFA Verify OTP Endpoint (auth-workspace, Story 1.2, P0, DONE, support)
- `LCSP-68` `MW-auth-005`: Session Revoke Endpoint (auth-workspace, Story 1.2, P0, DONE, support)
- `LCSP-69` `MW-auth-006`: Get Workspace Endpoint (auth-workspace, Story 1.4, P0, DONE, support)
- `LCSP-80` `MW-doc-001`: Generate Gap Analysis Document (document, Story 8.1, P1, READY_FOR_DEV, support)
- `LCSP-81` `MW-doc-002`: Generate Final Report Document (document, Story 8.3, P1, READY_FOR_DEV, support)
- `LCSP-104` `MW-legal-001`: ChromaDB Legal Retrieval Worker (python-workers/legal, Story 6.1, P0, SUPERSEDED_FOR_ACTIVE_MVP, support)
- `LCSP-109` `MW-pyp-004`: Worker Health Check HTTP Server (python-workers/platform, Story 1.1, P1, READY_FOR_DEV, support)
- `LCSP-113` `MW-scan-py-001`: Scanner Workspace Setup and Materialization (python-workers/scanner, Story 3.4, P0, READY_FOR_DEV, support)
- `LCSP-114` `MW-scan-py-002`: Syft SBOM Tool Wrapper (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-115` `MW-scan-py-003`: Semgrep AI Usage Rules Tool (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-125` `MW-scan-py-013`: Manifest and Configuration Parser (Pipeline Step 5) (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-126` `MW-scan-py-014`: Language Classifier and Analyzer Router (Pipeline Step 8) (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-127` `MW-scan-py-015`: Tree-sitter Structural Augmentation (Pipeline Step 11) (python-workers/scanner, Story 3.5, P1, READY_FOR_DEV, support)
- `LCSP-141` `MW-web-004`: Conflict Resolution Page (web, Story 5.3, P0, READY_FOR_DEV, support)
- `LCSP-142` `MW-web-005`: Classification Status Page (web, Story 7.3, P1, READY_FOR_DEV, support)
- `LCSP-143` `MW-web-006`: Document Download Page (web, Story 7.3, P1, READY_FOR_DEV, support)

### Khovan - Main flow lead / backend orchestration (26)

- `LCSP-2` `MW-aiuf-001`: AIUsageFlow Callback Endpoint (ai-usage-flow, Story 4.2, P0, READY_FOR_DEV, main-flow)
- `LCSP-59` `MW-asmt-001`: Create Assessment Endpoint (assessment, Story 2.1, P0, READY_FOR_DEV, main-flow)
- `LCSP-60` `MW-asmt-002`: Get Assessment Endpoint (assessment, Story 2.3, P0, READY_FOR_DEV, main-flow)
- `LCSP-61` `MW-asmt-003`: List Assessments Endpoint (assessment, Story 2.1, P0, READY_FOR_DEV, main-flow)
- `LCSP-78` `MW-cls-001`: LegalRuleMatch Callback Endpoint (classification, Story 6.7, P0, SUPERSEDED_FOR_ACTIVE_MVP, main-flow)
- `LCSP-79` `MW-cls-002`: Classification Result Callback Endpoint (classification, Story 7.5, P0, SUPERSEDED_FOR_ACTIVE_MVP, main-flow)
- `LCSP-82` `MW-doc-003`: Get Document Status and Download Endpoint (document, Story 7.3, P1, READY_FOR_DEV, main-flow)
- `LCSP-83` `MW-evid-001`: Get Technical Evidence Report Endpoint (evidence, Story 3.5, P0, READY_FOR_DEV, main-flow)
- `LCSP-84` `MW-evid-002`: TechnicalProfile Callback Endpoint (evidence, Story 3.6, P0, READY_FOR_DEV, main-flow)
- `LCSP-85` `MW-gh-001`: GitHub App OAuth Start Endpoint (github-integration, Story 3.1, P0, READY_FOR_DEV, main-flow)
- `LCSP-86` `MW-gh-002`: GitHub App Callback Endpoint (github-integration, Story 3.1, P0, READY_FOR_DEV, main-flow)
- `LCSP-87` `MW-gh-003`: Pin Commit Snapshot Endpoint (github-integration, Story 3.2, P0, READY_FOR_DEV, main-flow)
- `LCSP-88` `MW-gh-004`: Scan Trigger Endpoint (github-integration, Story 3.3, P0, READY_FOR_DEV, main-flow)
- `LCSP-89` `MW-audit-001`: Audit Event Schema — Prisma + Domain Types (platform/audit-writer, Story 1.8, P0, READY_FOR_DEV, main-flow)
- `LCSP-90` `MW-audit-002`: Audit Writer Service (platform/audit-writer, Story 1.8, P0, READY_FOR_DEV, main-flow)
- `LCSP-91` `MW-cfg-001`: Config Loader — NestJS ConfigModule Bootstrap (platform/config, Story 1.1, P0, READY_FOR_DEV, main-flow)
- `LCSP-92` `MW-outbox-001`: Outbox Model — Prisma Schema (platform/outbox, Story 2.1, P0, READY_FOR_DEV, main-flow)
- `LCSP-93` `MW-outbox-002`: Outbox Publisher — Poller + RabbitMQ Relay (platform/outbox, Story 2.1, P0, READY_FOR_DEV, main-flow)
- `LCSP-95` `MW-rbac-001`: RBAC Policy Model — Prisma Schema + Types (platform/rbac, Story 1.6, P0, READY_FOR_DEV, main-flow)
- `LCSP-96` `MW-rbac-002`: RBAC Evaluator Service (platform/rbac, Story 1.6, P0, READY_FOR_DEV, main-flow)
- `LCSP-97` `MW-rbac-003`: RBAC NestJS Guard (platform/rbac, Story 1.6, P0, READY_FOR_DEV, main-flow)
- `LCSP-98` `MW-rbac-004`: RBAC Worker Preflight — Python Worker Authorization Check (platform/rbac, Story 1.7, P1, READY_FOR_DEV, main-flow)
- `LCSP-130` `MW-qa-003`: E2E Manager Golden Path Test (qa, Story 2.1, P1, READY_FOR_DEV, main-flow)
- `LCSP-131` `MW-rec-001`: Conflict Detection Callback Endpoint (reconciliation, Story 5.1, P0, READY_FOR_DEV, main-flow)
- `LCSP-135` `MW-scan-001`: Scan Job Status Endpoint (scan, Story 3.3, P0, READY_FOR_DEV, main-flow)
- `LCSP-136` `MW-scan-002`: Scan Job Callback Endpoint (scan, Story 3.3, P0, READY_FOR_DEV, main-flow)

### nhibao08 - Rotating contributor across all modules (16)

- `LCSP-62` `MW-aud-001`: List Audit Events Endpoint (audit, Story 8.6, P1, READY_FOR_DEV, support)
- `LCSP-63` `MW-aud-002`: Export Audit Trail Endpoint (audit, Story 8.7, P1, READY_FOR_DEV, support)
- `LCSP-73` `MW-auth-010`: Invite Developer Endpoint (auth-workspace, Story 1.5, P0, READY_FOR_DEV, support)
- `LCSP-74` `MW-auth-011`: Accept Developer Invitation Endpoint (auth-workspace, Story 1.5, P0, READY_FOR_DEV, support)
- `LCSP-75` `MW-auth-012`: Revoke Developer Membership Endpoint (auth-workspace, Story 1.5, P0, READY_FOR_DEV, support)
- `LCSP-100` `MW-intel-001`: TechnicalProfile Worker (python-workers/intelligence, Story 3.6, P0, DONE, support)
- `LCSP-101` `MW-intel-002`: AIUsageFlow Worker (python-workers/intelligence, Story 4.2, P0, DONE, support)
- `LCSP-102` `MW-intel-003`: Conflict Detection Worker (python-workers/intelligence, Story 5.1, P0, DONE, support)
- `LCSP-116` `MW-scan-py-004`: Evidence Report Assembly and Callback (python-workers/scanner, Story 3.5, P0, DONE, support)
- `LCSP-117` `MW-scan-py-005`: Knip + deptry Dependency Usage Analysis Tool (python-workers/scanner, Story 3.5, P0, DONE, support)
- `LCSP-118` `MW-scan-py-006`: Python AST/CST Analyzer (Bounded L0–L3) (python-workers/scanner, Story 3.5, P0, DONE, support)
- `LCSP-128` `MW-qa-001`: Auth Integration Test Suite (qa, Story 1.1, P0, READY_FOR_DEV, support)
- `LCSP-129` `MW-qa-002`: Python Scanner Unit Tests (qa, Story 3.5, P0, DONE, support)
- `LCSP-138` `MW-web-001`: Sign-In Page (web, Story 1.2, P0, READY_FOR_DEV, support)
- `LCSP-139` `MW-web-002`: Workspace Dashboard Page (web, Story 1.4, P0, READY_FOR_DEV, support)
- `LCSP-140` `MW-web-003`: Wizard Form Page (web, Story 2.2, P0, READY_FOR_DEV, support)

### Nta1210 - Rotating contributor across all modules (16)

- `LCSP-64` `MW-auth-001`: Sign-In Endpoint (auth-workspace, Story 1.1, P0, DONE, support)
- `LCSP-65` `MW-auth-002`: Register via Approved Path Endpoint (auth-workspace, Story 1.1, P0, DONE, support)
- `LCSP-66` `MW-auth-003`: MFA Enroll Endpoint (auth-workspace, Story 1.2, P0, DONE, support)
- `LCSP-76` `MW-auth-013`: RBAC Guard — NestJS Integration (auth-workspace, Story 1.6, P0, READY_FOR_DEV, support)
- `LCSP-77` `MW-auth-014`: Audit Event Writer — Auth Workspace Integration (auth-workspace, Story 1.8, P0, READY_FOR_DEV, support)
- `LCSP-103` `MW-intel-004`: VerifiedProfile Worker (python-workers/intelligence, Story 5.4, P0, SUPERSEDED_FOR_ACTIVE_MVP, support)
- `LCSP-106` `MW-pyp-001`: Python Worker Platform Bootstrap (python-workers/platform, Story 1.1, P0, READY_FOR_DEV, support)
- `LCSP-107` `MW-pyp-002`: Worker API Callback Client (python-workers/platform, Story 1.1, P0, READY_FOR_DEV, support)
- `LCSP-108` `MW-pyp-003`: Worker Secret Redaction Utility (python-workers/platform, Story 1.1, P0, READY_FOR_DEV, support)
- `LCSP-119` `MW-scan-py-007`: TS/JS Subprocess Bridge (ts-morph) (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-120` `MW-scan-py-008`: Semgrep Full AI Ruleset (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-121` `MW-scan-py-009`: AI Invocation Detector (Signal Fusion + 20 Finding Types + Confidence) (python-workers/scanner, Story 3.5, P0, READY_FOR_DEV, support)
- `LCSP-132` `MW-rec-002`: List Conflicts Endpoint (reconciliation, Story 5.2, P0, READY_FOR_DEV, support)
- `LCSP-133` `MW-rec-003`: Resolve Conflict Endpoint (reconciliation, Story 5.3, P0, READY_FOR_DEV, support)
- `LCSP-134` `MW-rec-004`: VerifiedProfile Callback Endpoint (reconciliation, Story 5.4, P0, SUPERSEDED_FOR_ACTIVE_MVP, support)
- `LCSP-147` `MW-wiz-004`: Wizard Readiness Export Endpoint (wizard, Story 2.4, P1, READY_FOR_DEV, support)
