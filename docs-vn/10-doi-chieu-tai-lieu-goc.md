# 10 — Đối chiếu tài liệu gốc và Phase 5.2L

## Mục đích

Bảng này đối chiếu các nhóm nội dung trong `docs/` với phần tóm lược trong `docs-vn/` và ghi nhận trạng thái review Phase 5.2L.

## Product

| Nguồn | Bản tóm lược | Trạng thái review |
|---|---|---|
| `docs/product/system-context.md` | `01`, `03` | align Phase 5.2L |
| `docs/product/product-brief.md` | `01`, `09`, `12` | active brief sau pruning |
| `docs/product/prd.md` | `01`, `02` | source narrative; canonical IDs ở specs |
| `docs/product/business-rules.md` | `01`, `02`, `03` | PBAC/removed scope đã là boundary active |

## Requirements và domain

| Nguồn/nhóm | Bản tóm lược | Trạng thái review |
|---|---|---|
| use cases và task flows | `02`, `03` | gần align; cần clean trace cũ |
| functional requirements | `02` | 56 IDs; target Phase 5.2L đã phản ánh |
| non-functional requirements | `02`, `07` | PBAC/Python/toolchain đã phản ánh |
| acceptance catalog | `02`, `03` | còn historical AC/UC cleanup |
| baseline, matrix và summary | `02`, `08`, `12` | không chứng nhận readiness/story coverage |
| domain model và state machines | `03`, `07` | target đã có; historical boundary cần clean |
| event catalog | `03`, `07` | Python consumers và trigger events đã có |
| repository analysis | `04`, kiến trúc Repository Deep Agent | LangGraph + native Deep Agents + LCSP Docker sandbox + Codebase Memory MCP; không còn scanner spec riêng |
| legal/classification/document specs | `03`, `06` | ChromaDB vectorless và citation allowlist đã là contract |

## Architecture và implementation

| Nguồn/nhóm | Bản tóm lược | Trạng thái review |
|---|---|---|
| architecture | `04` | target PBAC/Python Worker Platform đã có |
| ADR index và ADR files | `04`, `09` | active decision source |
| backend, persistence, queue | `04`, `07` | implementation contract |
| repository-analysis implementation | `04` | LCSP Agent Runtime sở hữu repository sandbox, analysis và evidence projection |
| Python Worker Platform | `04`, `07` | package topology và worker ownership đã khóa |

## Bộ định danh mục tiêu hiện tại

- active use cases: `UC-001..UC-017`;
- canonical FR IDs: `FR-001..FR-056`;
- active FR set theo baseline Phase 5.2L: 52;
- `FR-045/FR-046`: superseded;
- `FR-051`: removed;
- `FR-052`: deferred;
- active NFRs: 33;
- acceptance catalog: `AC-001..AC-041` và `AC-050A..AC-050F`, trong đó `AC-013` là historical guard.

```text
PHASE_5_2L_TARGET_BROADLY_PROPAGATED
PROJECT_OWNER_DOC_REMEDIATION_APPROVED
PHASE_5_2L_P0_CLOSURE_COMPLETED
DOC_INVENTORY_PRUNED_TO_AUTHORITY_SET
UX_REBASE_PENDING_AFTER_DOC_PRUNING
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
```
