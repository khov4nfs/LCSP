import type {
  LegalRetrievalIndex,
  LegalSource,
  LegalSourceDocument,
  LegalSourceVersion,
} from "@prisma/client";
import {
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES as States,
  LEGAL_SOURCE_LIFECYCLE_STATUSES as Lifecycle,
  LEGAL_SOURCE_LIMITS,
  LEGAL_SOURCE_VERSION_BLOCKERS as Blockers,
  type LegalSourceDetail,
  type LegalSourceDocumentView,
  type LegalSourceSummary,
  type LegalSourceVersionDetail,
  type LegalSourceVersionBlocker,
  type LegalSourceVersionSummary,
} from "@lcsp/contracts/legal-source";

import {
  fromPrismaLegalSourceDocumentIngestionState,
  fromPrismaLegalSourceDocumentCorpusRole,
  fromPrismaLegalSourceDocumentOrigin,
  fromPrismaLegalSourceLifecycleStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";

export type DocumentRow = LegalSourceDocument & { _count: { chunks: number } };
export type VersionRow = LegalSourceVersion & {
  documents: Array<Pick<LegalSourceDocument, "ingestionState">>;
  _count: { chunks: number };
};

/**
 * Business purpose: Represent optional database timestamps in the legal-source API's ISO date format.
 *
 * Business rules:
 * - A missing timestamp remains null rather than being replaced with a fabricated date.
 * - Present dates use JavaScript's UTC ISO representation.
 *
 * Execution flow:
 * 1. Return null for a null timestamp.
 * 2. Convert a present Date to its ISO string.
 *
 * Failure cases:
 * - An invalid Date propagates `toISOString()`'s error instead of returning an invalid contract value.
 *
 * Side effects:
 * - None: this value conversion does not alter the Date or persist state.
 */
const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

/**
 * Business purpose: Expose persisted JSON metadata only when it has an object shape accepted by legal-source views.
 *
 * Business rules:
 * - Arrays, null, and primitive JSON values are not presented as metadata records.
 * - The helper checks shape only; it does not claim that the record's contents satisfy a deeper schema.
 *
 * Execution flow:
 * 1. Check that the value is a non-null object and is not an array.
 * 2. Return the object as a record, or null when the shape is not a record.
 *
 * Failure cases:
 * - Unsupported JSON shapes return null without throwing.
 *
 * Side effects:
 * - None: the helper returns the existing in-memory value without persistence or mutation.
 */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Business purpose: Project one stored source document into the API view and its lifecycle-dependent management capabilities.
 *
 * Business rules:
 * - Persisted Prisma status, origin, and corpus-role values are translated through the shared contract mappers.
 * - Retry is available only for a draft document that is not READY; removal is available only while its version is a draft.
 * - A source blob is reported as present only when the document has a blob digest.
 *
 * Execution flow:
 * 1. Map persisted lifecycle and provenance fields into the legal-source document contract.
 * 2. Derive chunk count, original availability, and draft-only retry/removal capabilities.
 *
 * Failure cases:
 * - Invalid persisted enum values fail through the shared mapper rather than being emitted as an invented contract value.
 *
 * Side effects:
 * - None: the view is derived from the row and does not mutate persistence.
 */
export function toDocumentView(
  row: DocumentRow,
  versionIsDraft: boolean,
): LegalSourceDocumentView {
  const state = fromPrismaLegalSourceDocumentIngestionState(row.ingestionState);
  return {
    id: row.id,
    documentId: row.documentId,
    title: row.title,
    origin: fromPrismaLegalSourceDocumentOrigin(row.origin),
    ingestionState: state,
    failureCode: row.ingestionFailureCode,
    attempt: row.ingestionAttempt,
    mediaType: row.mediaType,
    originalFileName: row.originalFileName,
    byteLength: row.byteLength,
    sourceUrl: row.sourceUrl,
    sourceSha256: row.sourceSha256,
    sourceEffectStatus: row.sourceEffectStatus,
    corpusRole: fromPrismaLegalSourceDocumentCorpusRole(row.corpusRole),
    effectiveDate: iso(row.effectiveDate),
    structureProfile: row.structureProfile,
    chunkCount: row._count.chunks,
    provenance: asRecord(row.provenance),
    extraction: asRecord(row.extraction),
    createdAt: row.createdAt.toISOString(),
    ingestedAt: iso(row.ingestedAt),
    hasOriginal: row.blobSha256 !== null,
    canRetry: versionIsDraft && state !== States.READY,
    canRemove: versionIsDraft,
  };
}

/**
 * Business purpose: Summarize a legal-source version with its document readiness and stored chunk counts.
 *
 * Business rules:
 * - Version lifecycle state is translated at the Prisma boundary.
 * - A document counts as ready only when the shared ingestion-state mapper resolves it to READY.
 *
 * Execution flow:
 * 1. Map the version lifecycle and timestamps.
 * 2. Count included documents and those in READY state, then attach the persisted chunk count.
 *
 * Failure cases:
 * - Invalid stored lifecycle or ingestion values propagate mapper failures rather than producing a guessed summary.
 *
 * Side effects:
 * - None: this summary reads the supplied database projection only.
 */
export function toVersionSummary(row: VersionRow): LegalSourceVersionSummary {
  return {
    id: row.id,
    version: row.version,
    status: fromPrismaLegalSourceLifecycleStatus(row.status),
    basedOnVersionId: row.basedOnVersionId,
    createdAt: row.createdAt.toISOString(),
    activatedAt: iso(row.activatedAt),
    documentCount: row.documents.length,
    readyDocumentCount: row.documents.filter(
      (document) =>
        fromPrismaLegalSourceDocumentIngestionState(document.ingestionState) ===
        States.READY,
    ).length,
    chunkCount: row._count.chunks,
  };
}

/**
 * Business purpose: Present a legal source's identity and version history as a customer-facing summary.
 *
 * Business rules:
 * - Versions are ordered newest first by their creation timestamp.
 * - The active version is selected by the mapped ACTIVE lifecycle state; no version is treated as active when none has that state.
 *
 * Execution flow:
 * 1. Map each included version and sort the summaries by creation time descending.
 * 2. Return source identity, total version count, the active summary if present, and the latest summary if present.
 *
 * Failure cases:
 * - Invalid persisted lifecycle values propagate through the shared mapper; an empty version list returns null active/latest values.
 *
 * Side effects:
 * - None: mapping sorts a newly created summary array and does not mutate the source's version list.
 */
export function toSourceSummary(
  source: LegalSource & { versions: VersionRow[] },
): LegalSourceSummary {
  const summaries = source.versions
    .map(toVersionSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    id: source.id,
    slug: source.slug,
    name: source.name,
    description: source.description,
    createdAt: source.createdAt.toISOString(),
    versionCount: summaries.length,
    activeVersion:
      summaries.find((version) => version.status === Lifecycle.active) ?? null,
    latestVersion: summaries[0] ?? null,
  };
}

/**
 * Business purpose: Add version-creation capability information to a legal-source summary.
 *
 * Business rules:
 * - A source can create another version only when its history contains no DRAFT version.
 * - The open draft identifier is null when no draft exists.
 *
 * Execution flow:
 * 1. Build the source summary and sort mapped versions newest first.
 * 2. Find the draft version and derive `canCreateVersion` and `openDraftVersionId` from that state.
 *
 * Failure cases:
 * - Invalid stored lifecycle states fail during mapping; a source with no versions remains representable.
 *
 * Side effects:
 * - None: this function constructs a read-only projection from the supplied source.
 */
export function toSourceDetail(
  source: LegalSource & { versions: VersionRow[] },
): LegalSourceDetail {
  const summary = toSourceSummary(source);
  const versions = source.versions
    .map(toVersionSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openDraft = versions.find(
    (version) => version.status === Lifecycle.draft,
  );
  return {
    ...summary,
    versions,
    canCreateVersion: openDraft === undefined,
    openDraftVersionId: openDraft?.id ?? null,
  };
}

/**
 * Business purpose: Report the stored-state blockers that prevent a legal-source version from activation.
 *
 * Business rules:
 * - Only DRAFT versions are eligible for activation checks.
 * - Eligible versions need at least one document, every document READY, and a valid structural index once all documents are ready.
 * - This projection evaluates readiness only and does not determine legal content or effect.
 *
 * Execution flow:
 * 1. Return VERSION_NOT_DRAFT immediately for any non-draft lifecycle state.
 * 2. Add the no-documents and not-ready blockers where applicable.
 * 3. Add the invalid-index blocker only when the version has documents and all are ready but structure is invalid.
 *
 * Failure cases:
 * - No exception is raised for an ineligible or incomplete version; its blockers are returned as contract values.
 *
 * Side effects:
 * - None: blockers are derived from the supplied summary and structural-validity flag.
 */
export function versionBlockers(input: {
  status: LegalSourceVersionSummary["status"];
  documentCount: number;
  readyDocumentCount: number;
  structuralValid: boolean;
}): LegalSourceVersionBlocker[] {
  if (input.status !== Lifecycle.draft) return [Blockers.VERSION_NOT_DRAFT];
  const blockers: LegalSourceVersionBlocker[] = [];
  if (input.documentCount === 0) blockers.push(Blockers.NO_DOCUMENTS);
  if (input.readyDocumentCount < input.documentCount)
    blockers.push(Blockers.DOCUMENT_NOT_READY);
  if (
    input.documentCount > 0 &&
    input.readyDocumentCount === input.documentCount &&
    !input.structuralValid
  )
    blockers.push(Blockers.INDEX_NOT_VALID);
  return blockers;
}

/**
 * Business purpose: Build the management view that tells administrators what a version contains and whether lifecycle actions are available.
 *
 * Business rules:
 * - Activation is allowed only when the stored-state blocker list is empty.
 * - Documents can be added only to a DRAFT version below the configured document limit.
 * - A version can be discarded only while it is DRAFT and has no Rule Set or Preparation references.
 *
 * Execution flow:
 * 1. Map the version summary and derive activation blockers.
 * 2. Sort and map document rows, then project the selected retrieval-index metadata.
 * 3. Calculate add, activate, and discard capabilities from lifecycle, counts, index validity, and reference counts.
 *
 * Failure cases:
 * - Invalid stored enum values propagate through the shared mapping functions; missing index data is represented as null.
 *
 * Side effects:
 * - None in persistence; the supplied `documents` array is sorted in place by creation time while constructing the response.
 */
export function toVersionDetail(input: {
  version: VersionRow;
  source: Pick<LegalSource, "id" | "slug" | "name">;
  documents: DocumentRow[];
  index: LegalRetrievalIndex | null;
  structuralValid: boolean;
  ruleSetCount: number;
}): LegalSourceVersionDetail {
  const summary = toVersionSummary(input.version);
  const isDraft = summary.status === Lifecycle.draft;
  const blockers = versionBlockers({
    status: summary.status,
    documentCount: summary.documentCount,
    readyDocumentCount: summary.readyDocumentCount,
    structuralValid: input.structuralValid,
  });
  return {
    ...summary,
    source: input.source,
    documents: input.documents
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((document) => toDocumentView(document, isDraft)),
    index: input.index
      ? {
          version: input.index.version,
          status: input.index.status,
          contentHash: input.index.contentHash,
          validatedAt: iso(input.index.validatedAt),
        }
      : null,
    blockers,
    canAddDocuments:
      isDraft &&
      summary.documentCount < LEGAL_SOURCE_LIMITS.maxDocumentsPerVersion,
    canActivate: blockers.length === 0,
    canDiscard: isDraft && input.ruleSetCount === 0,
    ruleSetCount: input.ruleSetCount,
  };
}
