# 04 — Kiến trúc hệ thống

## Hình dạng tổng thể

```text
Web UI
-> NestJS API synchronous control plane
-> PostgreSQL / Prisma
-> ChromaDB legal index
-> RabbitMQ + Outbox
-> Python Worker Platform
-> bounded Node.js TS/JS analyzer CLI
-> S3-compatible object storage
-> LLM Gateway
```

## Thành phần chính

### `apps/web`

Giao diện cho Manager. UX phải thể hiện đầy đủ trạng thái bình thường, loading, empty, permission denied, insufficient, blocked, failed, degraded, retry và rerun.

### `apps/api`

NestJS API chịu trách nhiệm HTTP, authentication, PBAC enforcement boundary, tenant scope, tạo trusted trigger/job, kiểm tra state guard, query result, download và audit export. API không trực tiếp thực hiện repository scan hoặc tác vụ dài.

### `deepagents/scanner`

Python Scanner Worker là consumer duy nhất của scan command và sở hữu toàn bộ scan lifecycle. Worker chạy Syft, Knip, deptry, Python `ast`/`libcst`, bounded Node `ts-morph`, tree-sitter/custom parser và Semgrep custom rules.

### Python Worker Platform

Python Worker Platform xử lý toàn bộ asynchronous domain workloads: scan trigger, Repository Scan, TechnicalProfile, AIUsageFlow, reconciliation, legal ingestion/index, legal matching, classification, gap analysis và document generation. Audit export là synchronous Backend API operation trong MVP. Đây là nhiều bounded consumers/modules, không phải một Python monolith.

### `tools/ts-js-analyzer`

Node CLI dùng `ts-morph`, nhận request JSON từ Python Scanner Worker và trả normalized facts qua stdout. Công cụ này không đọc queue, không tự ghi DB và không phát event.

### PostgreSQL

Lưu domain state, evidence metadata, profile, conflict, corpus, retrieval audit, classification, document metadata, outbox và audit. Raw source không được lưu dài hạn.

### RabbitMQ và Outbox

API/worker ghi domain state cùng OutboxEvent trong một transaction. Outbox publisher mới phát message. Consumer phải idempotent và có retry/DLQ.

### Object storage

Lưu immutable legal source snapshots và generated document artifacts. Database chỉ lưu reference, hash, version và metadata.

## Phân tách trách nhiệm

- API: PBAC boundary, validation, state transition, tạo/query trigger/job.
- Python Worker Platform: tác vụ bất đồng bộ và tạo artifact.
- Domain spec: hành vi đúng phải có.
- Implementation spec: cách xây dựng.
- Code map: module nào sở hữu API, bảng, DTO và queue.
- ADR: quyết định kiến trúc và quan hệ supersession.

## Các ADR quan trọng hiện tại

- Kiến trúc modular monolith-first cho API, nhưng worker được tách theo tác vụ dài.
- Manager-led workflow; Developer invitation/task workspace đã retired khỏi active MVP.
- Evidence-first và fail-closed.
- GitHub App là đường evidence chính của MVP.
- Không raw source sang LLM hoặc lưu dài hạn.
- Deterministic orchestration thay vì autonomous multi-agent control.
- Python Worker Platform thay thế Node.js downstream domain workers.
- Python Scanner Worker thay thế TypeScript-first scanner lifecycle.
- Real LLM provider thay thế mock happy path.
- Official-source legal corpus thay thế local JSONL seed.
- ChromaDB structure-first vectorless legal retriever là retriever chuẩn.

## Quy tắc module

Một module mới chỉ được tạo khi đã có trong code map. Module phải khai báo rõ mục đích, dependency, DTO/contracts, bảng dữ liệu, queue/event, API và tài liệu thẩm quyền.

## Quy tắc triển khai

Kiến trúc hiện là hợp đồng thiết kế. Chưa được suy diễn rằng package, schema, worker, migrations, CI hoặc hạ tầng thật đã tồn tại. Việc coding chỉ bắt đầu sau UX, epics/stories và readiness recheck.
