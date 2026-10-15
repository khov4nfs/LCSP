# Legal Source Management

Status: implemented (LCSP-360). Authority for how administrators create and version the legal text
the platform reasons over. It does not replace the Architecture Freeze; it adds the management layer
around the existing Legal Source Version lifecycle.

## Why

Applicability of a duty is read from the pinned Legal Source Version, the prepared Compliance Rule Set
and the repository evidence. For that to hold, the legal text itself must be data an administrator
manages, not fixtures in the runtime. Before this change the only way in was a developer-run
pipeline for two named instruments, and the customer library was a hard-coded page.

## Model

```text
LegalSource (parent: slug, name, description)
  └─ LegalSourceVersion (immutable once not DRAFT; DRAFT -> ACTIVE -> SUPERSEDED)
       ├─ LegalSourceDocument (origin UPLOAD | URL_IMPORT | MIGRATED; ingestion state; provenance)
       │    ├─ original bytes -> LegalSourceDocumentBlob (content-addressed, immutable)
       │    └─ LegalDocumentChunk (addressable text; id = <versionId>::<documentId>::<locator>)
       ├─ LegalRetrievalIndex (structural validation of the version's content)
       └─ rule sets / preparation runs that pin it (a pinned version can never be deleted)
```

- One open DRAFT per source. A new version can start from an earlier one: documents and chunks are
  copied under new chunk ids, originals are shared by hash.
- The platform still has one ACTIVE version. Activation supersedes the previous one atomically and
  announces the activation, which starts Rule Set Preparation (an existing mechanism).
- Immutability is enforced twice: services refuse mutations of a non-DRAFT version, and a database
  trigger refuses `UPDATE` of its documents and chunks. Referenced versions cannot be deleted
  (foreign keys); the only delete is discarding an unreferenced DRAFT.
- Every version has a parent source. The migration backfills the existing version (ids, hashes,
  chunks and rule-set pins untouched; its documents become `MIGRATED` / `READY`, without a stored
  original) and a trigger assigns a parent to rows inserted by older callers.

## Quality control

There is no human review or approval gate. A version becomes activatable when every document is
`READY` and a deterministic structural validation passes (every document has chunks, locators are
unique, every chunk hash matches its text). The result is recorded as the version's retrieval index
(`<version>:structural-v1`), with a content hash derived from the chunk hashes. Provenance (source
URL, final URL, retrieval time, HTTP status, SHA-256) is stored per document.

## Adding a document

1. **Upload** (`POST /admin/legal-source-versions/:id/documents/upload`, raw bytes, metadata in the
   query) or **import** (`.../documents/import`, `{ url }`).
2. The API detects the real media type from the bytes (PDF, DOCX, HTML, plain text, markdown only),
   stores the original by SHA-256, creates the document `PENDING` and queues
   `command.legal-source.document-ingest.requested.v1` through the outbox, in one transaction.
3. The runtime boundary (`tools/legal/managed_documents`) fetches the stored original from the API
   (the attempt becomes `PROCESSING`), extracts text, splits it with a structure profile and posts the
   result. The API verifies every chunk hash, ignores stale attempts, and sets `READY` or `FAILED`
   with a failure code. Retry reads the stored original; the live URL is never fetched again.

Structure profiles (`ARTICLES`, `NUMBERED_SECTIONS`, `PARAGRAPHS`, plus `AUTO`) are defined in
`deepagents/config/legal_structure_profiles.json`. Heading vocabulary is configuration. A locator is
a `::` path (`art-10::cl-1`), which the rule-set coverage check reads as hierarchy. Text before the
first heading of a structured document is counted (`frontMatterCharacters`) but not chunked; a
profile that finds no structure falls back to paragraphs so no text is dropped.

## URL import safety

https only, no credentials, port 443, host names only (no address literals). Every address the name
resolves to must be a public unicast address; the connection is pinned to a validated address (no DNS
rebinding); every redirect (maximum three) is validated the same way; size (25 MiB), time and content
type are bounded. The rejection reason is returned as a problem `meta.reason`.

## Operating it

- Admin UI: `/admin/legal-sources` (sources), `/admin/legal-sources/:id` (versions),
  `/admin/legal-source-versions/:id` (documents, states, activation), chunk inspector per document.
- Customer reading: `GET /legal-library` and the `/laws` pages read the active version only.
- Rule Set Preparation targets the active version; the Admin page names the version on screen and the
  request is refused if that is no longer the active one.
- Dependencies: the agent runtime needs `pypdf` (PDF text layer; scanned PDFs report
  `NO_EXTRACTABLE_TEXT`, there is no OCR on this path).

## Known limits

- The legacy official-source builders under `deepagents/tools/legal/sources/scripts` still contain the
  reviewed relationship rules for the first two instruments. They are operator tooling for that
  acquisition path and are not used by managed ingestion.
- Managed ingestion records no repeal tracking: chunks are stored as `ACTIVE`.
