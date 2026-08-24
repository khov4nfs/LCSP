# Story 6.3 Developer Packet

Status: ready-for-dev

## Story

As a Internal Legal Operator, I want to approve a LegalCorpusVersion after validation, so that assessments retrieve only approved effective legal corpus data.

## Acceptance Criteria

1. **Given** a parsed corpus candidate passes required validation
   **When** the Internal Legal Operator approves it
   **Then** LCSP creates an approved LegalCorpusVersion with corpus_version_id, checksum set, effective-date metadata, status, approver, approval timestamp, and audit event.

2. **Given** validation errors remain for structure, effective dates, required metadata, checksum, or source provenance
   **When** approval is attempted
   **Then** LCSP blocks approval
   **And** records the blocker reasons.

3. **Given** a corpus version is expired, superseded, or not yet effective
   **When** a new assessment requests legal retrieval
   **Then** LCSP does not use that version as the active retrieval corpus unless explicitly configured for historical assessment context.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `6-3-approve-legalcorpusversion`
- Official execution artifact: `docs/implementation-artifacts/6-3-approve-legalcorpusversion.md`
- Epic: `Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `ChromaDB`

### Current State and Scope Guardrails

- Epic 6 thiết lập legal evidence chain. Nếu corpus/version/citation roles lẫn lộn, toàn bộ legal matching và classification mất khả năng audit.
- Story trong epic này phải xem legal corpus là internal operational asset, không phải customer-facing management surface.
- VerifiedProfile đã approved là input bắt buộc; legal flow không được kéo raw AIUsageFlow claims trực tiếp làm authority.

- Previous story context: `docs/developer/story-handbook/6-2-parse-legal-structure-and-stable-hierarchical-ids.md`
- Next story dependency seam: `docs/developer/story-handbook/6-4-build-chromadb-structure-first-vectorless-legal-index.md`
- Artifact chain for this epic: legal source snapshot -> parsed hierarchy/stable IDs -> approved LegalCorpusVersion -> ChromaDB vectorless retrieval -> LegalRuleMatch evidence.
- Workflow/state focus: VERIFIED_PROFILE_APPROVED -> LEGAL_MATCHING_REQUESTED -> LEGAL_MATCHING_READY / LEGAL_MATCHING_BLOCKED, plus corpus approval/index readiness gates.

### Story-Specific Implementation Tasks

- Validate parsed corpus candidate and persist approved LegalCorpusVersion metadata.
- Block approval on structural, metadata, checksum or provenance errors.
- Respect effective/not-yet-effective/superseded status in active retrieval selection.

### Task to Acceptance Criteria Traceability

- `AC1`: Validate parsed corpus candidate and persist approved LegalCorpusVersion metadata.
- `AC2`: Block approval on structural, metadata, checksum or provenance errors.
- `AC3`: Respect effective/not-yet-effective/superseded status in active retrieval selection.

### Dependencies and Prerequisites

- Stories 6.1 and 6.2 source and parsed corpus candidate.
- Internal operator approval workflow.

### Explicit Non-Goals

- No use of unapproved corpus for active legal retrieval.
- No bypass of effective-date/status validation.
- No customer-facing approval surface.

### Story-Specific Risks and Edge Cases

- Expired/superseded corpus selected as active.
- Approval trail missing approver/checksum/status data.
- Validation blockers downgraded to warnings incorrectly.

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
