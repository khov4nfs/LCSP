import { z } from "zod";

import {
  LEGACY_ARCHIVE_SOURCES,
  LEGACY_ARTIFACT_AVAILABILITIES,
  LEGACY_ARTIFACT_RECONCILIATION_CLASSES,
  LEGACY_ARTIFACT_RECONCILIATION_REASONS,
  LEGACY_ASSESSMENT_DISPOSITIONS,
  LEGACY_MIGRATION_PHASES,
  LEGACY_MIGRATION_RUN_KINDS,
  LEGACY_VALIDATION_STATUSES,
} from "./constants.ts";

const identifierSchema = z.string().min(1).max(128);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const legacyArtifactReconciliationClassSchema = z.enum(
  LEGACY_ARTIFACT_RECONCILIATION_CLASSES,
);
export const legacyArtifactReconciliationReasonSchema = z.enum(
  LEGACY_ARTIFACT_RECONCILIATION_REASONS,
);

/** Customer-safe projection of one archived report-related V1 record. Codes only, never prose. */
export const legacyArchiveReportItemSchema = z.strictObject({
  // Deterministic md5-derived id: a GUID, not an RFC 4122 version/variant-constrained UUID.
  recordId: z.guid(),
  sourceTable: z.enum({
    DOCUMENT_REQUEST: LEGACY_ARCHIVE_SOURCES.DOCUMENT_REQUEST,
    READINESS_EXPORT: LEGACY_ARCHIVE_SOURCES.READINESS_EXPORT,
  }),
  documentType: z.string().nullable(),
  requestStatus: z.string().nullable(),
  requestedAt: z.iso.datetime().nullable(),
  reconciliationClass: legacyArtifactReconciliationClassSchema,
  reconciliationReason: legacyArtifactReconciliationReasonSchema,
  availability: z.enum(LEGACY_ARTIFACT_AVAILABILITIES),
  sizeBytes: z.number().int().nonnegative().nullable(),
  contentSha256: sha256Schema.nullable(),
});
export type LegacyArchiveReportItem = z.infer<
  typeof legacyArchiveReportItemSchema
>;

export const legacyArchiveSummarySchema = z.strictObject({
  assessment_id: identifierSchema,
  name: z.string(),
  disposition: z.enum(LEGACY_ASSESSMENT_DISPOSITIONS),
  legacy_status: z.string(),
  legacy_created_at: z.iso.datetime(),
  legacy_updated_at: z.iso.datetime(),
  archived_at: z.iso.datetime(),
  v2_lifecycle_state: z.string().nullable(),
  report_count: z.number().int().nonnegative(),
  downloadable_report_count: z.number().int().nonnegative(),
});
export type LegacyArchiveSummary = z.infer<typeof legacyArchiveSummarySchema>;

export const legacyArchiveListSchema = z.strictObject({
  archives: z.array(legacyArchiveSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  correlationId: z.string(),
});
export type LegacyArchiveList = z.infer<typeof legacyArchiveListSchema>;

export const legacyArchiveDetailSchema = legacyArchiveSummarySchema.extend({
  reports: z.array(legacyArchiveReportItemSchema),
  correlationId: z.string(),
});
export type LegacyArchiveDetail = z.infer<typeof legacyArchiveDetailSchema>;

export const legacyArchiveListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

/** Result of one validation check in the reconciliation report. */
export const legacyValidationCheckSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(LEGACY_VALIDATION_STATUSES),
  blocking: z.boolean(),
  observed: z.unknown(),
  expected: z.unknown(),
});
export type LegacyValidationCheck = z.infer<typeof legacyValidationCheckSchema>;

export const legacyArtifactReconciliationSummarySchema = z.strictObject({
  total: z.number().int().nonnegative(),
  byClass: z.record(
    z.enum(LEGACY_ARTIFACT_RECONCILIATION_CLASSES),
    z.number().int().nonnegative(),
  ),
  byReason: z.record(
    z.enum(LEGACY_ARTIFACT_RECONCILIATION_REASONS),
    z.number().int().nonnegative(),
  ),
  /** Source-inspection evidence for the placeholder uploader; carried into W7 release evidence. */
  uploaderEvidence: z.strictObject({
    sourcePath: z.string(),
    baselineCommit: z.string(),
    sha256: sha256Schema,
    behavior: z.string(),
    callers: z.array(z.string()),
  }),
  limitation: z.string().min(1),
});
export type LegacyArtifactReconciliationSummary = z.infer<
  typeof legacyArtifactReconciliationSummarySchema
>;

export const legacyMigrationValidationReportSchema = z.strictObject({
  runId: z.uuid(),
  kind: z.enum(LEGACY_MIGRATION_RUN_KINDS),
  generatedAt: z.iso.datetime(),
  phases: z.array(z.enum(LEGACY_MIGRATION_PHASES)),
  checks: z.array(legacyValidationCheckSchema),
  summary: z.strictObject({
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    blockingFailures: z.number().int().nonnegative(),
  }),
  artifactReconciliation: legacyArtifactReconciliationSummarySchema,
});
export type LegacyMigrationValidationReport = z.infer<
  typeof legacyMigrationValidationReportSchema
>;
