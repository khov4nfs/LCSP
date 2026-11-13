import { describe, expect, it } from "@jest/globals";
import { AUDIT_ACTOR_TYPES } from "../src/audit/index.ts";
import {
  LEGAL_SOURCE_DELETION_BLOCKERS,
  LEGAL_SOURCE_DELETION_REASON_CODES,
  LEGAL_SOURCE_EVENT_SCHEMA_VERSIONS,
  LEGAL_SOURCE_LIFECYCLE_STATUSES as Status,
  deleteLegalSourceRequestSchema,
  legalSourceDeletionImpactResponseSchema,
  legalSourceDeletedEventSchema,
} from "../src/legal-source/index.ts";

const id = "11111111-1111-4111-8111-111111111111";

const emptyReferences = {
  legalSourceDocuments: 0,
  chunks: 0,
  activationRecords: 0,
  preparationRuns: 0,
  ruleSetVersions: 0,
  assessments: 0,
  assessmentRuleAuditRequests: 0,
  finalReports: 0,
  provenanceReferences: 0,
  documentGraphMaterializations: 0,
};

function impact(versions: Array<Record<string, unknown>>) {
  const byStatus = Object.fromEntries(
    Object.values(Status).map((status) => [
      status,
      versions.filter((version) => version.status === status).length,
    ]),
  );
  return {
    source: { id, slug: "sample-source", name: "Sample source" },
    snapshot: { etag: 'W/"impact-1"', generatedAt: "2026-11-13T10:00:00Z" },
    preflightOnly: true,
    versions,
    cascade: {
      documents: 0,
      chunks: 0,
      activationRecords: 0,
      preparationRuns: 0,
      ruleSetVersions: 0,
      ownedRuleSetRecords: 0,
      documentGraphRecords: 0,
      orphanedBlobs: 0,
    },
    versionCounts: { total: versions.length, byStatus },
    sharedBlobs: {
      referencedBySurvivingDocuments: 0,
      eligibleForGarbageCollection: 0,
    },
    retention: {
      independentSnapshots: 0,
      snapshotsWillBePreserved: true,
      auditEvidenceWillBePreserved: true,
      retentionHold: false,
    },
    eligibility: { eligibleAtSnapshot: true, blockers: [] },
  };
}

function version(versionId: string, status: string) {
  return {
    versionId,
    version: `${status.toLowerCase()}-v1`,
    status,
    activatedEver: false,
    references: emptyReferences,
    ingestion: {
      pendingDocuments: 0,
      processingDocuments: 0,
      failedDocuments: 0,
      unsettledAttempts: 0,
      unsettledOutboxMessages: 0,
    },
    nonterminalPreparations: 0,
    nonterminalAssessments: 0,
  };
}

describe("Legal Source deletion contracts", () => {
  it("represents zero-version and DRAFT/INVALID source deletion without permitting active history", () => {
    const noVersions = legalSourceDeletionImpactResponseSchema.parse(
      impact([]),
    );
    expect(noVersions.eligibility.eligibleAtSnapshot).toBe(true);

    const mixedEligibleVersions = legalSourceDeletionImpactResponseSchema.parse(
      impact([
        version(id, Status.draft),
        version("22222222-2222-4222-8222-222222222222", Status.invalid),
        version("33333333-3333-4333-8333-333333333333", Status.invalid),
      ]),
    );
    expect(mixedEligibleVersions.versionCounts.byStatus.DRAFT).toBe(1);
    expect(mixedEligibleVersions.versionCounts.byStatus.INVALID).toBe(2);

    const terminalFailure = version(id, Status.draft);
    terminalFailure.ingestion.failedDocuments = 1;
    expect(
      legalSourceDeletionImpactResponseSchema.safeParse(
        impact([terminalFailure]),
      ).success,
    ).toBe(true);

    const activeSource = legalSourceDeletionImpactResponseSchema.parse(
      impact([version(id, Status.active)]),
    );
    expect(activeSource.eligibility.eligibleAtSnapshot).toBe(true);
    expect(
      legalSourceDeletionImpactResponseSchema.safeParse({
        ...impact([version(id, Status.active)]),
        eligibility: {
          eligibleAtSnapshot: false,
          blockers: [LEGAL_SOURCE_DELETION_BLOCKERS.protectedReferenceExists],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects inconsistent impact snapshots and destructive requests without confirmation", () => {
    const malformed = impact([]);
    malformed.versionCounts.total = 1;
    expect(
      legalSourceDeletionImpactResponseSchema.safeParse(malformed).success,
    ).toBe(false);

    expect(
      deleteLegalSourceRequestSchema.safeParse({
        expectedImpactEtag: 'W/"impact-1"',
        confirmationSlug: "sample-source",
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.duplicateSource,
          text: "Duplicate source",
        },
        idempotencyKey: id,
        deleteAssessments: true,
      }).success,
    ).toBe(false);
    expect(
      deleteLegalSourceRequestSchema.safeParse({
        expectedImpactEtag: 'W/"impact-1"',
        confirmationSlug: "sample-source",
        reason: {
          code: LEGAL_SOURCE_DELETION_REASON_CODES.duplicateSource,
          text: "Duplicate source",
        },
        idempotencyKey: id,
      }).success,
    ).toBe(true);
  });

  it("keeps deletion events identifier-only and distinct from activation", () => {
    expect(
      legalSourceDeletedEventSchema.safeParse({
        schemaVersion: LEGAL_SOURCE_EVENT_SCHEMA_VERSIONS.deletion,
        eventId: id,
        sourceId: id,
        deletedVersionIds: [],
        deletionReceiptId: id,
        reasonCode: LEGAL_SOURCE_DELETION_REASON_CODES.developmentDataCleanup,
        actor: { id: "admin-1", type: AUDIT_ACTOR_TYPES.user },
        correlationId: "corr-1",
        idempotencyKey: id,
        occurredAt: "2026-11-13T10:00:00Z",
      }).success,
    ).toBe(true);
  });
});
