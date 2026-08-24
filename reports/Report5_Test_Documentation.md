**Capstone Project Report**

**Report 5 – Software Test Documentation**

– [Institution / Organization Logo] –

**Table of Contents**

[I. Record of Changes 3](#_Toc83349279)

[II. Testing Documentation 4](#_Toc83349280)

[1. Scope of Testing 4](#_Toc83349281)

[2. Test Strategy 4](#_Toc83349282)

[2.1 Testing Types 4](#_Toc83349283)

[2.2 Test Levels 4](#_Toc83349284)

[2.3 Supporting Tools 4](#_Toc83349285)

[3. Test Plan 4](#_Toc83349286)

[3.1 Human Resources 4](#_Toc83349287)

[3.2 Test Environment 5](#_Toc83349288)

[3.3 Test Milestones 5](#_Toc83349289)

[4. Test Cases 5](#_Toc83349290)

[5. Test Reports 5](#_Toc83349291)

# I. Record of Changes

|  |  |  |  |
| --- | --- | --- | --- |
| Date | A\* M, D | In charge | Change Description |
| 2026-07-06 | A | Project Team | Initial authored version of Report 5, grounded in `docs/specs/acceptance-criteria-catalog.md` and `docs/test-artifacts/`. |
|  |  |  |  |
|  |  |  |  |

\*A - Added M - Modified D - Deleted

# II. Testing Documentation

## 1. Scope of Testing

Testing covers all 17 canonical use cases (UC-001..UC-017), the full functional requirement catalog (FR-001..FR-056), and the acceptance criteria catalog (AC-001..AC-041, plus Phase 5.2L AC-050A..AC-050F for automatic trusted scan initiation). Both the **happy path** (Manager completes an assessment end-to-end without Developer participation) and every **blocked/degraded/failed** state (missing evidence, unresolved conflict, missing legal citation, provider failure) are in scope, since LCSP's core design principle is to fail closed and expose an actionable reason rather than to silently succeed or overclaim.

**Out of scope for testing:** any surface tied to a removed or superseded requirement — structured technical attestation (`FR-045`/`FR-046`), manual technical evidence JSON upload (`FR-051`), delegated free-form clarification (`FR-052`), and customer-facing legal corpus administration (internal API/CLI only for MVP). These are explicitly excluded because they must not exist as active product surfaces; any test that finds them present is itself a defect.

**Constraints/assumptions:** Testing follows the 7-phase delivery schedule in Report 2 §1.1 — each phase's Epics are unit- and integration-tested as they land, rather than all at once at the end. Acceptance testing against the real LLM provider and real ChromaDB corpus can only begin once Phase 5 (legal corpus + classification) is complete, since mock-mode LLM output is explicitly not acceptance evidence (per `docs/architecture/architecture.md`).

## 2. Test Strategy

### 2.1 Testing Types

* **Unit Testing** — Objective: verify domain/application logic in isolation (state transitions, PBAC decision functions, evidence-gate rules). Technique: white-box, per NestJS module and per Python worker module. Completion criteria: ≥ 80% coverage of domain/application layers, all edge cases in `docs/specs/domain-state-machines.md` covered.
* **Integration Testing** — Objective: verify real (not mocked) integration points — PBAC policy engine, Queue Boundary event contracts, ChromaDB retrieval, Prisma/PostgreSQL persistence. Technique: contract tests against real infrastructure per NFR-021/NFR-024. Completion criteria: 100% of API/event contract endpoints exercised with both success and failure paths.
* **System Testing** — Objective: verify each canonical Use Case end-to-end through the full stack (Web → API → Queue → Workers → Persistence). Technique: black-box, scenario-driven from `docs/specs/user-task-flows.md`. Completion criteria: 100% of UC-001..UC-017 golden paths plus their documented failure states pass.
* **Acceptance Testing** — Objective: confirm the system satisfies the canonical Acceptance Criteria catalog (AC-001..AC-041, AC-050A..AC-050F) against a real LLM provider and real approved legal corpus. Technique: black-box, traceability-matrix-driven. Completion criteria: 100% of applicable ACs pass; a real-provider run (not mock mode) is required as acceptance evidence.
* **Security & Privacy Testing** — Objective: confirm PBAC deny-by-default enforcement, no raw source/secret leakage to LLM or logs, and scanner workspace isolation/cleanup. Technique: negative-path testing (unauthorized subject, cross-tenant access, secret-containing fixture). Completion criteria: 100% of NFR-001..NFR-015, NFR-035 verified.

### 2.2 Test Levels

| Type of Tests | Unit | Integration | System | Acceptance |
| --- | --- | --- | --- | --- |
| Domain/application logic (state machines, PBAC decisions) | X | X |  |  |
| Queue/event contracts, ChromaDB retrieval, persistence | | X | X |  |
| Canonical Use Cases (UC-001..UC-017) end-to-end | | | X | X |
| Acceptance Criteria (AC-001..AC-041, AC-050A..F) | | | X | X |
| Security/Privacy (PBAC, redaction, workspace cleanup) | X | X | X | X |

### 2.3 Supporting Tools

| Purpose | Tool | Vendor/In-house | Version |
| --- | --- | --- | --- |
| Backend unit/integration testing | Jest | Vendor (OpenJS Foundation) | Per `apps/api/package.json` |
| Python worker unit/integration testing | pytest | Vendor (open source) | Per `deepagents` |
| API contract testing | Supertest / NestJS testing utilities | Vendor (open source) | Per `apps/api` |
| Static-analysis toolchain validation (fixtures) | Syft, Knip, deptry, Semgrep | Vendor (open source) | Pinned per `scannerVersion`/`rulesetVersion` |
| Traceability & gate decisioning | Custom traceability matrix + gate-decision scripts | In-house | `docs/test-artifacts/traceability/` |
| CI orchestration | GitHub Actions | Vendor | N/A |

## 3. Test Plan

### 3.1 Human Resources

| **Worker/Doer** | **Role** | **Specific Responsibilities/Comments** |
| --- | --- | --- |
| [Technical Lead] | Test Architect | Owns test strategy, traceability matrix, and gate decisions across all phases. |
| [Backend Eng.] | Integration/System Tester | Owns API contract tests, PBAC decision tests, and Use Case system tests for `apps/api`. |
| [Python Eng.] | Integration/System Tester | Owns scanner toolchain fixtures, worker unit/integration tests, and ChromaDB retrieval tests. |
| [Frontend Eng.] | System Tester | Owns UI-level system tests for blocked/loading/degraded states per `docs/specs/user-task-flows.md`. |
| [Project Owner] | Acceptance Reviewer | Signs off each phase's acceptance-criteria pass before the next phase begins. |

### 3.2 Test Environment

| **Purpose** | **Tool** | **Provider** | **Version** |
| --- | --- | --- | --- |
| Backend runtime | NestJS | Vendor (open source) | Per `apps/api/package.json` |
| Worker runtime | Python | Vendor (open source) | Per `deepagents` |
| Database | PostgreSQL | Vendor (open source) | Per deployment config |
| Legal retrieval index | ChromaDB | Vendor (open source) | Per deployment config |
| CI environment | GitHub Actions runners | Vendor | Ubuntu LTS |
| LLM provider (acceptance only) | Configured real provider | Vendor | Per `docs/implementation/decisions/` |

### 3.3 Test Milestones

| **Milestone Task** | **Start Date** | **End Date** |
| --- | --- | --- |
| Phase 1–2 unit/integration tests (platform, auth, assessment) | 2026-07-06 | 2026-07-19 |
| Phase 3–4 system tests (repository, wizard, scanner pipeline) | 2026-07-20 | 2026-08-02 |
| Phase 5 integration tests (legal corpus, classification, real provider) | 2026-08-03 | 2026-08-09 |
| Phase 6 system tests (AIUsageFlow, reconciliation) | 2026-08-10 | 2026-08-16 |
| Phase 7 full acceptance pass (AC-001..AC-041, AC-050A..F) | 2026-08-17 | 2026-08-20 |

## 4. Test Cases

Detailed test cases are traced directly from the canonical catalogs rather than authored as a free-standing spreadsheet, so that every test case remains traceable to a stable ID as specs evolve:

* **Unit test cases** trace to `docs/specs/domain-state-machines.md` (state transition coverage) and `docs/specs/legal-matching-domain-spec.md` / `docs/specs/ai-usage-flow-domain-spec.md` (domain rule coverage per BR-XXX).
* **Integration/System/Acceptance test cases** trace to `docs/specs/acceptance-criteria-catalog.md` (AC-001..AC-041, AC-050A..AC-050F), each already mapped to its owning UC/FR/NFR. Representative examples:

| AC | Acceptance Outcome | UC | FR |
| --- | --- | --- | --- |
| AC-001 | Authorized Manager creates an owned, audited Assessment. | UC-003 | FR-013 |
| AC-004 | Authorized repository, snapshot, scan, and rerun stay in scope and preserve history. | UC-005,006,007,016 | FR-016,017,018,049 |
| AC-009 | Unclear critical usage remains unclear and blocks unsupported classification. | UC-009 | FR-025 |
| AC-014 | No unresolved conflict permits VerifiedProfile creation. | UC-011 | FR-030 |
| AC-017 | Blocked/degraded classification is explicit when citation is missing. | UC-012,013 | FR-034,036 |
| AC-019 | Final document requires classification, gap analysis, citations, and no conflict. | UC-014 | FR-039..FR-041 |
| AC-050A..F | Automatic trusted scan initiation covers webhook/scheduled/backend/Manager-triggered paths without mis-mapping repository or assessment. | UC-016 | FR-050 |

The full catalog (41 base ACs + 6 Phase 5.2L sub-criteria) is in `docs/specs/acceptance-criteria-catalog.md`; full traceability is maintained in `docs/specs/requirements-traceability-matrix.md` and `docs/test-artifacts/traceability/traceability-matrix.md`.

## 5. Test Reports

A gate-decision artifact (`docs/test-artifacts/gate-decision.json`) and traceability summary (`docs/test-artifacts/traceability/implementation-readiness-traceability-2026-06-25.md`) already exist as the canonical structured test-reporting mechanism for this project, recording pass/fail/blocked status per AC alongside an e2e trace summary (`docs/test-artifacts/e2e-trace-summary.json`). As each of the 7 delivery phases in Report 2 completes, its test results (unit/integration/system pass rates, defect counts by severity, and the phase's AC pass list) will be appended to these artifacts rather than to a separate static report, so that test status always reflects the current implementation rather than a point-in-time snapshot.
