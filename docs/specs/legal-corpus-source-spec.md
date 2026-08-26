# Legal Corpus Source Specification

## Status

AUTHORITATIVE — A-to-Z Runnable MVP (Phase 5.2L)

Originally introduced by SPRINT-CHANGE-PROPOSAL-5.2J (2026-06-23) and ADR-025; updated by Phase 5.2L ChromaDB vectorless legal RAG decision.

## Purpose

Defines legal corpus source requirements, ingestion schema, automated activation process, and corpus management policy. Design/spec contract, not source code.

## Source Hierarchy

| Tier          | Description                                                                        | Authority             |
| ------------- | ---------------------------------------------------------------------------------- | --------------------- |
| PRIMARY       | Official government legal databases; ministry-issued decrees, circulars, decisions | Legally authoritative |
| SUPPLEMENTARY | Regulatory guidance documents; official FAQs and implementation guidance           | Contextual only       |

**Admin-managed official source catalog:**

| Source                      | URL                | Status                       |
| --------------------------- | ------------------ | ---------------------------- |
| Hệ thống pháp luật Việt Nam | vbpl.vn            | `ADMIN_MANAGED_OFFICIAL` |
| Cổng thông tin Chính phủ    | vanban.chinhphu.vn | `ADMIN_MANAGED_OFFICIAL` |

Sources in this catalog are already approved by the Admin boundary. Ingestion
must resolve source/document identity through this catalog and must not require
per-run human or manual source approval. It still validates the resolved final
URL, snapshot hash, content type, document identity, hierarchy, effect status,
chunk integrity, and retrieval index before activating a corpus version.

## Legal Document Identity Schema

| Field                  | Description                                                                                 | Example                                               |
| ---------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `document_type`        | Type of legal instrument                                                                    | `DECREE`, `CIRCULAR`, `DECISION`, `LAW`, `RESOLUTION` |
| `document_number`      | Official document number                                                                    | `13/2023/NĐ-CP`                                       |
| `issuing_authority`    | Government body                                                                             | `Chính phủ`, `Bộ Khoa học và Công nghệ`               |
| `issue_date`           | Publication date                                                                            | `2023-04-17`                                          |
| `effective_start_date` | Legal effect start                                                                          | `2023-07-01`                                          |
| `effective_end_date`   | Legal effect end (if known)                                                                 | `null` or date                                        |
| `source_effect_status` | Document-level effect status as published by the source registry (see Source Effect Status) | `CON_HIEU_LUC`                                        |
| `source_url`           | Official canonical URL                                                                      | `https://vbpl.vn/...`                                 |
| `source_hierarchy`     | PRIMARY or SUPPLEMENTARY                                                                    | `PRIMARY`                                             |

## Source Effect Status

Vietnamese official registries publish an authoritative document-level effect status alongside each document (e.g. the vbpl.vn `effStatus` field). This is captured at ingestion and normalized to `source_effect_status`:

| `source_effect_status`  | Source value                     | Default retrieval scope                                                                                         |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CON_HIEU_LUC`          | Còn hiệu lực                     | Included                                                                                                        |
| `HET_HIEU_LUC_MOT_PHAN` | Hết hiệu lực một phần            | Included; expired parts are handled at locator level via `repealed_locators`, never by whole-document exclusion |
| `CHUA_CO_HIEU_LUC`      | Chưa có hiệu lực                 | Included; retrieval-time effective-date filters apply (`effective_start_date`, per-chunk `effective_from`)      |
| `NGUNG_HIEU_LUC`        | Ngưng hiệu lực                   | Excluded from default retrieval scope                                                                           |
| `HET_HIEU_LUC_TOAN_BO`  | Hết hiệu lực toàn bộ             | Excluded from default retrieval scope                                                                           |
| `KHONG_CON_PHU_HOP`     | Không còn phù hợp                | Excluded from default retrieval scope                                                                           |
| `UNKNOWN`               | Missing or unmapped source value | Blocked; review required                                                                                        |

Rules:

- `source_effect_status` is document-level metadata. It does not extend the chunk-level `legal_status` enum (`ACTIVE | AMENDED | REPEALED`, see `adr-026-chromadb-vectorless-legal-retriever.md`); exclusion of suspended/fully-expired documents is applied at document scope during retrieval filtering.
- Suspension (`NGUNG_HIEU_LUC`) is status-driven, not date-driven: a suspended document typically has no `effective_end_date` and no repealing act, so effective-date filters and `repealed_locators` alone cannot exclude it. Without this field a suspended document would remain retrievable as if active.
- "Excluded from default retrieval scope" does not delete the document: it remains in the corpus version snapshot for provenance and for pinned-assessment historical context.

Cross-check (fail-closed):

- If `source_effect_status = HET_HIEU_LUC_TOAN_BO` but relationship mapping produced no `superseded_by`/repeal linkage, flag `LEGAL_EFFECT_STATUS_CONFLICT`; the corpus version cannot be approved until resolved.
- If the derived state (effective dates + repeal locators) and `source_effect_status` disagree about whether a document is in force, same `LEGAL_EFFECT_STATUS_CONFLICT` handling applies.
- A missing or unmapped source status normalizes to `UNKNOWN` and requires review; never silently default to included.

## Document Relationship Schema

| Field           | Description                                         |
| --------------- | --------------------------------------------------- |
| `supersedes`    | List of document identifiers this document replaces |
| `superseded_by` | Document identifier that replaces this document     |
| `amends`        | List of documents this document partially modifies  |

Document-level `amends`/`supersedes` alone is not sufficient. A single amending act commonly repeals or amends only specific clauses/points or one chapter of a target document while the rest of that document remains in force — a whole-document flag would either wrongly keep repealed clauses retrievable or wrongly exclude the entire (still-active) target document. Locator-level granularity is required:

| Field                | Description                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repealed_locators`  | List of target-document locators (`art-N`, `art-N::cl-M`, `art-N::cl-M::pt-X`, or a chapter range `art-N..art-M`) that this document's amending clause repeals in the target document |
| `amending_locator`   | Locator inside this document (the amending act) that performs the repeal/amendment, e.g. `art-33`                                                                                     |
| `target_document_id` | Document identifier whose locators are repealed/amended                                                                                                                               |

Example — real fixture pair (`LAW-134-2025-QH15` Điều 33 repealing parts of `LAW-71-2025-QH15`):

```json
{
  "document_id": "LAW-134-2025-QH15",
  "amends": ["LAW-71-2025-QH15"],
  "amending_locator": "art-33",
  "target_document_id": "LAW-71-2025-QH15",
  "repealed_locators": [
    "art-3::cl-9",
    "art-4::cl-7",
    "art-12::cl-6",
    "art-34::cl-2::pt-đ",
    "art-41..art-45"
  ]
}
```

At ingestion, each locator in `repealed_locators` must resolve to a stable `LegalDocumentChunk` ID in `target_document_id` and set that chunk's `legal_status = REPEALED` with `repealed_by_ref` pointing to `{target_document_id: this document_id, locator: amending_locator}` (see chunk metadata in `adr-026-chromadb-vectorless-legal-retriever.md`). This is distinct from `supersedes_chunk_id`, which links a chunk to a prior version of the _same_ provision inside the _same_ document's amendment lineage — do not conflate a cross-document repeal with a same-document version supersession, since the replacement text may use a different rule structure entirely.

## Document Structure Schema

Normalized document structure (chapter/article/clause/point hierarchy):

```json
{
  "document_id": "uuid",
  "articles": [
    {
      "article_number": "1",
      "title": "Phạm vi điều chỉnh",
      "clauses": [
        {
          "clause_number": "1",
          "text": "...",
          "points": [{ "point_number": "a", "text": "..." }]
        }
      ]
    }
  ]
}
```

Rules:

- Normalized text must not include raw HTML/PDF formatting artifacts.
- Each article/clause/point is stored as a structured `LegalDocumentChunk` with stable hierarchical ID and metadata.
- Base retrieval unit is Clause (`Khoản`). Do not split inside a sentence or clause only to satisfy token size.
- Point (`Điểm`) chunks retain parent Clause and Article context for assembly.
- Cross-reference edges are extracted so referenced context can be retrieved one hop when a primary match cites another provision.
- Chunk boundaries align with legal hierarchy to preserve citation fidelity.

## Ingestion Pipeline

| Step                        | Input                | Output                                                                                                                                        | Failure Behavior                                                                                                                                           |
| --------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Fetch                    | Source URL           | Raw document + HTTP metadata                                                                                                                  | `LEGAL_SOURCE_UNAVAILABLE`; audit; fail                                                                                                                    |
| 2. Snapshot                 | Raw document         | Immutable snapshot + SHA-256 hash                                                                                                             | Fail; do not proceed without snapshot                                                                                                                      |
| 3. Identity extraction      | Raw document         | Structured identity fields incl. `source_effect_status`                                                                                       | `LEGAL_IDENTITY_EXTRACTION_FAILED`; review required                                                                                                        |
| 4. Date extraction          | Raw document         | Effective dates                                                                                                                               | Best-effort; flag missing dates                                                                                                                            |
| 5. Relationship mapping     | Identity + registry  | Document-level amendment relationships plus locator-level `repealed_locators` resolved to target chunk IDs (see Document Relationship Schema) | Best-effort; flag unmapped document relationships; fail closed on unresolved locator-level repeal targets and on `LEGAL_EFFECT_STATUS_CONFLICT`             |
| 6. Normalization            | Reviewed source text | Chapter/article/clause/point structure                                                                                                        | `LEGAL_NORMALIZATION_FAILED`; review required                                                                                                              |
| 7. Structure-first chunking | Normalized structure | `LegalDocumentChunk` rows with stable hierarchical IDs and xref metadata                                                                      | Required for ChromaDB vectorless retrieval                                                                                                                 |
| 8. Automated validation gate | Extracted/review artefacts | Hash-bound validation manifest attached to `LegalCorpusVersion.status = DRAFT`                                                               | Blocked until automated OCR/extraction, hierarchy, effect-status, hash, chunk, and index validations pass                                                  |
| 9. Automatic activation      | Validated corpus       | `CorpusApprovalRecord` with system actor + `LegalCorpusVersion.status = APPROVED`                                                            | Blocked if any validation fails; no manual source approval is required                                                                                     |

## Automated Corpus Activation Process

LCSP activation is an automated internal lifecycle gate for sources already in
the Admin-managed official catalog. It does not require a handwritten/digital
signature, a real legal-department employee, or a manual source approval.

| Step                | Requirement                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Validation gate     | Hash-bound extraction/OCR, hierarchy/repeal, chunk, index, and effect-status validations pass                                       |
| Validation scope    | Document identity, effective dates, source effect status, normalization accuracy, amendment relationships, chunk/index integrity    |
| Activation record   | `date`, `scope_description`, `status`, `corpus_version_id`; system actor and validation-result refs are audited                      |
| Identity policy     | A system/process principal is audit metadata only and is not a legal signature                                                        |
| Activation gate     | `LegalCorpusVersion.status = APPROVED` before production retrieval                                                                   |
| Rejection           | Activation is not recorded; the corpus version remains `DRAFT` and is blocked until a corrected immutable version validates.        |
| Reactivation trigger | Content hash change, effective date change, source effect-status change, supersession event, or failed index integrity              |

The automatic activation service must satisfy its configured RBAC policy. That
requirement provides system accountability only; it is not legal counsel
sign-off or a legal certification.

## LegalCorpusVersion Management

| Concern        | Policy                                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| Creation       | Only after all included documents satisfy the reviewed-artefact gate           |
| Immutability   | Once approved, cannot be modified                                              |
| Supersession   | Replaced versions are `SUPERSEDED`; existing assessments retain pinned version |
| Corpus pinning | Each assessment pins to approved corpus version at start                       |

Canonical lifecycle vocabulary for legal corpus versions, legal documents within a corpus version, approval gate state, queue payload status fields and approval API responses is:

```text
DRAFT -> APPROVED -> SUPERSEDED
```

Do not use `PENDING_REVIEW`, `RETIRED` or `OBSOLETE` as active corpus lifecycle statuses in Phase 5.2L contracts.

## Refresh Policy

`TECHNICAL_DECISION_REQUIRED` — Architecture Team must define:

| Item                | Decision Required                                     |
| ------------------- | ----------------------------------------------------- |
| Ingestion cadence   | How often to check for source updates                 |
| Change detection    | Content hash comparison or source metadata versioning; a source effect-status flip can occur without content change and must be detectable |
| Re-approval trigger | What changes require a new `LegalCorpusVersion`       |
| Rollback behavior   | How to handle corpus regression                       |

## Corpus Unavailability Behavior

```text
If source URL returns error or document unavailable at ingestion time:
  → LEGAL_SOURCE_UNAVAILABLE audit event
  → Ingest job marked failed
  → Classification requiring the document remains BLOCKED
  → System must not synthesize legal content from unavailable sources
```

Fail-closed behavior is `PROJECT_OWNER_LOCKED`.

## Golden-Path Corpus Fixture

Required for A-to-Z acceptance testing:

| Requirement               | Detail                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Minimum documents         | Key laws relevant to the Vietnamese AI regulation acceptance scenario                                                               |
| Approval status           | Must pass the reviewed-artefact/validation gate before acceptance run                                                                |
| ChromaDB vectorless index | Pre-built approved legal records, metadata filters, full-text records and direct lookup IDs included in acceptance environment setup |
| Citation fidelity         | Citations must reconstruct to `article`, `clause`, `point` level                                                                     |

**Verified fixture pair:** `LAW-134-2025-QH15` and `LAW-71-2025-QH15` exercise locator-level cross-document repeal. Điều 33 of `LAW-134-2025-QH15` targets khoản 9 Điều 3, khoản 7 Điều 4, khoản 6 Điều 12, điểm đ khoản 2 Điều 34, and Chương IV (Điều 41–45) of `LAW-71-2025-QH15`, while the rest of Law 71 remains outside that repeal range. The fixture also exercises relative cross-reference resolution and transitional effective-date handling.

For the reviewed fixture, preserve these boundary checks:

- `art-40` remains outside the Chapter IV repeal range;
- `art-41..art-45` expands to Articles 41–45 and all descendants;
- `art-46` remains outside the Chapter IV repeal range.

Production source provenance remains independent of review-principal identity. A
technical approval principal cannot upgrade a non-primary snapshot into a
PRIMARY source; source authority must be established from official provenance.

## Non-Claims

- This spec does not confirm that vbpl.vn or vanban.chinhphu.vn are always accessible.
- Corpus approval does not constitute legal certification or a lawyer's signature.
- `reviewedBy`/`approvedBy` are not evidence that a named legal professional reviewed the corpus.
- The retrieval system does not make legal conclusions.
