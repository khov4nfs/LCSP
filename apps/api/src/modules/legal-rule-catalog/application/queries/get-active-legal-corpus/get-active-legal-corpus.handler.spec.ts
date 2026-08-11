import { describe, expect, it, jest } from "@jest/globals";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaLegalRuleLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { GetActiveLegalCorpusHandler } from "./get-active-legal-corpus.handler.js";

describe("GetActiveLegalCorpusHandler", () => {
  it("returns the latest approved corpus from persistence", async () => {
    const approvedAt = new Date("2026-08-11T00:00:00.000Z");
    const prisma = {
      legalCorpusVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "corpus-v1",
          version: "VN-LEGAL-2026-08",
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
          createdAt: new Date("2026-08-10T00:00:00.000Z"),
          approvedAt,
        }),
      },
    } as unknown as PrismaService;

    const handler = new GetActiveLegalCorpusHandler(prisma);
    const result = await handler.execute();

    expect(result).toEqual({
      versionId: "corpus-v1",
      version: "VN-LEGAL-2026-08",
      status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      effectiveDate: approvedAt.toISOString(),
    });
  });
});
