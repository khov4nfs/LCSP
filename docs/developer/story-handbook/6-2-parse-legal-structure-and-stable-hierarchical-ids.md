# Story 6.2 Developer Packet

Status: ready-for-dev

## Story

Parse Legal Structure and Stable Hierarchical IDs

## Acceptance Criteria

1. **Given** an immutable source snapshot exists
   **When** legal structure parsing runs
   **Then** LCSP extracts document title, article number/title, clause number, point code, hierarchy path, and text units
   **And** creates stable hierarchical IDs such as `{document_id}::art-{article_no}`, `{document_id}::art-{article_no}::cl-{clause_no}`, and `{document_id}::art-{article_no}::cl-{clause_no}::pt-{point_code}`.

2. **Given** a clause or point is longer than preferred retrieval size
   **When** LCSP prepares retrieval units
   **Then** LCSP does not split between sentences or clauses merely for token size
   **And** preserves clause-level base retrieval unit with parent document and article context.

3. **Given** a legal text references another article, clause, point, or document
   **When** cross-reference extraction runs
   **Then** LCSP records outgoing and incoming reference IDs
   **And** preserves unresolved references as validation warnings or errors according to legal corpus rules.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `6-2-parse-legal-structure-and-stable-hierarchical-ids`
- Official execution artifact: `docs/implementation-artifacts/6-2-parse-legal-structure-and-stable-hierarchical-ids.md`
- Epic: `Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `ChromaDB`

### Current State and Scope Guardrails

- Epic 6 thiết lập legal evidence chain. Nếu corpus/version/citation roles lẫn lộn, toàn bộ legal matching và classification mất khả năng audit.
- Story trong epic này phải xem legal corpus là internal operational asset, không phải customer-facing management surface.
- VerifiedProfile đã approved là input bắt buộc; legal flow không được kéo raw AIUsageFlow claims trực tiếp làm authority.

- Previous story context: `docs/developer/story-handbook/6-1-ingest-official-legal-source-snapshot.md`
- Next story dependency seam: `docs/developer/story-handbook/6-3-approve-legalcorpusversion.md`
- Artifact chain for this epic: legal source snapshot -> parsed hierarchy/stable IDs -> approved LegalCorpusVersion -> ChromaDB vectorless retrieval -> LegalRuleMatch evidence.
- Workflow/state focus: VERIFIED_PROFILE_APPROVED -> LEGAL_MATCHING_REQUESTED -> LEGAL_MATCHING_READY / LEGAL_MATCHING_BLOCKED, plus corpus approval/index readiness gates.

### Story-Specific Implementation Tasks

- Parse document/article/clause/point hierarchy and emit stable hierarchical IDs.
- Assemble clause-level retrieval units with parent article context and preserve cross-references.
- Track unresolved references as warnings/errors per corpus rules.

### Task to Acceptance Criteria Traceability

- `AC1`: Parse document/article/clause/point hierarchy and emit stable hierarchical IDs.
- `AC2`: Assemble clause-level retrieval units with parent article context and preserve cross-references.
- `AC3`: Track unresolved references as warnings/errors per corpus rules.

### Dependencies and Prerequisites

- Story 6.1 immutable source snapshot.
- Hierarchy and retrieval-unit rules from legal spec.

### Explicit Non-Goals

- No arbitrary chunking that breaks clause semantics.
- No loss of parent/article context for points.
- No ignoring unresolved references.

### Story-Specific Risks and Edge Cases

- Hierarchy IDs not stable across reprocessing.
- Clause/point split destroys legal meaning.
- Cross-reference graph incomplete for later retrieval.

### Architecture Compliance

- Legal source ingestion, parsing, indexing và retrieval thuộc Python Worker Platform cùng ChromaDB structure-first/vectorless retrieval path.
- API chỉ nên điều phối internal approval/status/query surfaces cần thiết, không tự làm retrieval hay corpus mutation trực tiếp trong request path dài.
- Citation allowlist, parent context và referenced context là contract bắt buộc cho downstream match/classification.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 6: legal source snapshot -> parsed hierarchy/stable IDs -> approved LegalCorpusVersion -> ChromaDB vectorless retrieval -> LegalRuleMatch evidence.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 6 thường chạm `LegalSourceSnapshot`, `LegalCorpusVersion`, stable hierarchical IDs, retrieval audit, `LegalMatchingResult`, `LegalRuleMatch` và citation coverage metadata.
- Base retrieval unit là Clause; Point content phải được assemble với parent Clause và Article context.
- Corpus/version/index artifacts phải immutable; approval status, checksum và effective-date metadata là bắt buộc.

### State and Audit Requirements

- Corpus validation/approval failures phải block formal legal use thay vì degrade âm thầm.
- Legal matching chỉ được complete khi retrieval audit, citation allowlist và corpus version đều hợp lệ.
- Out-of-allowlist citation, missing retrieval audit hoặc obsolete corpus phải block/degrade rõ ràng và audited.

### File Structure Notes

- `deepagents` cho source ingestion, parsing, indexing, retrieval, legal matching worker.
- `packages/*` cho legal chunk IDs, citation refs, retrieval audit contracts, match result schemas.
- `apps/api` cho internal operator approval/status surfaces hoặc read models nếu project mở chúng sau này.

### Implementation Guidance for the Dev Agent

- Không quay lại dense embedding/pgvector legal path cho MVP nếu authority chưa thay đổi.
- Giữ tách biệt `PRIMARY_MATCH`, `PARENT_CONTEXT`, `REFERENCED_CONTEXT` trong data, audit và UX; không hợp nhất để “đỡ phức tạp”.
- Citation refs phải trỏ đúng allowlist của retrieval run hiện tại; không fabricate citation hoặc reuse chunk ngoài run.

### Testing Requirements

- Corpus snapshot/validation/approval tests và stable hierarchy ID coverage.
- ChromaDB vectorless retrieval tests cho primary/parent/referenced context assembly.
- LegalRuleMatch citation coverage, allowlist rejection và retrieval-audit assertions.

### References

- [Source: docs/project-context.md]
- [Source: docs/planning-artifacts/epics.md]
- [Source: docs/product/prd.md]
- [Source: docs/specs/functional-requirements.md]
- [Source: docs/specs/non-functional-requirements.md]
- [Source: docs/specs/use-cases.md]
- [Source: docs/specs/domain-model.md]
- [Source: docs/specs/domain-state-machines.md]
- [Source: docs/specs/event-catalog.md]
- [Source: docs/architecture/architecture.md]
- [Source: docs/implementation/dev-compendium.md]
- [Source: docs/specs/legal-corpus-source-spec.md]
- [Source: docs/specs/legal-matching-domain-spec.md]
- [Source: docs/implementation/legal-corpus-ingestion-implementation.md]
- [Source: docs/implementation/chromadb-vectorless-legal-retriever-implementation.md]
- [Source: docs/architecture/adr/adr-025-legal-corpus-source-architecture.md]
- [Source: docs/architecture/adr/adr-026-chromadb-vectorless-legal-retriever.md]
- [Source: docs/implementation/readiness/state-transition-authority.md]
