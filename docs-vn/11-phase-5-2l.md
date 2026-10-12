# 11 — Phase 5.2L: Điều chỉnh phạm vi và runtime

## Trạng thái

```text
PROJECT_OWNER_DIRECTIVE_RECORDED
SPRINT_CHANGE_PROPOSAL_CREATED
PROJECT_OWNER_DOC_REMEDIATION_APPROVED
PHASE_5_2L_P0_CLOSURE_COMPLETED
UX_ARTIFACT_REMOVED_FROM_ACTIVE_DOC_SET
UX_REBASE_PENDING_AFTER_DOC_PRUNING
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
```

## Các quyết định mới

- PBAC thay RBAC làm nguồn quyết định quyền truy cập.
- Structured attestation bị loại khỏi MVP.
- Compliance certification, formal legal opinion, direct regulator submission và manual evidence JSON bị loại khỏi product direction.
- `FR-050` không còn là upload Local/CI report; thay bằng Automatic Trusted Scan Initiation.
- Tất cả asynchronous domain workloads chuyển sang Python Worker Platform.
- Node.js chỉ còn cho NestJS/Web/tooling; không còn analyzer CLI riêng theo ngôn ngữ.
- Thiết kế scanner toolchain theo ngôn ngữ đã được supersede. Repository analysis hiện dùng LangGraph + native Deep Agents harness trên repository commit-pinned trong LCSP Docker sandbox; Codebase Memory là structural memory tùy chọn.

## Phần đã được propagate rộng

- system context và architecture target;
- canonical FR/NFR direction;
- automatic trigger states, commands và events;
- Python worker ownership trong code maps và queue docs;
- repository-analysis architecture và archive boundary cho scanner specs cũ;
- delivery plan và readiness report;
- phần lớn tài liệu tóm lược tiếng Việt.

## Phần đã closure trước UX

- Sprint Change Proposal đã ghi approval cho documentation/planning remediation only.
- `validation-plan.md` đã đổi A3 thành PBAC and trusted-trigger abuse risk; structured attestation chỉ còn marker `SUPERSEDED_FOR_ACTIVE_MVP`.
- Business rules đã chuyển active role semantics sang PBAC subject/policy semantics và đưa attestation vào superseded register.
- Requirements baseline đã tách `UC-M09-05` khỏi active coverage và cập nhật AC-9/11/12 theo PBAC/trigger/evidence.
- Readiness/index/traceability docs hiện hạ trạng thái xuống remediation in progress, ghi `UX_REBASE_PENDING_AFTER_DOC_PRUNING` và yêu cầu rebase hoặc tạo lại UX trước approval.
- Điều kiện approval RAG đã được chuẩn hóa thành ChromaDB structure-first vectorless legal RAG; PostgreSQL pgvector legal retrieval bị superseded.

## Phần carry forward trước stories/readiness

- UX rebase/regeneration vẫn cần hoàn tất trước stories/readiness.
- Chưa có dedicated Phase 5.2L ADRs cho PBAC, automatic trigger, Python Worker Platform và LCSP Agent Runtime repository-analysis runtime.
- PBAC engine/topology, trigger retry/DLQ/idempotency và repository-analysis failure/coverage policy vẫn là technical decisions mở trước stories/readiness.

## Kiến trúc mục tiêu

```text
NestJS API = synchronous control plane
Web = product UI
Python Worker Platform = all asynchronous domain workloads
LCSP Agent Runtime = durable LangGraph thread + Docker repository working database
```

Python Worker Platform gồm nhiều consumer/module độc lập cho trigger resolution, scan, profile, AIUsageFlow, reconciliation, legal pipeline, classification, gap analysis và document generation. Audit export là synchronous Backend API operation trong MVP.

## Repository analysis mục tiêu

```text
commit-pinned snapshot
-> hydrate repository vào LCSP Docker sandbox
-> Repository Deep Agent dùng native filesystem/search/execute/planning/subagents
-> Codebase Memory index/search khi hữu ích
-> agent tự xác định evidence graph + unresolved frontiers + coverage + AI discovery gate
-> source-anchor/hash + privacy/schema gates
-> TechnicalEvidenceReport
```


## Bước closure trước UX

```text
Project Owner approval
-> sửa P0 cross-document contradictions
-> cập nhật ADR/traceability/readiness markers
-> validation pass không còn active residue
-> UX_REBASE_PENDING_AFTER_DOC_PRUNING
-> bmad-ux
```

Chi tiết finding nằm trong `12-review-truoc-ux-phase-5-2l.md`.
