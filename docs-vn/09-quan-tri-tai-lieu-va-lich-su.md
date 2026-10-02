# 09 — Quản trị tài liệu và lịch sử

## Các lớp tài liệu

```text
docs/product/                        product scope và business rules
docs/specs/                          UC, FR, NFR, AC, domain và state
docs/architecture/                   architecture và ADR
docs/implementation/                 build/configuration contracts
docs-vn/                             tóm lược tiếng Việt và review notes
```

## Thứ tự authority

1. Project Owner decision đã được propagate vào tài liệu active.
2. Product scope và canonical UC/FR/NFR/AC.
3. ADR đang hiệu lực và supersession register.
4. Domain specs và state machines.
5. Implementation specs.
6. `docs-vn/` chỉ dùng để đọc nhanh và review context.

Nội dung lịch sử/planning đã lược bỏ khỏi active docs chỉ còn dùng qua git history khi cần kiểm tra nguồn gốc.

## Lịch sử chính

### Phase 5.2J

Chuyển mục tiêu sang A-to-Z runnable MVP: Python-owned scanner lifecycle, first-class Python analysis, real providers, official-source legal corpus và ChromaDB vectorless legal retrieval.

### Phase 5.2K

Chuẩn hóa canonical UC/FR/AC/NFR, scanner ownership, legal corpus/retrieval và pre-UX planning state.

### Phase 5.2L

Project Owner yêu cầu PBAC, loại structured attestation, thay Local/CI upload bằng Automatic Trusted Scan Initiation, loại manual evidence JSON khỏi product, chuyển mọi async workload sang Python Worker Platform và chuyển repository analysis sang LCSP Agent Runtime.

PR #2 đã cập nhật tài liệu active theo direction này. Pass rút gọn tài liệu hiện chỉ giữ các nhóm authority đã được Project Owner yêu cầu.

## Lịch sử

Không giữ archive/planning/code-map/blueprint cũ trong active docs. Khi cần kiểm tra lịch sử, dùng git history. Tài liệu active phải phân loại nội dung cũ bằng marker rõ ràng:

```text
HISTORICAL_ONLY
SUPERSEDED_FOR_ACTIVE_MVP
REMOVED_FROM_PRODUCT
DEFERRED_POST_MVP
```

## Trạng thái planning hiện tại

```text
PHASE_5_2L_P0_CLOSURE_COMPLETED
PROJECT_OWNER_DOC_REMEDIATION_APPROVED
UX_ARTIFACT_REMOVED_FROM_ACTIVE_DOC_SET
UX_REBASE_PENDING_AFTER_DOC_PRUNING
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
CANONICAL_EPICS_AND_STORIES_ARTIFACT_MISSING
STORY_TRACEABILITY_PENDING
IMPLEMENTATION_READINESS_NOT_CERTIFIED
IMPLEMENTATION_NOT_AUTHORIZED
```

Các technical decisions về PBAC engine/topology, scan-trigger retry/DLQ/idempotency và repository-analysis coverage/failure policy có thể được carry forward qua UX dưới dạng constraint, nhưng phải được giải quyết hoặc gắn dependency rõ trước khi story/readiness được duyệt. RAG Phase 5.2L đã khóa ChromaDB vectorless và supersede pgvector legal retrieval.

## Vai trò của docs-vn

`docs-vn/` giúp đọc nhanh target direction và trạng thái closure. Nó không tạo requirement mới, không thay đổi authority và không thay thế source doc khi review chi tiết.
