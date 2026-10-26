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

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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

/** What stands between a version and activation, derived only from stored state. */
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
