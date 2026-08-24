# Story 6.7: Create LegalMatchingResult and LegalRuleMatch Evidence

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Create LegalMatchingResult and LegalRuleMatch Evidence

## Acceptance Criteria

1. **Given** VerifiedProfile is approved and legal retrieval returns validated context
   **When** legal matching generation runs
   **Then** LCSP creates LegalMatchingResult with legal_matching_result_id, version, `classificationEligible`, citation coverage, blocking reasons when applicable, retrieval audit ID, corpus_version_id, VerifiedProfile version, corpus/index version, and linked `LegalRuleMatch[]`
   **And** each LegalRuleMatch includes matched rule, reasoning summary, legal_refs, primary chunk IDs, parent context IDs, referenced context IDs, retrieval run ID, confidence, and validation status.

2. **Given** required legal context is missing, expired, invalid, or citation validation fails
   **When** legal matching generation runs
   **Then** LCSP returns LegalMatchingResult with blocked or insufficient legal match status, `classificationEligible=false`, citation coverage, and blocking reasons
   **And** downstream classification cannot present final risk without sufficient citation-backed legal evidence.

3. **Given** VerifiedProfile or LegalCorpusVersion changes after LegalMatchingResult creation
   **When** classification eligibility is evaluated
   **Then** LCSP marks the LegalMatchingResult stale or ineligible
   **And** classification request must use a refreshed legal matching result.

4. **Given** Manager or auditor inspects LegalRuleMatch
   **When** LCSP displays the legal evidence
   **Then** it shows a citation drawer with sections for Primary legal basis, Parent context, and Referenced context
   **And** each citation displays document title, article, clause, point, context role, allowlist pass/fail, corpus version, effective dates/status, source URL or reference, source checksum or integrity reference, and xref reason where applicable
   **And** referenced and parent context are visually demoted from primary legal basis unless separately retrieved as primary.

## Tasks / Subtasks

- [ ] Generate LegalMatchingResult and LegalRuleMatch objects from VerifiedProfile plus validated legal retrieval context.
- [ ] Calculate classification eligibility, coverage and blocking reasons from citation/validation outcomes.
- [ ] Mark result stale when VerifiedProfile or corpus version changes and prevent stale result reuse.
- [ ] Expose citation drawer metadata with primary, parent and referenced context roles plus allowlist/provenance details.
- [ ] Story-specific subtasks
  - [ ] Persist `LegalMatchingResult` with version, classification eligibility, coverage summary and blocking reasons tied to current VerifiedProfile/corpus versions.
  - [ ] Persist each `LegalRuleMatch` with matched rule, rationale, citation refs, primary/parent/referenced chunk IDs and retrieval audit ID.
  - [ ] Mark result stale when VerifiedProfile or corpus/index version changes and prevent stale result reuse in classification.
  - [ ] Build citation drawer contract that visually demotes parent/referenced context while preserving allowlist validation and provenance metadata.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `6-7-create-legalmatchingresult-and-legalrulematch-evidence`
- Official execution artifact: `docs/implementation-artifacts/6-7-create-legalmatchingresult-and-legalrulematch-evidence.md`
- Epic: `Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence`
- Runtime ownership: `apps/api`, `deepagents`, `packages/*`, `ChromaDB`

### Current State and Scope Guardrails

- Epic 6 thiết lập legal evidence chain. Nếu corpus/version/citation roles lẫn lộn, toàn bộ legal matching và classification mất khả năng audit.
- Story trong epic này phải xem legal corpus là internal operational asset, không phải customer-facing management surface.
- VerifiedProfile đã approved là input bắt buộc; legal flow không được kéo raw AIUsageFlow claims trực tiếp làm authority.

- Previous story context: `docs/developer/story-handbook/6-6-enforce-retrieved-and-context-citation-allowlist.md`
- Next story dependency seam: none; story này là tail story hiện tại của epic.
- Artifact chain for this epic: legal source snapshot -> parsed hierarchy/stable IDs -> approved LegalCorpusVersion -> ChromaDB vectorless retrieval -> LegalRuleMatch evidence.
- Workflow/state focus: VERIFIED_PROFILE_APPROVED -> LEGAL_MATCHING_REQUESTED -> LEGAL_MATCHING_READY / LEGAL_MATCHING_BLOCKED, plus corpus approval/index readiness gates.

### Story-Specific Implementation Tasks

- Generate LegalMatchingResult and LegalRuleMatch objects from VerifiedProfile plus validated legal retrieval context.
- Calculate classification eligibility, coverage and blocking reasons from citation/validation outcomes.
- Mark result stale when VerifiedProfile or corpus version changes and prevent stale result reuse.
- Expose citation drawer metadata with primary, parent and referenced context roles plus allowlist/provenance details.

### Story-Specific Subtasks

- Persist `LegalMatchingResult` with version, classification eligibility, coverage summary and blocking reasons tied to current VerifiedProfile/corpus versions.
- Persist each `LegalRuleMatch` with matched rule, rationale, citation refs, primary/parent/referenced chunk IDs and retrieval audit ID.
- Mark result stale when VerifiedProfile or corpus/index version changes and prevent stale result reuse in classification.
- Build citation drawer contract that visually demotes parent/referenced context while preserving allowlist validation and provenance metadata.

### Task to Acceptance Criteria Traceability

- `AC1.1`: Generate `LegalMatchingResult` from approved `VerifiedProfile` plus validated retrieval context.
- `AC1.2`: Persist `legal_matching_result_id` and version.
- `AC1.3`: Persist `classificationEligible`.
- `AC1.4`: Persist citation coverage and blocking reasons when applicable.
- `AC1.5`: Persist `retrievalAuditId`.
- `AC1.6`: Persist `corpus_version_id`, corpus/index version, and `VerifiedProfile` version.
- `AC1.7`: Link the result to `LegalRuleMatch[]`.
- `AC1.8`: Persist each `LegalRuleMatch.matchedRule`.
- `AC1.9`: Persist each `LegalRuleMatch.reasoningSummary`.
- `AC1.10`: Persist each `LegalRuleMatch.legalRefs`.
- `AC1.11`: Persist each `LegalRuleMatch.primaryChunkIds`.
- `AC1.12`: Persist each `LegalRuleMatch.parentContextIds`.
- `AC1.13`: Persist each `LegalRuleMatch.referencedContextIds`.
- `AC1.14`: Persist each `LegalRuleMatch.retrievalRunId`, confidence, and validation status.
- `AC2.1`: Return blocked or insufficient legal-match status when required legal context is missing.
- `AC2.2`: Return blocked or insufficient legal-match status when context is expired.
- `AC2.3`: Return blocked or insufficient legal-match status when context is invalid.
- `AC2.4`: Return blocked or insufficient legal-match status when citation validation fails.
- `AC2.5`: Force `classificationEligible=false` for every blocked/insufficient path above.
- `AC2.6`: Preserve citation coverage and explicit blocking reasons for downstream UX/audit.
- `AC2.7`: Prevent downstream classification from presenting final risk without sufficient citation-backed legal evidence.
- `AC3.1`: Mark `LegalMatchingResult` stale or ineligible when `VerifiedProfile` version changes.
- `AC3.2`: Mark `LegalMatchingResult` stale or ineligible when `LegalCorpusVersion` changes.
- `AC3.3`: Mark `LegalMatchingResult` stale or ineligible when corpus index version changes.
- `AC3.4`: Require classification request to refresh legal matching before use.
- `AC4.1`: Expose citation drawer section `Primary legal basis`.
- `AC4.2`: Expose citation drawer section `Parent context`.
- `AC4.3`: Expose citation drawer section `Referenced context`.
- `AC4.4`: Show document title, article, clause, point, and context role for each citation.
- `AC4.5`: Show allowlist pass/fail, corpus version, effective dates/status, and source URL/reference.
- `AC4.6`: Show source checksum or integrity reference and xref reason where applicable.
- `AC4.7`: Visually demote parent/referenced context unless independently retrieved as primary.

### Dependencies and Prerequisites

- Stories 6.5 and 6.6 retrieval and allowlist validation.
- Approved VerifiedProfile from Epic 5.

### Explicit Non-Goals

- No classification when `classificationEligible=false`.
- No final legal conclusion without citation-backed match set.
- No stale LegalMatchingResult treated as current.

### Story-Specific Risks and Edge Cases

- LegalRuleMatch lacks enough provenance for classification.
- Stale corpus/profile versions remain eligible.
- UI hides primary vs parent vs referenced citation distinction.

### Architecture Compliance

- Legal source ingestion, parsing, indexing và retrieval thuộc Python Worker Platform cùng ChromaDB structure-first/vectorless retrieval path.
- API chỉ nên điều phối internal approval/status/query surfaces cần thiết, không tự làm retrieval hay corpus mutation trực tiếp trong request path dài.
- Citation allowlist, parent context và referenced context là contract bắt buộc cho downstream match/classification.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 6: legal source snapshot -> parsed hierarchy/stable IDs -> approved LegalCorpusVersion -> ChromaDB vectorless retrieval -> LegalRuleMatch evidence.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.
- Handoff contract cho story này tồn tại trong `docs/planning-artifacts/epics.md` và phải được giữ nguyên khi thiết kế artifact/output boundary.

### Data and Persistence Requirements

- Các story Epic 6 thường chạm `LegalSourceSnapshot`, `LegalCorpusVersion`, stable hierarchical IDs, retrieval audit, `LegalMatchingResult`, `LegalRuleMatch` và citation coverage metadata.
- Base retrieval unit là Clause; Point content phải được assemble với parent Clause và Article context.
- Corpus/version/index artifacts phải immutable; approval status, checksum và effective-date metadata là bắt buộc.
- `LegalMatchingResult` nên lưu rõ:
  - `verifiedProfileVersion`
  - `corpusVersionId`
  - `corpusIndexVersion`
  - `retrievalAuditId`
  - `classificationEligible`
  - `citationCoverage`
  - `blockingReasons`
- `LegalRuleMatch` nên lưu tách biệt role-based citation refs:
  - `primary`
  - `parent_context`
  - `referenced_context`

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
- Staleness tests cho:
  - VerifiedProfile version changed
  - LegalCorpusVersion changed
  - corpus index version changed
- Citation drawer contract tests cho:
  - primary/parent/referenced sections render đúng role
  - parent/referenced context bị demote đúng cách
  - allowlist/provenance/integrity metadata hiện đầy đủ

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
- [Source: Handoff contract embedded in `docs/planning-artifacts/epics.md` for this story]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/6-7-create-legalmatchingresult-and-legalrulematch-evidence.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/6-7-create-legalmatchingresult-and-legalrulematch-evidence.md
