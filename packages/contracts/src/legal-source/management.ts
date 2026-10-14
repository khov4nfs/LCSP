import { z } from "zod";

import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "./statuses.ts";

/** Where a managed document's original bytes came from. MIGRATED rows predate managed ingestion. */
export const LEGAL_SOURCE_DOCUMENT_ORIGINS = {
  UPLOAD: "UPLOAD",
  URL_IMPORT: "URL_IMPORT",
  MIGRATED: "MIGRATED",
} as const;
export type LegalSourceDocumentOrigin =
  (typeof LEGAL_SOURCE_DOCUMENT_ORIGINS)[keyof typeof LEGAL_SOURCE_DOCUMENT_ORIGINS];

/** Per-document ingestion lifecycle. A version is only activatable when every document is READY. */
export const LEGAL_SOURCE_DOCUMENT_INGESTION_STATES = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  READY: "READY",
  FAILED: "FAILED",
} as const;
export type LegalSourceDocumentIngestionState =
  (typeof LEGAL_SOURCE_DOCUMENT_INGESTION_STATES)[keyof typeof LEGAL_SOURCE_DOCUMENT_INGESTION_STATES];

/** What the ingestion runtime reports for one attempt. */
export const LEGAL_SOURCE_INGESTION_OUTCOMES = {
  READY: "READY",
  FAILED: "FAILED",
} as const;

/** Why a document could not be ingested. Never carries document content. */
export const LEGAL_SOURCE_DOCUMENT_FAILURE_CODES = {
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
  NO_EXTRACTABLE_TEXT: "NO_EXTRACTABLE_TEXT",
  NO_CHUNKS: "NO_CHUNKS",
  DUPLICATE_LOCATOR: "DUPLICATE_LOCATOR",
  RUNTIME_UNAVAILABLE: "RUNTIME_UNAVAILABLE",
} as const;
export type LegalSourceDocumentFailureCode =
  (typeof LEGAL_SOURCE_DOCUMENT_FAILURE_CODES)[keyof typeof LEGAL_SOURCE_DOCUMENT_FAILURE_CODES];

/** Legacy ingestion value retained at the persistence boundary. */
export const LEGAL_SOURCE_CHUNK_STATUSES = {
  ACTIVE: "ACTIVE",
  REPEALED: "REPEALED",
} as const;
export type LegalSourceChunkStatus =
  (typeof LEGAL_SOURCE_CHUNK_STATUSES)[keyof typeof LEGAL_SOURCE_CHUNK_STATUSES];

/** Legal effect asserted by metadata in this immutable source version. */
export const LEGAL_EFFECT_STATUSES = {
  EFFECTIVE: "EFFECTIVE",
  REPEALED: "REPEALED",
  FUTURE: "FUTURE",
  UNKNOWN: "UNKNOWN",
} as const;
export type LegalEffectStatus =
  (typeof LEGAL_EFFECT_STATUSES)[keyof typeof LEGAL_EFFECT_STATUSES];

const legalEffectStatusSchema = z.enum(
  Object.values(LEGAL_EFFECT_STATUSES) as [
    LegalEffectStatus,
    ...LegalEffectStatus[],
  ],
);
const provisionStatusesSchema = z.record(
  z.string().trim().min(1).max(300),
  z
    .strictObject({
      status: legalEffectStatusSchema,
      sourceRef: z.string().trim().min(1).max(500).optional(),
    })
    .refine(
      (entry) =>
        entry.status === LEGAL_EFFECT_STATUSES.UNKNOWN ||
        Boolean(entry.sourceRef),
      { message: "A known legal effect status requires a source reference" },
    ),
);

/** The document formats the managed ingestion can read. Anything else is refused at the door. */
export const LEGAL_SOURCE_MEDIA_TYPES = {
  PDF: "application/pdf",
  HTML: "text/html",
  PLAIN_TEXT: "text/plain",
  MARKDOWN: "text/markdown",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;
export type LegalSourceMediaType =
  (typeof LEGAL_SOURCE_MEDIA_TYPES)[keyof typeof LEGAL_SOURCE_MEDIA_TYPES];
export const LEGAL_SOURCE_SUPPORTED_MEDIA_TYPES: readonly LegalSourceMediaType[] =
  Object.values(LEGAL_SOURCE_MEDIA_TYPES);

/**
 * How a document's text is split into addressable chunks. The heading vocabulary of each profile
 * lives in the ingestion runtime's configuration, never in a caller or in generic code.
 */
export const LEGAL_SOURCE_STRUCTURE_PROFILES = {
  AUTO: "AUTO",
  ARTICLES: "ARTICLES",
  NUMBERED_SECTIONS: "NUMBERED_SECTIONS",
  PARAGRAPHS: "PARAGRAPHS",
} as const;
export type LegalSourceStructureProfile =
  (typeof LEGAL_SOURCE_STRUCTURE_PROFILES)[keyof typeof LEGAL_SOURCE_STRUCTURE_PROFILES];

export const LEGAL_SOURCE_LIMITS = {
  maxDocumentBytes: 25 * 1024 * 1024,
  maxDocumentsPerVersion: 100,
  maxNameLength: 120,
  maxDescriptionLength: 500,
  maxTitleLength: 240,
  maxUrlLength: 2048,
  maxEffectStatusLength: 80,
  maxChunkPageSize: 100,
} as const;

/** What stops a Legal Source Version from being activated right now. */
export const LEGAL_SOURCE_VERSION_BLOCKERS = {
  NO_DOCUMENTS: "NO_DOCUMENTS",
  DOCUMENT_NOT_READY: "DOCUMENT_NOT_READY",
  VERSION_NOT_DRAFT: "VERSION_NOT_DRAFT",
  INDEX_NOT_VALID: "INDEX_NOT_VALID",
} as const;
export type LegalSourceVersionBlocker =
  (typeof LEGAL_SOURCE_VERSION_BLOCKERS)[keyof typeof LEGAL_SOURCE_VERSION_BLOCKERS];

export const LEGAL_SOURCE_MANAGEMENT_ERROR_CODES = {
  requestInvalid: "LEGAL_SOURCE_REQUEST_INVALID",
  sourceNotFound: "LEGAL_SOURCE_NOT_FOUND",
  slugTaken: "LEGAL_SOURCE_SLUG_TAKEN",
  documentNotFound: "LEGAL_SOURCE_DOCUMENT_NOT_FOUND",
  versionImmutable: "LEGAL_SOURCE_VERSION_IMMUTABLE",
  versionNotReady: "LEGAL_SOURCE_VERSION_NOT_READY",
  versionInUse: "LEGAL_SOURCE_VERSION_IN_USE",
  documentUnsupportedMediaType: "LEGAL_SOURCE_DOCUMENT_UNSUPPORTED_MEDIA_TYPE",
  documentTooLarge: "LEGAL_SOURCE_DOCUMENT_TOO_LARGE",
  documentEmpty: "LEGAL_SOURCE_DOCUMENT_EMPTY",
  documentDuplicate: "LEGAL_SOURCE_DOCUMENT_DUPLICATE",
  documentLimitReached: "LEGAL_SOURCE_DOCUMENT_LIMIT_REACHED",
  documentNotRetryable: "LEGAL_SOURCE_DOCUMENT_NOT_RETRYABLE",
  ingestionResultInvalid: "LEGAL_SOURCE_INGESTION_RESULT_INVALID",
  importUrlRejected: "LEGAL_SOURCE_IMPORT_URL_REJECTED",
  importFetchFailed: "LEGAL_SOURCE_IMPORT_FETCH_FAILED",
} as const;
export type LegalSourceManagementErrorCode =
  (typeof LEGAL_SOURCE_MANAGEMENT_ERROR_CODES)[keyof typeof LEGAL_SOURCE_MANAGEMENT_ERROR_CODES];

/** Why a URL import was refused before any byte was kept. */
export const LEGAL_SOURCE_IMPORT_REJECTION_REASONS = {
  INVALID_URL: "INVALID_URL",
  SCHEME_NOT_HTTPS: "SCHEME_NOT_HTTPS",
  CREDENTIALS_IN_URL: "CREDENTIALS_IN_URL",
  PORT_NOT_ALLOWED: "PORT_NOT_ALLOWED",
  HOST_IS_ADDRESS: "HOST_IS_ADDRESS",
  HOST_NOT_RESOLVABLE: "HOST_NOT_RESOLVABLE",
  ADDRESS_NOT_PUBLIC: "ADDRESS_NOT_PUBLIC",
  TOO_MANY_REDIRECTS: "TOO_MANY_REDIRECTS",
  REDIRECT_REJECTED: "REDIRECT_REJECTED",
  RESPONSE_NOT_OK: "RESPONSE_NOT_OK",
  CONTENT_TYPE_NOT_ALLOWED: "CONTENT_TYPE_NOT_ALLOWED",
  RESPONSE_TOO_LARGE: "RESPONSE_TOO_LARGE",
  RESPONSE_EMPTY: "RESPONSE_EMPTY",
  TIMED_OUT: "TIMED_OUT",
  CONNECTION_FAILED: "CONNECTION_FAILED",
} as const;
export type LegalSourceImportRejectionReason =
  (typeof LEGAL_SOURCE_IMPORT_REJECTION_REASONS)[keyof typeof LEGAL_SOURCE_IMPORT_REJECTION_REASONS];

/** Command asking the ingestion runtime to read one stored document and write its chunks. */
export const LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND =
  "command.legal-source.document-ingest.requested.v1";

/** Index the managed ingestion produces: deterministic structural validation, no embeddings. */
export const LEGAL_SOURCE_STRUCTURAL_INDEX = {
  suffix: "structural-v1",
  tool: "legal-source-structural-validation",
  toolVersion: "1.0.0",
  manifestScheme: "structural-validation",
  integrityScheme: "structural-integrity",
} as const;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .min(3)
  .max(64);

export const createLegalSourceRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(LEGAL_SOURCE_LIMITS.maxNameLength),
  slug: slugSchema.optional(),
  description: optionalText(LEGAL_SOURCE_LIMITS.maxDescriptionLength),
});
export type CreateLegalSourceRequest = z.infer<
  typeof createLegalSourceRequestSchema
>;

export const updateLegalSourceRequestSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(LEGAL_SOURCE_LIMITS.maxNameLength)
      .optional(),
    description: optionalText(LEGAL_SOURCE_LIMITS.maxDescriptionLength),
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    {
      message: "Nothing to update",
    },
  );
export type UpdateLegalSourceRequest = z.infer<
  typeof updateLegalSourceRequestSchema
>;

export const createLegalSourceVersionRequestSchema = z.strictObject({
  /** Start from the documents of an earlier version of the same source instead of an empty draft. */
  basedOnVersionId: z.uuid().optional(),
});
export type CreateLegalSourceVersionRequest = z.infer<
  typeof createLegalSourceVersionRequestSchema
>;

const documentMetadataShape = {
  title: optionalText(LEGAL_SOURCE_LIMITS.maxTitleLength),
  structureProfile: z
    .enum(
      Object.values(LEGAL_SOURCE_STRUCTURE_PROFILES) as [
        LegalSourceStructureProfile,
        ...LegalSourceStructureProfile[],
      ],
    )
    .default(LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO),
  sourceEffectStatus: optionalText(LEGAL_SOURCE_LIMITS.maxEffectStatusLength),
  effectiveDate: z.iso.date().optional(),
  provisionStatuses: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, provisionStatusesSchema.optional()),
};

/** Metadata that accompanies the raw bytes of an upload (the bytes are the request body). */
export const uploadLegalSourceDocumentMetadataSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  ...documentMetadataShape,
});
export type UploadLegalSourceDocumentMetadata = z.infer<
  typeof uploadLegalSourceDocumentMetadataSchema
>;

export const importLegalSourceDocumentRequestSchema = z.strictObject({
  url: z.string().trim().min(1).max(LEGAL_SOURCE_LIMITS.maxUrlLength),
  ...documentMetadataShape,
});
export type ImportLegalSourceDocumentRequest = z.infer<
  typeof importLegalSourceDocumentRequestSchema
>;

export const legalSourceChunkQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(LEGAL_SOURCE_LIMITS.maxChunkPageSize)
    .default(25),
});
export type LegalSourceChunkQuery = z.infer<typeof legalSourceChunkQuerySchema>;

const lifecycleStatusSchema = z.enum(
  Object.values(LEGAL_SOURCE_LIFECYCLE_STATUSES) as [string, ...string[]],
);
const ingestionStateSchema = z.enum(
  Object.values(LEGAL_SOURCE_DOCUMENT_INGESTION_STATES) as [
    LegalSourceDocumentIngestionState,
    ...LegalSourceDocumentIngestionState[],
  ],
);
const originSchema = z.enum(
  Object.values(LEGAL_SOURCE_DOCUMENT_ORIGINS) as [
    LegalSourceDocumentOrigin,
    ...LegalSourceDocumentOrigin[],
  ],
);
const blockerSchema = z.enum(
  Object.values(LEGAL_SOURCE_VERSION_BLOCKERS) as [
    LegalSourceVersionBlocker,
    ...LegalSourceVersionBlocker[],
  ],
);

export const legalSourceDocumentViewSchema = z.strictObject({
  id: z.string(),
  documentId: z.string(),
  title: z.string(),
  origin: originSchema,
  ingestionState: ingestionStateSchema,
  failureCode: z.string().nullable(),
  attempt: z.number().int(),
  mediaType: z.string().nullable(),
  originalFileName: z.string().nullable(),
  byteLength: z.number().int().nullable(),
  sourceUrl: z.string(),
  sourceSha256: sha256Schema.or(z.string()),
  sourceEffectStatus: z.string(),
  effectiveDate: z.string().nullable(),
  structureProfile: z.string().nullable(),
  chunkCount: z.number().int(),
  /** Provenance of an import: requested and final URL, retrieval time, HTTP status. */
  provenance: z.record(z.string(), z.unknown()).nullable(),
  /** What the extractor reported: tool, version, page and text counts. */
  extraction: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  ingestedAt: z.string().nullable(),
  hasOriginal: z.boolean(),
  canRetry: z.boolean(),
  canRemove: z.boolean(),
});
export type LegalSourceDocumentView = z.infer<
  typeof legalSourceDocumentViewSchema
>;

export const legalSourceIndexViewSchema = z.strictObject({
  version: z.string(),
  status: z.string(),
  contentHash: z.string(),
  validatedAt: z.string().nullable(),
});

export const legalSourceVersionSummarySchema = z.strictObject({
  id: z.string(),
  version: z.string(),
  status: lifecycleStatusSchema,
  basedOnVersionId: z.string().nullable(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
  documentCount: z.number().int(),
  readyDocumentCount: z.number().int(),
  chunkCount: z.number().int(),
});
export type LegalSourceVersionSummary = z.infer<
  typeof legalSourceVersionSummarySchema
>;

export const legalSourceSummarySchema = z.strictObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  versionCount: z.number().int(),
  activeVersion: legalSourceVersionSummarySchema.nullable(),
  latestVersion: legalSourceVersionSummarySchema.nullable(),
});
export type LegalSourceSummary = z.infer<typeof legalSourceSummarySchema>;

export const legalSourceListSchema = z.strictObject({
  items: z.array(legalSourceSummarySchema),
});
export type LegalSourceList = z.infer<typeof legalSourceListSchema>;

export const legalSourceDetailSchema = z.strictObject({
  ...legalSourceSummarySchema.shape,
  versions: z.array(legalSourceVersionSummarySchema),
  /** Whether a new draft version can be started (no other draft is open for this source). */
  canCreateVersion: z.boolean(),
  openDraftVersionId: z.string().nullable(),
});
export type LegalSourceDetail = z.infer<typeof legalSourceDetailSchema>;

export const legalSourceVersionDetailSchema = z.strictObject({
  ...legalSourceVersionSummarySchema.shape,
  source: z.strictObject({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
  }),
  documents: z.array(legalSourceDocumentViewSchema),
  index: legalSourceIndexViewSchema.nullable(),
  blockers: z.array(blockerSchema),
  canAddDocuments: z.boolean(),
  canActivate: z.boolean(),
  canDiscard: z.boolean(),
  /** Rule sets prepared from this version; a referenced version is never deleted. */
  ruleSetCount: z.number().int(),
});
export type LegalSourceVersionDetail = z.infer<
  typeof legalSourceVersionDetailSchema
>;

export const legalSourceChunkViewSchema = z.strictObject({
  id: z.string(),
  locator: z.string(),
  content: z.string(),
  contentSha256: z.string(),
  hierarchy: z.record(z.string(), z.unknown()),
  legalEffectStatus: legalEffectStatusSchema,
  legalStatusSourceRef: z.string().nullable(),
  pageStart: z.number().int().nullable(),
  pageEnd: z.number().int().nullable(),
});

export const legalSourceChunkPageSchema = z.strictObject({
  items: z.array(legalSourceChunkViewSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type LegalSourceChunkPage = z.infer<typeof legalSourceChunkPageSchema>;

/** Public (customer-facing) view of the one active Legal Source Version. */
export const activeLegalLibrarySchema = z.strictObject({
  versionId: z.string(),
  version: z.string(),
  sourceName: z.string(),
  activatedAt: z.string().nullable(),
  documents: z.array(
    z.strictObject({
      id: z.string(),
      documentId: z.string(),
      title: z.string(),
      sourceUrl: z.string(),
      sourceEffectStatus: z.string(),
      effectiveDate: z.string().nullable(),
      chunkCount: z.number().int(),
      mediaType: z.string().nullable(),
      hasOriginal: z.boolean(),
    }),
  ),
});
export type ActiveLegalLibrary = z.infer<typeof activeLegalLibrarySchema>;

/** Worker -> API: what the ingestion runtime produced for one document. */
export const legalSourceIngestionResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({
      outcome: z.literal(LEGAL_SOURCE_INGESTION_OUTCOMES.READY),
      attempt: z.number().int().min(1),
      extraction: z.strictObject({
        tool: z.string(),
        toolVersion: z.string(),
        structureProfile: z.string(),
        pageCount: z.number().int().nullable(),
        textSha256: sha256Schema,
        characterCount: z.number().int().min(1),
        /** Text before the first heading of a structured document; kept out of the chunks, never lost. */
        frontMatterCharacters: z.number().int().min(0).optional(),
      }),
      chunks: z
        .array(
          z.strictObject({
            locator: z.string().min(1).max(300),
            content: z.string().min(1),
            contentSha256: sha256Schema,
            hierarchy: z.record(z.string(), z.unknown()),
            pageStart: z.number().int().nullable(),
            pageEnd: z.number().int().nullable(),
          }),
        )
        .min(1)
        .max(20000),
    }),
    z.strictObject({
      outcome: z.literal(LEGAL_SOURCE_INGESTION_OUTCOMES.FAILED),
      attempt: z.number().int().min(1),
      failureCode: z.enum(
        Object.values(LEGAL_SOURCE_DOCUMENT_FAILURE_CODES) as [
          LegalSourceDocumentFailureCode,
          ...LegalSourceDocumentFailureCode[],
        ],
      ),
    }),
  ],
);
export type LegalSourceIngestionResult = z.infer<
  typeof legalSourceIngestionResultSchema
>;
