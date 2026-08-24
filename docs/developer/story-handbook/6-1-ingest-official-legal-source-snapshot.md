# Story 6.1 Developer Packet

Status: ready-for-dev

## Story

As a Internal Legal Operator, I want to ingest official legal source snapshots, so that LCSP can preserve immutable legal corpus evidence.

## Acceptance Criteria

1. **Given** an Internal Legal Operator provides an approved legal source URL, file, or source reference
   **When** ingestion starts
   **Then** LCSP captures an immutable source snapshot with document metadata, source URL, retrieval timestamp, source checksum, operator, and ingestion run ID
   **And** the snapshot is not editable in place after capture.

2. **Given** source retrieval fails, checksum validation fails, or required metadata is missing
   **When** ingestion validates the source
   **Then** LCSP rejects the ingestion run
   **And** records a failure reason without creating an approved LegalCorpusVersion.

3. **Given** an ingested source has effective date, expiry, amendment, or supersession metadata
   **When** LCSP stores the snapshot
   **Then** it preserves effective_from, effective_to, legal_status, checksum, and supersedes relationships for version resolution.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `6-1-ingest-official-legal-source-snapshot`
- Official execution artifact: `docs/implementation-artifacts/6-1-ingest-official-legal-source-snapshot.md`
- Epic: `Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `ChromaDB`

### Current State and Scope Guardrails

- Epic 6 thiết lập legal evidence chain. Nếu corpus/version/citation roles lẫn lộn, toàn bộ legal matching và classification mất khả năng audit.
- Story trong epic này phải xem legal corpus là internal operational asset, không phải customer-facing management surface.
- VerifiedProfile đã approved là input bắt buộc; legal flow không được kéo raw AIUsageFlow claims trực tiếp làm authority.

- Previous story context: none; đây là story mở đầu chuỗi của epic hoặc một entry boundary mới.
- Next story dependency seam: `docs/developer/story-handbook/6-2-parse-legal-structure-and-stable-hierarchical-ids.md`
- Artifact chain for this epic: legal source snapshot -> parsed hierarchy/stable IDs -> approved LegalCorpusVersion -> ChromaDB vectorless retrieval -> LegalRuleMatch evidence.
- Workflow/state focus: VERIFIED_PROFILE_APPROVED -> LEGAL_MATCHING_REQUESTED -> LEGAL_MATCHING_READY / LEGAL_MATCHING_BLOCKED, plus corpus approval/index readiness gates.

### Story-Specific Implementation Tasks

- Implement ingestion of approved legal source URL/file/reference into immutable source snapshot.
- Persist source metadata, checksum, operator, retrieval timestamp and ingestion run identity.
- Reject retrieval/metadata/checksum failures without creating usable corpus version.

### Task to Acceptance Criteria Traceability

- `AC1`: Implement ingestion of approved legal source URL/file/reference into immutable source snapshot.
- `AC2`: Persist source metadata, checksum, operator, retrieval timestamp and ingestion run identity.
- `AC3`: Reject retrieval/metadata/checksum failures without creating usable corpus version.

### Dependencies and Prerequisites

- Internal legal operator capability and object storage/integrity support.
- Legal source spec and architecture authority.

### Explicit Non-Goals

- No in-place editing of captured snapshot.
- No customer-facing corpus administration surface.
- No approval of corpus version in same step.

### Story-Specific Risks and Edge Cases

- Snapshot lacks provenance metadata.
- Checksum failure still enters corpus pipeline.
- Supersession/effective-date metadata discarded.

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
