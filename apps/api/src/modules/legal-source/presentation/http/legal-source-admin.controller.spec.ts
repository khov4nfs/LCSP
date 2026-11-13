import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type {
  DeleteLegalSourceRequest,
  DeleteLegalSourceResponse,
  LegalSourceDeletionImpactResponse,
} from "@lcsp/contracts/legal-source";
import { describe, expect, it, jest } from "@jest/globals";

import type { LegalSourceDeletionService } from "../../application/services/legal-source-deletion.service.js";
import { RBAC_METADATA_KEY } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { LegalSourceAdminController } from "./legal-source-admin.controller.js";

describe("LegalSourceAdminController source deletion routes", () => {
  it("exposes Admin-only impact and delete endpoints with success envelopes", async () => {
    const sourceId = "e4d528d1-a1b4-4a42-a2ad-257fb3fd3741";
    const deletionReceiptId = "24591270-feb4-48de-af63-0c34ab4e4a5e";
    const impact: LegalSourceDeletionImpactResponse = {
      source: { id: sourceId, slug: "source-to-delete", name: "Source" },
      snapshot: {
        etag: "sha256:test",
        generatedAt: "2026-11-13T10:00:00.000Z",
      },
      preflightOnly: true,
      versions: [],
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
      versionCounts: {
        total: 0,
        byStatus: { DRAFT: 0, ACTIVE: 0, SUPERSEDED: 0, INVALID: 0 },
      },
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
    const deletionResult: DeleteLegalSourceResponse = {
      sourceId,
      deletionReceiptId,
      deletedVersionIds: [],
      deletedAt: "2026-11-13T10:00:00.000Z",
      retainedIndependentSnapshotCount: 0,
      retainedAuditEvidence: true,
      idempotentReplay: false,
    };
    const deletion = {
      getImpact: jest
        .fn<LegalSourceDeletionService["getImpact"]>()
        .mockResolvedValue(impact),
      deleteSource: jest
        .fn<LegalSourceDeletionService["deleteSource"]>()
        .mockResolvedValue(deletionResult),
    };
    const controller = new LegalSourceAdminController(
      {} as never,
      {} as never,
      deletion as never,
    );
    const request = {
      correlationId: "corr-delete-1",
      rbacContext: { userId: "admin-user" },
    } as never;
    const deleteRequest: DeleteLegalSourceRequest = {
      expectedImpactEtag: "sha256:test",
      confirmationSlug: "source-to-delete",
      reason: { code: "OTHER", text: "Approved test cleanup" },
      idempotencyKey: "c8c690dd-585d-4ac7-8ff8-3bb193ff9de4",
    };

    expect(
      Reflect.getMetadata(RBAC_METADATA_KEY, LegalSourceAdminController),
    ).toEqual({ type: "roles", roles: [AUTH_USER_ROLES.admin] });
    const impactRoute = Object.getOwnPropertyDescriptor(
      LegalSourceAdminController.prototype,
      "deletionImpact",
    )?.value as object;
    const deleteRoute = Object.getOwnPropertyDescriptor(
      LegalSourceAdminController.prototype,
      "deleteSource",
    )?.value as object;
    expect(Reflect.getMetadata("path", impactRoute)).toBe(
      "legal-sources/:sourceId/deletion-impact",
    );
    expect(Reflect.getMetadata("path", deleteRoute)).toBe(
      "legal-sources/:sourceId",
    );

    await expect(controller.deletionImpact(sourceId, request)).resolves.toEqual(
      {
        ok: true,
        data: impact,
      },
    );
    await expect(
      controller.deleteSource(sourceId, deleteRequest, request),
    ).resolves.toEqual({ ok: true, data: deletionResult });
    expect(deletion.deleteSource).toHaveBeenCalledWith({
      sourceId,
      actorId: "admin-user",
      correlationId: "corr-delete-1",
      request: deleteRequest,
    });
  });
});
