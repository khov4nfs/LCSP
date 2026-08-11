import { describe, expect, it, jest } from "@jest/globals";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaLegalRuleLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";
import { GetActiveRuleCatalogHandler } from "./get-active-rule-catalog.handler.js";

describe("GetActiveRuleCatalogHandler", () => {
  it("returns the latest approved rule catalog and approved rules", async () => {
    const prisma = {
      legalRuleCatalogVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "catalog-1",
          version: "v1",
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
        }),
      },
      legalRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            legalRuleId: "RULE-A",
            requiredFacts: [
              {
                field: "businessProcess",
                expectedValue: "AUTOMATED_DECISION",
              },
            ],
            optionalFacts: [],
            blockingFacts: [],
            unknownFactPolicy: "BLOCK_ON_UNKNOWN",
            citationLocatorRefs: [
              {
                legalCorpusVersionId: "corpus-1",
                documentId: "doc-1",
                locator: "art-1",
              },
            ],
            ruleFamily: "ai-use",
          },
        ]),
      },
      legalDocumentChunk: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "chunk-1",
            legalCorpusVersionId: "corpus-1",
            documentId: "doc-1",
            locator: "art-1",
            legalStatus: "ACTIVE",
          },
        ]),
      },
    } as unknown as PrismaService;

    const handler = new GetActiveRuleCatalogHandler(prisma);
    const result = await handler.execute();

    expect(result.versionId).toBe("catalog-1");
    expect(result.rules[0]?.legalRuleId).toBe("RULE-A");
  });
});
