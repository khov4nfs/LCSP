---
project_name: "LCSP — Legal Compliance Support Platform"
user_name: "lcsp-team"
date: "2026-06-26T10:52:59+07:00"
sections_completed: ["technology_stack", "critical_rules"]
existing_patterns_found: 14
---

# Project Context for AI Agents

_File này chứa các rule ngắn, có tính thực thi cao, dành cho AI agents làm việc trong LCSP. Mục tiêu là nhắc lại các quyết định dễ bị làm sai khi triển khai._

---

## Technology Stack & Runtime Boundaries

- Web frontend là `Next.js` trong topology retained `apps/web`. Không tự phát minh frontend runtime khác nếu chưa có authority mới. [Source: docs/architecture/adr/adr-022-typescript-first-npm-only-controlled-prototype.md]
- API synchronous control plane là `NestJS` trong `apps/api`. Auth, RBAC enforcement boundary, state validation, audit emission, trusted trigger creation và query surfaces đều thuộc API. [Source: docs/architecture/architecture.md] [Source: docs/implementation/backend-implementation.md]
- Tất cả asynchronous domain workloads thuộc `Python Worker Platform`, không thuộc Node.js downstream workers. [Source: docs/architecture/architecture.md] [Source: docs/implementation/python-worker-platform-implementation.md]
- Legal retrieval dùng `ChromaDB structure-first vectorless legal retrieval`; không quay lại pgvector/dense embedding legal path. [Source: docs/architecture/architecture.md] [Source: docs/architecture/adr/adr-026-chromadb-vectorless-legal-retriever.md]
- Queue choreography dùng RabbitMQ + outbox. Không publish trực tiếp trong domain transaction khi có async work theo sau. [Source: docs/specs/event-catalog.md] [Source: docs/implementation/queue-implementation.md]

## Critical Implementation Rules

### 1. Active Authority Only

- Chỉ dùng authority active trong `docs/`, `docs/planning-artifacts/`, `docs/specs/`, `docs/architecture/`, `docs/implementation/`, `docs-vn/`.
- Không dùng `docs/archive/**` làm source of truth cho behavior mới.
- Khi tài liệu cũ mâu thuẫn với Phase 5.2L active authority, active authority thắng.

### 2. RBAC Is the Source of Truth

- RBAC thay RBAC làm authorization source of truth. Role label như `Manager` chỉ là subject attributes hoặc policy templates. [Source: docs/product/prd.md] [Source: docs/specs/functional-requirements.md]
- Mọi protected action phải evaluate `subject + organization + resource + action + runtime context + policy version + state gate`. [Source: docs/implementation/decisions/rbac-runtime-decision.md]
- Default là deny. Thiếu policy, thiếu attributes, org mismatch, resource mismatch, cache/evaluator failure, hoặc unavailable state gate đều fail closed. [Source: docs/implementation/decisions/rbac-runtime-decision.md]
- UI capability chỉ là hint từ backend projection; không bao giờ là authority.

### 3. Manager Golden Path Must Stay Intact

- Manager phải có thể hoàn tất active MVP golden path mà không phụ thuộc cộng tác viên bên ngoài.
- Developer invitation/task workspace đã retired khỏi active MVP; reintroduction cần authority mới. [Source: docs/product/system-context.md] [Source: docs/architecture/architecture.md]

### 4. OAuth/OIDC and Repository Access Are Separate

- OAuth/OIDC chỉ xác thực LCSP user identity.
- OAuth/OIDC login không được tạo `RepositoryConnection`, không cấp repository access, không cấp scan permission.
- GitHub App read-only authorization là boundary riêng. [Source: docs/product/prd.md] [Source: docs/product/business-rules.md#BR-088]

### 5. Audit Is Mandatory for Material Actions

- Material auth, RBAC, delegation, evidence, trigger, conflict, classification, document, và security events phải audited.
- Audit record phải chứa actor/service, organization, resource, action, decision/outcome, correlation ID, policy ID/version khi áp dụng, và safe refs only.
- Không ghi secret, raw token, raw source, full prompt vào audit. [Source: docs/specs/non-functional-requirements.md] [Source: docs/specs/event-catalog.md]

### 6. Privacy and Source Handling Are Hard Guardrails

- Raw source code không được gửi vào LLM.
- Raw source không được lưu dài hạn.
- Secrets phải redacted trước logs, findings, reports, prompts, audit records.
- Scanner workspace là ephemeral và cleanup phải verified trước success event. [Source: docs/architecture/architecture.md] [Source: docs/product/business-rules.md]

### 7. State Machine and Output Gates Cannot Be Bypassed

- Mọi transition phải đi qua guard hợp lệ và viết audit event.
- Không có hidden synchronous jump bỏ qua workflow gates.
- Classification cần `VerifiedProfile` + citation-backed legal basis.
- Final document cần classification, gap analysis, citations, và không còn unresolved conflict. [Source: docs/specs/domain-state-machines.md]

### 8. Versioned, Immutable Artifact Chains

- Evidence, profile, classification, report, corpus version, và rerun chain là immutable history.
- Rerun phải tạo chain/version mới thay vì mutate lịch sử cũ. [Source: docs/specs/domain-model.md] [Source: docs/specs/non-functional-requirements.md]

### 9. Story/Implementation Scope Discipline

- Không reintroduce structured attestation. `FR-045`, `FR-046`, `UC-018` là `SUPERSEDED_FOR_ACTIVE_MVP`.
- Không reintroduce manual technical evidence JSON upload. `FR-051` là `REMOVED_FROM_PRODUCT`.
- Không reintroduce delegated free-form clarification UI/API trong active MVP. `FR-052` là deferred.
- Không tạo customer-facing corpus administration surfaces. [Source: docs/product/prd.md] [Source: docs/specs/use-cases.md]

### 10. File and Package Structure Expectations

- Nếu chưa có code bootstrap, ưu tiên retained layout:
  - `apps/web`
  - `apps/api`
  - `packages/*`
- Không tạo top-level thư mục ad hoc như `backend/`, `frontend/`, `service/`, `scanner/` nếu chưa được authority layout cho phép.
- Python worker workstream theo monorepo `deepagents`; không nhét worker code vào runtime web/api. [Source: docs/architecture/adr/adr-022-typescript-first-npm-only-controlled-prototype.md] [Source: docs/implementation/scanner-worker-implementation.md]

### 11. Testing and Validation Expectations

- Protected behaviors cần negative tests, không chỉ happy path.
- NFR auth/RBAC/audit/privacy phải có integration hoặc contract coverage khi story chạm vào các vùng đó.
- Không đánh dấu xong khi chưa có bằng chứng pass cho tests/lint/validation tương ứng.

## Existing Patterns Worth Reusing

- Documentation-first, authority-driven planning: behavior phải trace về source docs cụ thể.
- Domain naming đã ổn định: `WizardProfile`, `TechnicalEvidenceReport`, `AIUsageFlow`, `VerifiedProfile`, `LegalRuleMatch`, `GeneratedDocument`, `AuditEvent`.
- Event contracts dùng naming `command.<domain>.<action>.v1` và `event.<domain>.<fact>.v1`.
- Correlation ID là yêu cầu xuyên suốt cho queue, audit, blocked/failure visibility.
- Legal citation roles phải giữ tách biệt `PRIMARY_MATCH`, `PARENT_CONTEXT`, `REFERENCED_CONTEXT`.

## What AI Agents Should Avoid

- Suy luận quyền từ role label thay vì RBAC evaluation.
- Trộn login identity với repository authorization.
- Đưa long-running work vào API request lifecycle.
- Viết code dựa trên archive docs hoặc historical wording.
- Tạo report/risk output trước khi gates hợp lệ đi qua.
- Thêm dependency hoặc runtime mới mà authority docs không hỗ trợ.

## Primary Reference Set

- `docs/product/system-context.md`
- `docs/product/prd.md`
- `docs/product/business-rules.md`
- `docs/specs/functional-requirements.md`
- `docs/specs/non-functional-requirements.md`
- `docs/specs/domain-model.md`
- `docs/specs/domain-state-machines.md`
- `docs/specs/event-catalog.md`
- `docs/architecture/architecture.md`
- `docs/architecture/adr/architecture-decision-records.md`
- `docs/implementation/backend-implementation.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`
- `docs/implementation/decisions/rbac-runtime-decision.md`
