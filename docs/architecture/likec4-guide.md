# LikeC4 Architecture-as-Code Guide for LCSP

Thư mục `likec4/` chứa các định nghĩa **LikeC4** Architecture-as-Code cho dự án LCSP.

## Thư mục nguồn LikeC4

- `likec4/specification.c4`: Định nghĩa các phần tử (system, actor, webApp, frontendPage, frontendComponent, nextRoute, apiService, workerService, database, vectorStore, queue, objectStore, externalSystem, entity, controller, handler, service, repository, queueChannel), kiểu dáng và tag.
- `likec4/model.c4`: Định nghĩa mô hình hệ thống LCSP, actor, container và mối quan hệ giao tiếp theo `docs/architecture/architecture.md`.
- `likec4/erd.c4`: Định nghĩa mô hình **ERD Database Entities** chuẩn từ Prisma Schema (`apps/api/prisma/schema.prisma`) và quan hệ 1:1, 1:N giữa các thực thể dữ liệu.
- `likec4/dev_detail.c4`: Định nghĩa **Developer Architecture & End-to-End Execution Trace** nối từ 1 Single Entry Point qua URL, Next BFF Proxy, NestJS Controllers, CQRS Handlers, Domain Services, Prisma Repositories, Transactional Outbox, RabbitMQ Queues, Python Workers và Storage.
- `likec4/feature_flows.c4`: Định nghĩa **6 sơ đồ Luồng Tương tác Mã nguồn theo Feature Độc lập (Feature-by-Feature Execution Traces)** từ Trang Frontend Page ➔ UI Component ➔ Next.js BFF Route ➔ NestJS Controller ➔ CQRS Handler ➔ Service/Repo ➔ RabbitMQ ➔ Python Worker ➔ Storage.
- `likec4/views.c4`: Định nghĩa các góc nhìn C4 tĩnh (`index`, `containers`, `pythonWorkersView`, `evidenceScanFlow`, `legalRetrievalFlow`).
- `likec4/usecases.c4`: Định nghĩa **3 sơ đồ Master Use Case theo Actor**, **17 sơ đồ Use Case độc lập**, và **1 sơ đồ kết nối End-to-End**.

---

## 1. Sơ đồ Luồng Mã nguồn theo Feature Độc lập (Feature Execution Flows)

| Dynamic View ID                   | Feature                        | Chuỗi Vết Mã Nguồn Chi tiết (Frontend Page ➔ Backend ➔ Worker)                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow_auth_signin`                | **Auth & Sign-in**             | `Sign-in Page` (`sign-in/page.tsx`) ➔ `SignInForm Organism` ➔ `apiRequest()` ➔ `BFF Route` (`api/auth/sign-in/route.ts`) ➔ `upstreamRequest` ➔ `AuthWorkspaceController` ➔ `RbacEvaluatorService` ➔ `Prisma Service` ➔ `AuthAuditEvent` ➔ Session Cookie                                                                                                                     |
| `flow_github_repository_scan`     | **GitHub Connect & Scan**      | `Settings Page` ➔ `GitHubRepositoryConnectCard` ➔ `BFF Start/Callback Route` ➔ `GitHubIntegrationController` ➔ `GitHubAppCallbackHandler` ➔ `GitHubAppService` ➔ `CreateScanJobHandler` ➔ `Prisma Service` ➔ `OutboxPollerService` ➔ `RabbitMQ Queue` (`lcsp.queue.scan.triggers`) ➔ `Python Scanner Worker` ➔ `InternalScanController Callback` ➔ `TechnicalEvidenceReport` |
| `flow_wizard_declarations`        | **Assessment Wizard**          | `Wizard Page` ➔ `AssessmentWizardContainer Organism` ➔ `apiRequest()` ➔ `BFF Draft/Submit Route` ➔ `WizardController` ➔ `SubmitWizardHandler` ➔ `Prisma Service` ➔ `WizardProfile`                                                                                                                                                                                           |
| `flow_reconciliation_conflict`    | **Conflict Resolution**        | `Reconciliation Page` ➔ `ConflictResolutionWorkspace Organism` ➔ `BFF Resolve Route` ➔ `ReconciliationController` ➔ `ResolveConflictHandler` ➔ `ConflictRecord` ➔ `Python Reconciliation Worker` ➔ `InternalReconciliationController Callback` ➔ `VerifiedProfile`                                                                                                           |
| `flow_legal_rag_classification`   | **Legal RAG & Classification** | `Official Legal Portals` ➔ `LegalIngestionWorker` ➔ `S3 PDF Snapshots` ➔ `Legal Operator Approval Gate` ➔ `ChromaIndexer` ➔ `ChromaDB Vectorless Index` ➔ `ChromaRetriever` ➔ `ClassificationWorker` ➔ `LLM Gateway` ➔ `External LLM Providers` ➔ `ClassificationResult`                                                                                                     |
| `flow_document_generation_export` | **Document Report Export**     | `Document Center Page` ➔ `DocumentCenter Organism` ➔ `BFF Doc Request Route` ➔ `DocumentController` ➔ `RequestDocumentHandler` ➔ `Outbox` ➔ `RabbitMQ Queue` (`lcsp.queue.document.generation`) ➔ `Python Document Worker` ➔ `S3 Storage PDF` ➔ `InternalDocumentController Callback` ➔ `BFF Signed PDF Download Stream`                                                     |

---

## 2. Sơ đồ Kiến trúc Chi tiết cho Developer (Developer Execution Trace Views)

| View ID                                  | Tên Sơ đồ                                              | Nội dung Chi tiết dành cho Dev                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev_single_entrypoint_architecture`     | **Developer Single Entrypoint Component Architecture** | Sơ đồ thành phần nối từ Single Client Entrypoint ➔ Next BFF Proxy ➔ NestJS Controllers ➔ CQRS Handlers ➔ Domain Services ➔ Prisma Repositories ➔ Outbox ➔ RabbitMQ ➔ Python Workers ➔ S3 / ChromaDB. |
| `dev_single_entrypoint_end_to_end_trace` | **Developer E2E Code Execution Trace**                 | Chuỗi vết mã nguồn từng bước (Step-by-step Execution Sequence) của toàn hệ thống.                                                                                                                    |

---

## 3. Sơ đồ Thực thể Dữ liệu Database (ERD Views)

| View ID                           | Tên Sơ đồ ERD                                    | Nội dung & Thực thể Mô hình hóa                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `erd_overview`                    | **LCSP Master Database ERD**                     | Tổng quan tất cả 20+ thực thể dữ liệu cơ sở dữ liệu LCSP và mối quan hệ khóa ngoại (Foreign Keys).                                                                                            |
| `erd_auth_domain`                 | **ERD - Auth & RBAC Domain**                     | `AuthOrganization`, `AuthUser`, `AuthPolicy`, `AuthMembership`, `AuthSession`, `AuthAuditEvent`.                                                                                              |
| `erd_assessment_evidence_domain`  | **ERD - Assessment & Technical Evidence Domain** | `Assessment`, `WizardProfile`, `RepositoryConnection`, `RepositorySnapshot`, `RepositoryScanJob`, `TechnicalEvidenceReport`.                                                                  |
| `erd_reconciliation_legal_domain` | **ERD - Reconciliation, RAG & Document Domain**  | `TechnicalProfile`, `AIUsageFlow`, `ConflictRecord`, `VerifiedProfile`, `LegalRuleCatalogVersion`, `LegalRule`, `LegalRuleMatch`, `ClassificationResult`, `DocumentRequest`, `OutboxMessage`. |

---

## 4. Sơ đồ Use Case Tổng theo Actor (Master Actor Journeys)

| Dynamic View ID               | Actor                  | Tên Sơ đồ Tổng                        | Luồng Tương tác Chính                                                                                                       |
| ----------------------------- | ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `uc_actor_compliance_manager` | **Compliance Manager** | **Compliance Manager Master Journey** | Sign-in ➔ Org RBAC ➔ Create Assessment ➔ Wizard Declarations ➔ Connect Repo ➔ Resolve Conflicts ➔ Export Audit & PDF Report |
| `uc_actor_legal_operator`     | **Legal Operator**     | **Legal Operator Master Journey**     | Crawl Legal Sources ➔ Store PDF/HTML Snapshots ➔ Legal Review ➔ Approve LegalCorpusVersion ➔ ChromaDB Vectorless Indexing   |

---

## 5. Danh sách 17 Use Case Độc lập (`UC-001`..`UC-017`)

| Code                                    | Tên Use Case                                       | Các thành phần tham gia                                                     |
| --------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `uc001_authenticate`                    | **UC-001 Authenticate and Manage Account**         | Manager ➔ Web ➔ API ➔ DB ➔ Audit                                            |
| `uc002_manage_rbac`                     | **UC-002 Manage Organization and RBAC Scope**      | Manager ➔ Web ➔ API ➔ DB ➔ Contracts                                        |
| `uc003_create_assessment`               | **UC-003 Create Assessment**                       | Manager ➔ Web ➔ API ➔ DB                                                    |
| `uc004_complete_wizard`                 | **UC-004 Complete WizardProfile and Readiness**    | Manager ➔ Web ➔ API ➔ DB                                                    |
| `uc005_connect_repository`              | **UC-005 Connect Repository**                      | Manager ➔ Web ➔ GitHub App ➔ API ➔ DB                                       |
| `uc006_create_snapshot`                 | **UC-006 Create Repository Snapshot**              | API ➔ GitHub App ➔ DB                                                       |
| `uc007_execute_scan`                    | **UC-007 Execute Repository Scan**                 | API ➔ Queue ➔ Scanner Worker ➔ GitHub App ➔ DB                              |
| `uc008_generate_technical_profile`      | **UC-008 Generate TechnicalProfile**               | Scanner Worker ➔ DB                                                         |
| `uc009_generate_ai_usage_flow`          | **UC-009 Generate AIUsageFlow**                    | AIUsageWorker ➔ DB                                                          |
| `uc010_resolve_conflict`                | **UC-010 Resolve Conflict**                        | Manager ➔ Web ➔ API ➔ DB                                                    |
| `uc011_approve_verified_profile`        | **UC-011 Create and Approve VerifiedProfile**      | Reconciliation Worker ➔ DB                                                  |
| `uc012_operate_legal_corpus`            | **UC-012 Operate Legal Corpus and Legal Matching** | Portals ➔ Ingestion Worker ➔ S3 ➔ Operator ➔ Indexer ➔ ChromaDB ➔ Retriever |
| `uc013_run_risk_classification`         | **UC-013 Run Risk Classification**                 | Classification Worker ➔ LLM Gateway ➔ LLM Providers ➔ DB                    |
| `uc014_generate_gap_analysis_documents` | **UC-014 Generate Gap Analysis and Documents**     | Classification Worker ➔ Gap Analysis Worker ➔ Document Worker ➔ S3 ➔ DB     |
| `uc015_review_export_audit`             | **UC-015 Review and Export Audit Trail**           | Manager ➔ Web ➔ API ➔ DB                                                    |
| `uc016_automatic_trusted_scan`          | **UC-016 Automatic Trusted Scan Initiation**       | GitHub App ➔ API ➔ Queue ➔ Scanner Worker                                   |
| `uc017_enforce_security_privacy`        | **UC-017 Enforce Security and Privacy Controls**   | Scanner Worker ➔ LLM Gateway ➔ LLM Providers ➔ DB                           |
| `uc_e2e_golden_path`                    | **Connected E2E Golden Path Workflow**             | Tất cả các mô-đun kết nối từ A đến Z                                        |

---

## Các câu lệnh Npm

```bash
pnpm run likec4:dev     # Máy chủ xem trực quan sơ đồ & vết mã nguồn code execution trace
pnpm run likec4:check   # Kiểm tra cú pháp DSL
pnpm run likec4:build   # Xuất web tĩnh SPA tại dist/likec4
pnpm run likec4:export  # Xuất sơ đồ ra ảnh PNG tại dist/likec4-export
```
