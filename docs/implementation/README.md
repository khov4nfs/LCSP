# LCSP Implementation Documents

## Purpose

Active BUILD layer for the A-to-Z runnable MVP. These documents describe how the planned system will be built, configured, and verified after implementation readiness is certified.

## Current Authority Boundary

```text
CONSOLIDATION_PASS_APPLIED
SCANNER_BEHAVIOR_AUTHORITY_CONSOLIDATED
CHROMADB_VECTORLESS_DOMAIN_CONTRACT_ALIGNED
UX_ARTIFACT_REMOVED_FROM_ACTIVE_DOC_SET
STORY_TRACEABILITY_CREATED
IMPLEMENTATION_READINESS_READY_FOR_SPRINT_PLANNING_REVIEW
IMPLEMENTATION_NOT_AUTHORIZED_BY_READINESS_ALONE
```

Implementation documents are build specifications, not evidence that application code exists.

## Active Documents

| File | Purpose |
|---|---|
| `backend-implementation.md` | NestJS API, auth, RBAC, GitHub App, automatic trusted scan initiation, orchestration, audit, and local backend behavior |
| `persistence-implementation.md` | PostgreSQL/Prisma metadata, ChromaDB legal index references, object metadata, retention, and migration order |
| `queue-implementation.md` | RabbitMQ topology, outbox, retry, idempotency, and worker choreography |
| `scanner-implementation.md` | Cross-runtime scanner build boundary and package structure |
| `python-worker-platform-implementation.md` | Shared Python Worker Platform runtime, queue, idempotency, audit, lifecycle and observability contracts |
| `scanner-worker-implementation.md` | Scanner worker toolchain, scan lifecycle, and TS/JS subprocess integration |
| `legal-corpus-ingestion-implementation.md` | Official-source ingestion, snapshot/hash provenance, normalization, and approval handoff |
| `chromadb-vectorless-legal-retriever-implementation.md` | ChromaDB vectorless legal retrieval, hierarchy/xref assembly, citation allowlist, privacy, and retrieval audit |
| `llm-gateway-implementation.md` | Real provider boundary, privacy, schema validation, retries, budget controls, and model-run metadata |
| `dev-compendium.md` | Developer-facing consolidated guide across implementation specs, task catalog, sprint artifacts, and project context |
| `phase-5-2l-ux-to-readiness-execution-plan.md` | Coordination plan from pruned authority set to UX, epics/stories, readiness, and sprint planning |
| `phase-5-2l-ux-to-readiness-task-list.md` | Actionable pre-implementation task board for UX rebase, story creation, readiness, and sprint planning gates |
| `phase-5-2l-ux-to-readiness-implementation-guide.md` | Fresh-context handoff guide for BMAD planning sessions before implementation is authorized |
| `decisions/` | RBAC, trusted trigger, scanner severity/provenance decision artifacts |
| `readiness/` | Implementation-readiness assessment and state-transition authority for planning and sprint-review handoff |
| `templates/` | Reusable implementation task, engineering handoff, and operational runbook templates |
| `tasks/` | Stable implementation task catalog plus detailed task briefs |
| `handoffs/` | Domain and wave handoff packets for implementation planning |
| `runbooks/` | Operational runbook drafts for runtime failure and recovery behavior |

## Read Order for BMAD Planning

1. `../README.md`
2. `../product/system-context.md`
3. `../product/product-brief.md`
4. `../specs/requirements-traceability-summary.md`
5. `dev-compendium.md`
6. `phase-5-2l-ux-to-readiness-execution-plan.md`
7. `phase-5-2l-ux-to-readiness-task-list.md`
8. `phase-5-2l-ux-to-readiness-implementation-guide.md`

## Read Order by Workstream

### Implementation Planning Tasks and Handoffs

1. `../implementation-delivery-plan.md`
2. `../planning-artifacts/research/technical-implementation-task-and-engineering-handoff-templates-for-lcsp-research-2026-06-25.md`
3. `templates/implementation-task-template.md`
4. `templates/engineering-handoff-template.md`
5. `templates/operational-runbook-template.md`
6. `tasks/README.md`
7. `handoffs/README.md`
8. `decisions/rbac-runtime-decision.md`
9. `decisions/trusted-scan-trigger-retry-dlq-replay-decision.md`
10. `decisions/scanner-severity-tool-provenance-decision.md`
11. `readiness/implementation-readiness-report-2026-06-25.md`
12. `readiness/state-transition-authority.md`

### Scanner

1. `../specs/scanner-spec.md`
2. `../specs/domain-state-machines.md`
3. `../specs/event-catalog.md`
4. `scanner-implementation.md`
5. `scanner-worker-implementation.md`
6. `python-worker-platform-implementation.md`
7. `persistence-implementation.md`
8. `queue-implementation.md`
9. `tasks/MW-scan-001-scan-request-status-api.md`
10. `tasks/MW-pyp-001-python-worker-bootstrap-queue-idempotency.md`
11. `tasks/MW-scan-py-001-scanner-workspace-snapshot-cleanup-security.md`
12. `tasks/MW-scan-py-004-technical-evidence-report-gates.md`
13. `tasks/MW-intel-001-python-technical-profile-worker.md`
14. `handoffs/HANDOFF-scanner-evidence-to-technical-profile.md`

### TechnicalProfile, AIUsageFlow, and Reconciliation

1. `../planning-artifacts/epics.md`
2. `../specs/ai-usage-flow-domain-spec.md`
3. `../specs/domain-state-machines.md`
4. `python-worker-platform-implementation.md`
5. `persistence-implementation.md`
6. `queue-implementation.md`
7. `tasks/MW-intel-001-python-technical-profile-worker.md`
8. `tasks/MW-intel-002-python-ai-usage-flow-worker.md`
9. `tasks/MW-intel-004-python-reconciliation-verified-profile-worker.md`
10. `handoffs/HANDOFF-ai-usage-flow-and-reconciliation.md`

### Legal Corpus and Retrieval

1. `../specs/legal-corpus-source-spec.md`
2. `../specs/legal-matching-domain-spec.md`
3. `legal-corpus-ingestion-implementation.md`
4. `chromadb-vectorless-legal-retriever-implementation.md`
5. `persistence-implementation.md`
6. `queue-implementation.md`

### LLM and Reporting

1. `llm-gateway-implementation.md`
2. `../specs/legal-classification-spec.md`
3. `../specs/document-generation-spec.md`
4. `backend-implementation.md`
5. `persistence-implementation.md`
6. `queue-implementation.md`

## Locked MVP Runtime Decisions

- Python Worker is the sole Repository Scan lifecycle owner.
- Python Worker Platform owns all asynchronous domain workloads.
- Scanner uses Syft, Knip, deptry, `ast` + `libcst`, Semgrep custom rules, tree-sitter/custom parser and Poetry.
- TS/JS analysis uses a fixed Node subprocess with JSON stdio.
- Real configured LLM provider is mandatory for A-to-Z acceptance; embedding provider is not required for legal retrieval MVP.
- Mock LLM is tests/offline development only.
- Legal corpus uses validated official-source snapshots, approval gate, immutable versioning, ChromaDB vectorless retrieval, legal hierarchy/xref assembly, and citation allowlist validation.
- Real S3-compatible object storage is required for A-to-Z acceptance.

## Internal Operations Boundary

Legal source validation, corpus review/approval, and index build are internal API/CLI operations for MVP. They are not Manager/Developer product UX screens.

## Non-Claims

- Not production deployment authorization.
- Not completed implementation readiness.
- Not legal validation or compliance certification.
- Not proof that code, tests, CI/CD, or infrastructure exist.
