import { z } from "zod";

import { AUDIT_ACTOR_TYPES } from "../audit/audit-event.types.ts";
import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "./statuses.ts";
import { LEGAL_SOURCE_ERROR_CODES } from "./error-codes.ts";
import { LEGAL_SOURCE_EVENT_SCHEMA_VERSIONS } from "./event-types.ts";

const nonNegativeCountSchema = z.number().int().min(0);
const timestampSchema = z.iso.datetime({ offset: true });

export const LEGAL_SOURCE_DELETION_REASON_CODES = {
  duplicateSource: "DUPLICATE_SOURCE",
  sourceScopeRetired: "SOURCE_SCOPE_RETIRED",
  developmentDataCleanup: "DEVELOPMENT_DATA_CLEANUP",
  other: "OTHER",
} as const;
export type LegalSourceDeletionReasonCode =
  (typeof LEGAL_SOURCE_DELETION_REASON_CODES)[keyof typeof LEGAL_SOURCE_DELETION_REASON_CODES];

export const LEGAL_SOURCE_DELETION_BLOCKERS = {
  protectedReferenceExists: "PROTECTED_REFERENCE_EXISTS",
  nonterminalWorkExists: "NONTERMINAL_WORK_EXISTS",
  unsettledIngestionExists: "UNSETTLED_INGESTION_EXISTS",
  unsettledOutboxExists: "UNSETTLED_OUTBOX_EXISTS",
  retentionHoldExists: "RETENTION_HOLD_EXISTS",
} as const;
export type LegalSourceDeletionBlocker =
  (typeof LEGAL_SOURCE_DELETION_BLOCKERS)[keyof typeof LEGAL_SOURCE_DELETION_BLOCKERS];

export const LEGAL_SOURCE_DELETION_ERROR_CODES = {
  sourceNotFound: LEGAL_SOURCE_ERROR_CODES.sourceNotFound,
  deletionBlocked: "LEGAL_SOURCE_DELETION_BLOCKED",
  impactStale: "LEGAL_SOURCE_DELETION_IMPACT_STALE",
  confirmationMismatch: "LEGAL_SOURCE_DELETION_CONFIRMATION_MISMATCH",
  idempotencyConflict: "LEGAL_SOURCE_DELETION_IDEMPOTENCY_CONFLICT",
} as const;
export type LegalSourceDeletionErrorCode =
  (typeof LEGAL_SOURCE_DELETION_ERROR_CODES)[keyof typeof LEGAL_SOURCE_DELETION_ERROR_CODES];

const versionReferenceCountsSchema = z.strictObject({
  legalSourceDocuments: nonNegativeCountSchema,
  chunks: nonNegativeCountSchema,
  activationRecords: nonNegativeCountSchema,
  preparationRuns: nonNegativeCountSchema,
  ruleSetVersions: nonNegativeCountSchema,
  assessments: nonNegativeCountSchema,
  assessmentRuleAuditRequests: nonNegativeCountSchema,
  finalReports: nonNegativeCountSchema,
  provenanceReferences: nonNegativeCountSchema,
  documentGraphMaterializations: nonNegativeCountSchema,
});

export const legalSourceDeletionVersionImpactSchema = z.strictObject({
  versionId: z.uuid(),
  version: z.string().min(1).max(120),
  status: z.enum(Object.values(LEGAL_SOURCE_LIFECYCLE_STATUSES)),
  activatedEver: z.boolean(),
  references: versionReferenceCountsSchema,
  ingestion: z.strictObject({
    pendingDocuments: nonNegativeCountSchema,
    processingDocuments: nonNegativeCountSchema,
    failedDocuments: nonNegativeCountSchema,
    unsettledAttempts: nonNegativeCountSchema,
    unsettledOutboxMessages: nonNegativeCountSchema,
  }),
  nonterminalPreparations: nonNegativeCountSchema,
  nonterminalAssessments: nonNegativeCountSchema,
});
export type LegalSourceDeletionVersionImpact = z.infer<
  typeof legalSourceDeletionVersionImpactSchema
>;

/** This is diagnostic preflight data only; final eligibility is rechecked inside deletion transaction. */
export const legalSourceDeletionImpactResponseSchema = z
  .strictObject({
    source: z.strictObject({
      id: z.uuid(),
      slug: z.string().min(1).max(64),
      name: z.string().min(1).max(120),
    }),
    snapshot: z.strictObject({
      etag: z.string().min(1).max(200),
      generatedAt: timestampSchema,
    }),
    preflightOnly: z.literal(true),
    versions: z.array(legalSourceDeletionVersionImpactSchema),
    cascade: z.strictObject({
      documents: nonNegativeCountSchema,
      chunks: nonNegativeCountSchema,
      activationRecords: nonNegativeCountSchema,
      preparationRuns: nonNegativeCountSchema,
      ruleSetVersions: nonNegativeCountSchema,
      ownedRuleSetRecords: nonNegativeCountSchema,
      documentGraphRecords: nonNegativeCountSchema,
      orphanedBlobs: nonNegativeCountSchema,
    }),
    versionCounts: z.strictObject({
      total: nonNegativeCountSchema,
      byStatus: z.record(
        z.enum(Object.values(LEGAL_SOURCE_LIFECYCLE_STATUSES)),
        nonNegativeCountSchema,
      ),
    }),
    sharedBlobs: z.strictObject({
      referencedBySurvivingDocuments: nonNegativeCountSchema,
      eligibleForGarbageCollection: nonNegativeCountSchema,
    }),
    retention: z.strictObject({
      independentSnapshots: nonNegativeCountSchema,
      snapshotsWillBePreserved: z.literal(true),
      auditEvidenceWillBePreserved: z.literal(true),
      retentionHold: z.boolean(),
    }),
    eligibility: z.strictObject({
      eligibleAtSnapshot: z.boolean(),
      blockers: z.array(z.enum(LEGAL_SOURCE_DELETION_BLOCKERS)),
    }),
  })
  .superRefine((impact, context) => {
    if (impact.versionCounts.total !== impact.versions.length) {
      context.addIssue({
        code: "custom",
        path: ["versionCounts", "total"],
        message: "Version total must match version details",
      });
    }
    const actualCounts = Object.fromEntries(
      Object.values(LEGAL_SOURCE_LIFECYCLE_STATUSES).map((status) => [
        status,
        impact.versions.filter((version) => version.status === status).length,
      ]),
    );
    for (const [status, count] of Object.entries(actualCounts)) {
      if (
        impact.versionCounts.byStatus[
          status as keyof typeof impact.versionCounts.byStatus
        ] !== count
      ) {
        context.addIssue({
          code: "custom",
          path: ["versionCounts", "byStatus", status],
          message: "Lifecycle counts must match version details",
        });
      }
    }
    if (actualCounts[LEGAL_SOURCE_LIFECYCLE_STATUSES.draft] > 1) {
      context.addIssue({
        code: "custom",
        path: ["versions"],
        message: "A Legal Source can contain at most one DRAFT version",
      });
    }
    const hasProtectedReferences = impact.versions.some((version) => {
      const references = version.references;
      return (
        references.assessments > 0 ||
        references.assessmentRuleAuditRequests > 0 ||
        references.finalReports > 0 ||
        version.nonterminalPreparations > 0 ||
        version.nonterminalAssessments > 0 ||
        version.ingestion.pendingDocuments > 0 ||
        version.ingestion.processingDocuments > 0 ||
        version.ingestion.unsettledAttempts > 0 ||
        version.ingestion.unsettledOutboxMessages > 0
      );
    });
    if (
      impact.eligibility.eligibleAtSnapshot &&
      (hasProtectedReferences || impact.retention.retentionHold)
    ) {
      context.addIssue({
        code: "custom",
        path: ["eligibility"],
        message:
          "Protected assessment references, unsettled work, or retention holds prevent deletion eligibility",
      });
    }
    if (
      impact.eligibility.eligibleAtSnapshot !==
      (impact.eligibility.blockers.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["eligibility"],
        message: "Eligibility must agree with blocker presence",
      });
    }
  });
export type LegalSourceDeletionImpactResponse = z.infer<
  typeof legalSourceDeletionImpactResponseSchema
>;

export const deleteLegalSourceRequestSchema = z.strictObject({
  expectedImpactEtag: z.string().min(1).max(200),
  confirmationSlug: z.string().trim().min(3).max(64),
  reason: z.strictObject({
    code: z.enum(LEGAL_SOURCE_DELETION_REASON_CODES),
    text: z.string().trim().min(1).max(1000),
  }),
  idempotencyKey: z.uuid(),
});
export type DeleteLegalSourceRequest = z.infer<
  typeof deleteLegalSourceRequestSchema
>;

export const deleteLegalSourceResponseSchema = z.strictObject({
  sourceId: z.uuid(),
  deletionReceiptId: z.uuid(),
  deletedVersionIds: z.array(z.uuid()),
  deletedAt: timestampSchema,
  retainedIndependentSnapshotCount: nonNegativeCountSchema,
  retainedAuditEvidence: z.literal(true),
  idempotentReplay: z.boolean(),
});
export type DeleteLegalSourceResponse = z.infer<
  typeof deleteLegalSourceResponseSchema
>;

/** Event payloads carry identifiers and reason classification only, never source content or free-form reason text. */
export const legalSourceDeletedEventSchema = z.strictObject({
  schemaVersion: z.literal(LEGAL_SOURCE_EVENT_SCHEMA_VERSIONS.deletion),
  eventId: z.uuid(),
  sourceId: z.uuid(),
  deletedVersionIds: z.array(z.uuid()),
  deletionReceiptId: z.uuid(),
  reasonCode: z.enum(LEGAL_SOURCE_DELETION_REASON_CODES),
  actor: z.strictObject({
    id: z.string().min(1).max(200).nullable(),
    type: z.enum(AUDIT_ACTOR_TYPES),
  }),
  correlationId: z.string().min(1).max(200),
  idempotencyKey: z.uuid(),
  occurredAt: timestampSchema,
});
export type LegalSourceDeletedEvent = z.infer<
  typeof legalSourceDeletedEventSchema
>;
