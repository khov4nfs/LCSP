# Story 6.6: Enforce Retrieved and Context Citation Allowlist

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Enforce Retrieved and Context Citation Allowlist

## Acceptance Criteria

1. **Given** legal matching or LLM output proposes a legal_ref
   **When** citation validation runs
   **Then** LCSP accepts the legal_ref only if it points to a chunk in retrieved_chunks, parent_context_chunks, or referenced_context_chunks for the current retrieval run
   **And** validates corpus_version_id, chunk ID, hierarchy metadata, and context role.

2. **Given** a legal_ref points outside the retrieved citation allowlist
   **When** validation runs
   **Then** LCSP rejects the citation
   **And** blocks or degrades the LegalRuleMatch according to guardrail policy
   **And** records rejection reason and audit metadata.

3. **Given** referenced context is cited
   **When** the citation is shown or stored
   **Then** LCSP preserves that it was `REFERENCED_CONTEXT`
   **And** does not present it as the primary legal match unless separately retrieved as primary.

4. **Given** parent context is cited
   **When** the citation is shown or stored
   **Then** LCSP preserves that it was `PARENT_CONTEXT`
   **And** does not present it as a separate primary hit unless separately retrieved as primary.

## Tasks / Subtasks

- [ ] Validate every citation against retrieved primary/parent/referenced context allowlist for current run. (AC: 1)
- [ ] Preserve context role semantics when displaying or persisting cited context. (AC: 2)
- [ ] Emit block/degrade reasons and audit metadata on out-of-allowlist citations. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `6-6-enforce-retrieved-and-context-citation-allowlist`
- Official execution artifact: `docs/implementation-artifacts/6-6-enforce-retrieved-and-context-citation-allowlist.md`
- Epic: `Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `ChromaDB`

### Current State and Scope Guardrails

- Epic 6 thiết lập legal evidence chain. Nếu corpus/version/citation roles lẫn lộn, toàn bộ legal matching và classification mất khả năng audit.
- Story trong epic này phải xem legal corpus là internal operational asset, không phải customer-facing management surface.
- VerifiedProfile đã approved là input bắt buộc; legal flow không được kéo raw AIUsageFlow claims trực tiếp làm authority.

- Previous story context: `docs/developer/story-handbook/6-5-retrieve-primary-parent-and-referenced-context.md`
- Next story dependency seam: `docs/developer/story-handbook/6-7-create-legalmatchingresult-and-legalrulematch-evidence.md`
- Artifact chain for this epic: legal source snapshot -> parsed hierarchy/stable IDs -> approved LegalCorpusVersion -> ChromaDB vectorless retrieval -> LegalRuleMatch evidence.
- Workflow/state focus: VERIFIED_PROFILE_APPROVED -> LEGAL_MATCHING_REQUESTED -> LEGAL_MATCHING_READY / LEGAL_MATCHING_BLOCKED, plus corpus approval/index readiness gates.

### Story-Specific Implementation Tasks

- Validate every citation against retrieved primary/parent/referenced context allowlist for current run.
- Preserve context role semantics when displaying or persisting cited context.
- Emit block/degrade reasons and audit metadata on out-of-allowlist citations.

### Task to Acceptance Criteria Traceability

- `AC1`: Validate every citation against retrieved primary/parent/referenced context allowlist for current run.
- `AC2`: Preserve context role semantics when displaying or persisting cited context.
- `AC3`: Emit block/degrade reasons and audit metadata on out-of-allowlist citations.

### Dependencies and Prerequisites

- Story 6.5 retrieval outputs and allowlist assembly.
- Classification/LLM consumers expecting citation validation.

### Explicit Non-Goals

- No fabricated locator or cross-run citation reuse.
- No presenting referenced or parent context as primary basis unless separately retrieved.
- No acceptance of citation without corpus/chunk/context validation.

### Story-Specific Risks and Edge Cases

- Citations validated against wrong retrieval run.
- Parent/referenced context displayed as primary legal basis.
- Allowlist failure silently downgraded without traceability.

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

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/6-6-enforce-retrieved-and-context-citation-allowlist.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/6-6-enforce-retrieved-and-context-citation-allowlist.md
