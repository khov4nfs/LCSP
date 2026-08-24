**Capstone Project Report**

**Report 2 – Project Management Plan**

– [Institution / Organization Logo] –

**Table of Contents**

[I. Record of Changes 3](#_Toc83330363)

[II. Project Management Plan 4](#_Toc83330364)

[1. Overview 4](#_Toc83330365)

[1.1 Scope & Estimation 4](#_Toc83330366)

[1.2 Project Objectives 4](#_Toc83330367)

[1.3 Project Risks 4](#_Toc83330368)

[2. Management Approach 5](#_Toc83330369)

[2.1 Project Process 5](#_Toc83330370)

[2.2 Quality Management 5](#_Toc83330371)

[2.3 Training Plan 5](#_Toc83330372)

[3. Project Deliverables 5](#_Toc83330373)

[4. Responsibility Assignments 5](#_Toc83330374)

[5. Project Communications 6](#_Toc83330375)

[6. Configuration Management 6](#_Toc83330376)

[6.1 Document Management 6](#_Toc83330377)

[6.2 Source Code Management 6](#_Toc83330378)

[6.3 Tools & Infrastructures 6](#_Toc83330379)

# I. Record of Changes

|  |  |  |  |
| --- | --- | --- | --- |
| Date | A\* M, D | In charge | Change Description |
| 2026-07-06 | A | Project Team | Initial authored version of Report 2, grounded in the live Jira schedule (project `LCSP`, board 71) and `docs/` specifications. |
|  |  |  |  |
|  |  |  |  |

\*A - Added M - Modified D - Deleted

# II. Project Management Plan

## 1. Overview

### 1.1 Scope & Estimation

The Work Breakdown Structure below reflects the 26 Jira Epics actually scheduled on the `LCSP` board (board 71), organized into 7 weekly delivery phases spanning **2026-07-06 to 2026-08-20**. Each Epic decomposes into implementation-ready Tasks (91 Tasks total across all Epics); effort is estimated at the Epic level in man-days.

|  |  |  |  |
| --- | --- | --- | --- |
| **#** | **WBS Item** | **Complexity** | **Est. Effort (man-days)** |
| ***1*** | ***Phase 1 — Platform Foundations (Jul 6–12)*** |  | ***14*** |
| 1.1 | platform/pbac — PBAC policy engine scaffolding | Complex | 5 |
| 1.2 | platform/audit-writer — Append-oriented AuditEvent writer | Medium | 3 |
| 1.3 | platform/config — Configuration & environment loading | Simple | 2 |
| 1.4 | platform/outbox — OutboxEvent transactional messaging | Medium | 4 |
| ***2*** | ***Phase 2 — Auth, Assessment & Worker Skeleton (Jul 13–19)*** |  | ***18*** |
| 2.1 | auth-workspace — Auth, MFA, OAuth/OIDC, sessions | Complex | 6 |
| 2.2 | assessment — Assessment lifecycle & state machine | Complex | 5 |
| 2.3 | python-workers/platform — Bounded consumer/module scaffolding | Medium | 4 |
| 2.4 | legal-rule-catalog — LegalRule/LegalRuleCatalogVersion scaffolding | Medium | 3 |
| ***3*** | ***Phase 3 — Repository, Wizard & Web Shell (Jul 20–26)*** |  | ***16*** |
| 3.1 | web — Next.js app shell, routing, shared components | Complex | 6 |
| 3.2 | github-integration — GitHub App read-only repository auth | Medium | 4 |
| 3.3 | wizard — WizardProfile capture & readiness | Medium | 4 |
| 3.4 | python-workers/llm — LLM Gateway client scaffolding | Simple | 2 |
| ***4*** | ***Phase 4 — Scanner & Evidence Pipeline (Jul 27–Aug 2)*** |  | ***10*** |
| 4.1 | python-workers/scanner — Syft/Knip/deptry/ast/ts-morph/tree-sitter/Semgrep | Complex | 8 |
| 4.2 | scan — Scan job orchestration & trusted trigger mapping | Medium | 2 |
| ***5*** | ***Phase 5 — Technical Profile, Legal Corpus & Classification (Aug 3–9)*** |  | ***17*** |
| 5.1 | evidence — TechnicalEvidenceReport / TechnicalProfile | Complex | 5 |
| 5.2 | python-workers/legal — Legal source ingestion & ChromaDB indexing | Complex | 6 |
| 5.3 | python-workers/classification / classification — Risk classification worker | Complex | 4 |
| 5.4 | python-workers/intelligence — Cross-cutting intelligence utilities | Medium | 2 |
| ***6*** | ***Phase 6 — AIUsageFlow & Reconciliation (Aug 10–16)*** |  | ***9*** |
| 6.1 | ai-usage-flow — Claim-level AIUsageFlow generation | Complex | 4 |
| 6.2 | reconciliation — Conflict detection & VerifiedProfile | Complex | 5 |
| ***7*** | ***Phase 7 — Gap Analysis, Documents, Audit & Hardening (Aug 17–20)*** |  | ***7*** |
| 7.1 | document — Gap analysis & guarded document generation | Medium | 3 |
| 7.2 | audit / qa / reporting / web (final hardening pass) | Medium | 4 |
| ***Total Estimated Effort (man-days)*** | | | ***91*** |

### 1.2 Project Objectives

The project's overall objective is to deliver an **A-to-Z runnable MVP** of LCSP: a Manager can create an assessment, connect a repository, receive an automatic trusted scan, review evidence-backed AIUsageFlow, resolve any reconciliation conflict, and obtain a citation-backed risk classification and guarded compliance document — without needing Developer participation and without the system ever asserting a conclusion it cannot evidence or cite.

*Quality*

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| **#** | **Testing Stage** | **Test Coverage** | **No. of Defects** | **% of Defect** | **Notes** |
| 1 | Reviewing (spec/code review) | 100% of merged PRs | — | — | Mandatory review gate before merge |
| 2 | Unit Test | ≥ 80% of domain/application layers | — | — | NestJS Jest / Python pytest |
| 3 | Integration Test | 100% of API contract endpoints | — | — | Contract tests, PBAC decision tests |
| 4 | System Test | 100% of canonical UC-001..UC-017 | — | — | End-to-end golden path + blocked states |
| 5 | Acceptance Test | 100% of AC-001..AC-041 (+AC-050A..F) | — | — | Traceability matrix gate |

*Milestone Timeliness (%):* Target ≥ 90% of the 7 weekly phase milestones met on or before their scheduled due date, tracked weekly against the Jira board.

*Allocated Effort (man-days):* 91 man-days total — approximately 14 (Platform), 18 (Auth/Assessment), 16 (Repository/Web), 10 (Scanner), 17 (Profile/Legal/Classification), 9 (AIUsageFlow/Reconciliation), 7 (Gap/Document/Hardening), as detailed in §1.1.

### 1.3 Project Risks

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **#** | **Risk Description** | **Impact** | **Possibility** | **Response Plans** |
| 1 | ChromaDB structure-first vectorless legal retrieval is a non-standard RAG pattern with limited prior art; retrieval quality may miss valid citations. | High | Medium | ADR-026 locks the approach; add cross-reference expansion and citation allowlist validation; keep a fallback path of direct ID/locator lookup so retrieval never depends solely on full-text ranking. |
| 2 | Vietnamese legal corpus (Luật AI 134/2025 and related instruments) changes or gets amended during development, invalidating pinned `LegalCorpusVersion`/`LegalRuleCatalogVersion`. | High | Medium | Corpus and rule-catalog versions are immutable and independently pinned per assessment; new versions are additive, never destructive; Internal Legal Operator review gate catches drift before approval. |
| 3 | Static scanner (tree-sitter/`ast`/`libcst`/`ts-morph`) produces false positives/negatives on unusual code patterns, undermining evidence trust. | Medium | High | Evidence is confidence-scored, never asserted as certain; coverage limitations are surfaced explicitly; Manager reconciliation step exists precisely to catch evidence/business-context mismatches. |
| 4 | LLM provider cost or availability risk during classification/document generation (real-provider requirement, no mock-mode acceptance evidence). | Medium | Medium | NFR-033 token/cost budget caps enforced at the LLM Gateway; classification fails closed (blocked, not silently degraded to guesswork) on provider outage. |
| 5 | PBAC (policy-based access control) is more complex to implement correctly than simple RBAC, risking authorization bugs across many resource types. | High | Medium | PBAC runtime decision is resolved up front (`docs/implementation/decisions/pbac-runtime-decision.md`); authorization is contract-tested per resource/action pair, deny-by-default. |
| 6 | Scope/documentation drift between `docs/specs/` and delivery tasks, given the size of the canonical baseline (56 FRs, 35 NFRs, 17 UCs). | Medium | Medium | Task/spec sync audits performed periodically (see `docs/implementation/tasks/`); traceability matrix maintained as the single cross-check artifact. |
| 7 | Solo/small-team capacity constraint against a 91-man-day, 7-phase schedule compressed into ~7 weeks. | Medium | High | Phases are ordered so each unblocks the next (platform → auth/assessment → repo/web → scanner → profile/legal → reconciliation → document); non-MVP polish is deferred first under schedule pressure. |

## 2. Management Approach

The project is managed as a **specification-first, phase-gated delivery**: no implementation work is authorized ahead of an approved spec (`IMPLEMENTATION_NOT_AUTHORIZED` gate lifted phase-by-phase), and every Epic/Task in Jira traces back to a canonical FR/NFR/UC/BR/AC identifier in `docs/specs/` and `docs/product/`.

### 2.1 Project Process

The team follows a **weekly, phase-gated iteration model** aligned to the 7 phases in §1.1 (rather than fixed-length Scrum sprints), because each phase has a hard technical dependency on the previous one completing (e.g., the scanner pipeline cannot be built before the worker platform skeleton exists; classification cannot be built before legal corpus ingestion exists). Within each phase:

1. **Spec confirmation** — verify the relevant `docs/specs/*.md` section is current and unambiguous for the Epics in scope.
2. **Task breakdown** — decompose each Epic into Jira Tasks with explicit FR/UC/AC references.
3. **Implementation** — build against the spec, with PBAC/audit/privacy invariants treated as non-negotiable per module (see `docs/architecture/architecture.md` Mandatory Architectural Invariants).
4. **Review & test** — code review plus the applicable test level from §1.2.
5. **Phase exit check** — confirm the phase's Epics are Done and downstream phases are unblocked before advancing.

This is effectively a lightweight Kanban-on-rails: continuous flow of Tasks per Epic, but with phase boundaries acting as hard dependency gates rather than time-boxed sprint ceremonies.

### 2.2 Quality Management

* **Defect Prevention:** every Epic/Task references canonical `FR-*`/`NFR-*`/`UC-*`/`BR-*`/`AC-*` IDs so ambiguity is resolved against a single source of truth before code is written, not after a defect is found.
* **Reviewing:** all merged changes pass code review; spec changes pass a documentation consistency check (no contradicting "BLOCKED" language left over from superseded rules, consistent terminology across specs).
* **Unit Testing:** NestJS modules (Jest) and Python workers (pytest) unit-test domain and application layers in isolation from infrastructure.
* **Integration Testing:** PBAC authorization decisions, queue/event contracts, and ChromaDB retrieval are contract-tested against real (not mocked) infrastructure per NFR-021/NFR-024.
* **System Testing:** each canonical Use Case (UC-001..UC-017) is exercised end-to-end, including blocked/degraded/failed states, not only the happy path.

### 2.3 Training Plan

|  |  |  |  |
| --- | --- | --- | --- |
| Training Area | Participants | When, Duration | Waiver Criteria |
| NestJS modular DDD (presentation/application/domain/infrastructure layering) | Backend contributors | Phase 1, 2–3 days | Mandatory unless prior NestJS DDD experience |
| Python static-analysis toolchain (`ast`, `libcst`, `ts-morph`, tree-sitter, Semgrep custom rules) | Python Worker Platform contributors | Phase 4 (before scanner work begins), 3–4 days | Mandatory unless prior static-analysis tooling experience |
| ChromaDB structure-first vectorless retrieval design (ADR-026) | Legal Matching / Retrieval contributors | Phase 5 (before legal corpus work begins), 2 days | Mandatory — this is a non-standard RAG pattern with no prior team experience assumed |
| PBAC policy model (vs. RBAC) | All contributors touching authorization-checked endpoints | Phase 1–2, 1 day | Mandatory |
| Next.js App Router + shared `packages/contracts`/`packages/i18n` conventions | Frontend contributors | Phase 3, 2 days | Waived with prior Next.js App Router experience |

## 3. Project Deliverables

|  |  |  |  |
| --- | --- | --- | --- |
| **#** | **Deliverable** | **Due Date** | **Notes** |
| 1 | Platform foundations (PBAC, audit writer, config, outbox) | 2026-07-12 | Phase 1 exit |
| 2 | Auth-workspace, assessment lifecycle, worker platform skeleton, legal-rule-catalog scaffolding | 2026-07-19 | Phase 2 exit |
| 3 | Web app shell, GitHub read-only integration, WizardProfile, LLM Gateway client | 2026-07-26 | Phase 3 exit |
| 4 | Repository scan pipeline (Scanner Worker + trusted trigger mapping) | 2026-08-02 | Phase 4 exit |
| 5 | TechnicalProfile, legal corpus ingestion + ChromaDB index, classification worker | 2026-08-09 | Phase 5 exit |
| 6 | AIUsageFlow generation, reconciliation & VerifiedProfile | 2026-08-16 | Phase 6 exit |
| 7 | Gap analysis, guarded document generation, audit/QA/reporting hardening | 2026-08-20 | Phase 7 exit — MVP feature-complete |
| 8 | Report 1 – Project Introduction | 2026-07-06 | Documentation deliverable |
| 9 | Report 2 – Project Management Plan | 2026-07-06 | Documentation deliverable |
| 10 | Report 3 – Software Requirement Specification | 2026-07-06 | Documentation deliverable |
| 11 | Report 4 – Software Design Document | 2026-07-06 | Documentation deliverable |
| 12 | Report 5 – Test Documentation | 2026-07-06 | Documentation deliverable |

## 4. Responsibility Assignments

*D~Do; R~Review; S~Support; I~Informed; <blank>- Omitted*

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| **Responsibility** | **[Project Owner]** | **[Technical Lead]** | **[Backend Eng.]** | **[Python Eng.]** | **[Frontend Eng.]** |
| Project planning & Jira tracking | D | R | S | S | S |
| Spec authoring & traceability (`docs/specs/`) | R | D | S | S | I |
| Platform foundations (PBAC, audit, outbox) | I | R | D | S | I |
| Auth-workspace & assessment lifecycle | I | R | D | S | I |
| Web app (Next.js) & shared contracts/i18n | I | R | S | I | D |
| GitHub integration & repository snapshot | I | R | D | S | I |
| Python Scanner Worker (Syft/Knip/deptry/ast/ts-morph/tree-sitter/Semgrep) | I | R | S | D | I |
| Legal corpus ingestion & ChromaDB indexing | I | R | S | D | I |
| AIUsageFlow / Reconciliation workers | I | R | S | D | I |
| Legal matching / Classification / Gap analysis / Document workers | I | R | S | D | I |
| Report 1–5 authoring | D | R | S | S | S |

## 5. Project Communications

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| **Communication Item** | **Who/ Target** | **Purpose** | **When, Frequency** | **Type, Tool, Method(s)** |
| Phase exit review | Whole team | Confirm phase Epics Done, unblock next phase | End of each weekly phase (7 total) | Jira board 71 review + written phase-exit note |
| Spec/task sync check | Project Owner, Technical Lead | Catch drift between `docs/specs/` and Jira Tasks | Ad hoc, at least once per phase | Documentation audit (see `docs/implementation/tasks/`) |
| Blocked-item escalation | Task owner → Technical Lead | Unblock a Task/Epic dependency quickly | As needed, same-day | Jira comment + direct message |
| Risk register review | Whole team | Re-assess §1.3 risks against current status | Bi-weekly | Jira + shared risk log |

## 6. Configuration Management

### 6.1 Document Management

All specification and product documents live under version control in `docs/` (`docs/product/`, `docs/architecture/`, `docs/specs/`, `docs/implementation/`) in the same Git repository as source code, so documentation changes are reviewed with the same pull-request process as code changes and remain permanently traceable via `git log`/`git blame`. The five capstone reports live under `reports/` with their supporting diagrams under `reports/diagrams/`.

### 6.2 Source Code Management

Source code is managed in a single Git monorepo (`apps/api`, `apps/web`, `packages/contracts`, `packages/i18n`, `deepagents`) hosted on GitHub. Changes are made on feature branches and merged via reviewed pull requests; `main` is the deployable branch. Commit messages and PR descriptions reference the relevant FR/UC/AC or Jira issue key for traceability.

### 6.3 Tools & Infrastructures

|  |  |
| --- | --- |
| **Category** | **Tools / Infrastructure** |
| **Technology (Web)** | Next.js (App Router), TypeScript |
| **Technology (Backend)** | NestJS (modular DDD: presentation/application/domain/infrastructure), Prisma ORM |
| **Technology (Workers)** | Python (Python Worker Platform): `ast`, `libcst`, `ts-morph` (bounded), tree-sitter/custom parser, Semgrep custom rules, Syft, Knip, deptry |
| **Legal Retrieval** | ChromaDB (structure-first, vectorless legal index per ADR-026) |
| **Database** | PostgreSQL |
| **Messaging** | Queue boundary for async commands/events between Backend API and Python Worker Platform |
| **Object Storage** | S3-compatible storage (legal source snapshots, generated documents) |
| **IDEs/Editors** | Visual Studio Code |
| **Diagramming** | Excalidraw (`.claude/skills/excalidraw-diagram-skill`) |
| **Documentation** | Markdown in-repo (`docs/`, `reports/`) |
| **Version Control** | Git / GitHub (monorepo) |
| **Project Management** | Jira (project `LCSP`, board 71) |
