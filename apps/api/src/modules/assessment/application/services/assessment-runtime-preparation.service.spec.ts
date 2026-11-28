import { describe, expect, it, jest } from "@jest/globals";
import {
  ArtifactLifecycleState,
  AssessmentAuditMode,
  type Prisma,
} from "@prisma/client";

import { OFFICIAL_LEGAL_CORPUS } from "../../../legal-source/domain/official-legal-authority.js";
import {
  AssessmentRuntimePreparation,
  PIN_RESULTS,
} from "./assessment-runtime-preparation.service.js";

function harness(pinnedId: string | null = null) {
  // An active historical artifact with no admitted original must never supply a new pin.
  const version = {
    id: "legacy",
    legalSourceVersionId: "legacy-source",
    selectedPreparationResults: null as unknown,
  };
  const client = {
    $queryRaw: jest.fn(async () => [{ acquired: true }]),
    complianceRuleSetVersion: {
      findFirst: jest.fn(
        async ({ where }: Prisma.ComplianceRuleSetVersionFindFirstArgs) =>
          where?.lifecycleState === ArtifactLifecycleState.ACTIVE
            ? version
            : null,
      ),
    },
    legalSourceDocument: {
      findMany: jest
        .fn<
          (args: Prisma.LegalSourceDocumentFindManyArgs) => Promise<
            Array<{
              sourceUrl: string;
              sourceSha256: string;
              blobSha256: string;
            }>
          >
        >()
        .mockResolvedValue([]),
    },
    assessmentCase: {
      create: jest.fn(),
      findUnique: jest.fn(async () => ({
        ruleSetVersionId: pinnedId,
        auditMode: AssessmentAuditMode.CUSTOMER_SELECTED,
      })),
      update: jest.fn(),
    },
    repositorySnapshot: {
      findFirst: jest.fn(async () => ({
        id: "snapshot",
        commitSha: "a".repeat(40),
      })),
    },
    repositoryScanJob: { upsert: jest.fn(async () => ({ id: "ticket" })) },
    assessmentRule: {
      findMany: jest.fn(async (_args: Prisma.AssessmentRuleFindManyArgs) => [
        { assessmentRuleId: "rule", assessmentRuleVersion: 1 },
      ]),
    },
  };
  return {
    client,
    tx: client as unknown as Prisma.TransactionClient,
    service: new AssessmentRuntimePreparation({} as never, {} as never),
  };
}

describe("New assessment legal admission", () => {
  it("leaves a new case unpinned when historical authority is ineligible", async () => {
    const { service, tx, client } = harness();
    await expect(service.createCaseInTx(tx, "assessment")).resolves.toEqual({
      ruleSetVersionId: null,
    });
    expect(client.assessmentCase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ruleSetVersionId: null }),
    });
  });

  it("defers a late pin when the active version lacks admitted originals", async () => {
    const { service, tx, client } = harness();
    await expect(
      service.pinRuntimeInputsInTx(tx, {
        assessmentId: "assessment",
        snapshotId: "snapshot",
        correlationId: "cid",
      }),
    ).resolves.toEqual({ result: PIN_RESULTS.WAITING_FOR_COMPLIANCE_RULE_SET });
    expect(client.assessmentCase.update).not.toHaveBeenCalled();
  });

  it("admits an active rule set with an official original", async () => {
    const { service, tx, client } = harness();
    const { downloadUrl, sha256 } = OFFICIAL_LEGAL_CORPUS[0];
    client.legalSourceDocument.findMany.mockResolvedValue([
      { sourceUrl: downloadUrl, sourceSha256: sha256, blobSha256: sha256 },
    ]);
    await expect(service.createCaseInTx(tx, "assessment")).resolves.toEqual({
      ruleSetVersionId: "legacy",
    });
    expect(client.legalSourceDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { legalSourceVersionId: "legacy-source" },
      }),
    );
  });

  it("continues an existing historical pin without re-admitting the corpus", async () => {
    const { service, tx, client } = harness("historic-pin");
    await expect(
      service.pinRuntimeInputsInTx(tx, {
        assessmentId: "assessment",
        snapshotId: "snapshot",
        correlationId: "cid",
      }),
    ).resolves.toEqual({ result: PIN_RESULTS.PINNED });
    expect(client.complianceRuleSetVersion.findFirst).not.toHaveBeenCalled();
    expect(client.legalSourceDocument.findMany).not.toHaveBeenCalled();
    expect(client.assessmentRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ruleSetVersionId: "historic-pin" } }),
    );
  });
});
