import { describe, expect, it, jest } from "@jest/globals";
import { RULE_SET_PREPARATION_REFUSAL_REASONS } from "@lcsp/contracts/compliance-rule-set";
import { LegalSourceLifecycleStatus, type Prisma } from "@prisma/client";
import { loadRuleSetPreparationAvailability } from "./rule-set-preparation-availability.loader.js";

describe("loadRuleSetPreparationAvailability", () => {
  it("reports ambiguity when multiple sources are ACTIVE without selecting either", async () => {
    const findMany = jest.fn((query: unknown) => {
      void query;
      return Promise.resolve([
        {
          id: "11111111-1111-4111-8111-111111111111",
          version: "version-a",
          integrityManifestRef: null,
          activations: [],
          retrievalIndexes: [],
          documents: [],
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          version: "version-b",
          integrityManifestRef: null,
          activations: [],
          retrievalIndexes: [],
          documents: [],
        },
      ]);
    });
    const tx = {
      legalSourceVersion: { findMany },
      complianceRuleSetVersion: { findFirst: jest.fn() },
      ruleSetPreparationRun: { findFirst: jest.fn() },
    } as unknown as Prisma.TransactionClient;

    const result = await loadRuleSetPreparationAvailability(tx);

    expect(result).toMatchObject({
      legalSourceVersionId: null,
      legalSourceVersion: null,
      canStart: false,
      canReplace: false,
      refusalReason:
        RULE_SET_PREPARATION_REFUSAL_REASONS.ACTIVE_SOURCE_AMBIGUOUS,
      activeSourceCandidates: [
        {
          legalSourceVersionId: "11111111-1111-4111-8111-111111111111",
          version: "version-a",
          sourceEvidenceComplete: false,
        },
        {
          legalSourceVersionId: "22222222-2222-4222-8222-222222222222",
          version: "version-b",
          sourceEvidenceComplete: false,
        },
      ],
      currentRun: null,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: LegalSourceLifecycleStatus.ACTIVE },
        take: 2,
      }),
    );
  });
});
