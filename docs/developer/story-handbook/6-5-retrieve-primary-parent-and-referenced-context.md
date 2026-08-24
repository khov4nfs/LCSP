# Story 6.5 Developer Packet

Status: ready-for-dev

## Story

Retrieve Primary, Parent, and Referenced Context

## Acceptance Criteria

1. **Given** an approved VerifiedProfile requests legal matching
   **When** legal retrieval runs
   **Then** LCSP retrieves primary candidate chunks from the approved corpus using structure-first metadata, full-text matching, direct ID lookup, or equivalent vectorless retrieval path
   **And** labels those chunks with `context_role=PRIMARY_MATCH`.

2. **Given** a primary chunk is a clause or point
   **When** retrieval assembles context
   **Then** LCSP includes document title, article number/title, parent clause context as applicable, and hierarchy metadata as `PARENT_CONTEXT`
   **And** does not represent parent context as a separate primary hit.

3. **Given** a primary chunk references another legal unit
   **When** one-hop xref expansion runs
   **Then** LCSP retrieves referenced legal context as `REFERENCED_CONTEXT`
   **And** records reference reason, referenced chunk ID, corpus version, and provenance separately from primary hits.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `6-5-retrieve-primary-parent-and-referenced-context`
- Official execution artifact: `docs/implementation-artifacts/6-5-retrieve-primary-parent-and-referenced-context.md`
- Epic: `Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `ChromaDB`

### Current State and Scope Guardrails

- Epic 6 thiết lập legal evidence chain. Nếu corpus/version/citation roles lẫn lộn, toàn bộ legal matching và classification mất khả năng audit.
- Story trong epic này phải xem legal corpus là internal operational asset, không phải customer-facing management surface.
- VerifiedProfile đã approved là input bắt buộc; legal flow không được kéo raw AIUsageFlow claims trực tiếp làm authority.

- Previous story context: `docs/developer/story-handbook/6-4-build-chromadb-structure-first-vectorless-legal-index.md`
- Next story dependency seam: `docs/developer/story-handbook/6-6-enforce-retrieved-and-context-citation-allowlist.md`
- Artifact chain for this epic: legal source snapshot -> parsed hierarchy/stable IDs -> approved LegalCorpusVersion -> ChromaDB vectorless retrieval -> LegalRuleMatch evidence.
- Workflow/state focus: VERIFIED_PROFILE_APPROVED -> LEGAL_MATCHING_REQUESTED -> LEGAL_MATCHING_READY / LEGAL_MATCHING_BLOCKED, plus corpus approval/index readiness gates.

### Story-Specific Implementation Tasks

- Retrieve primary legal chunks from approved corpus using structure-first/vectorless methods.
- Assemble parent clause/article context and one-hop referenced context with explicit roles.
- Persist provenance including reference reason, chunk IDs and corpus version separately per context role.

### Task to Acceptance Criteria Traceability

- `AC1`: Retrieve primary legal chunks from approved corpus using structure-first/vectorless methods.
- `AC2`: Assemble parent clause/article context and one-hop referenced context with explicit roles.
- `AC3`: Persist provenance including reference reason, chunk IDs and corpus version separately per context role.

### Dependencies and Prerequisites

- Story 6.4 usable legal index.
- Approved VerifiedProfile and legal-matching request.

### Explicit Non-Goals

- No flattening parent/referenced context into primary hits.
- No retrieval from unapproved corpus.
- No citation role ambiguity in storage or UX.

### Story-Specific Risks and Edge Cases

- Parent/reference context mislabeled as primary.
- Retrieval misses required legal hierarchy context.
- Referenced context provenance insufficient for audit.

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
