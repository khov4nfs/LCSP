import { describe, expect, it, jest } from "@jest/globals";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";

import { toPrismaLegalRuleLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { RuleCatalogVersionService } from "./rule-catalog-version.service.js";

describe("RuleCatalogVersionService", () => {
  it("recovers approved LegalRule rows from active corpus engineering candidate chunks", async () => {
    const approvedStatus = toPrismaLegalRuleLifecycleStatus(
      LEGAL_RULE_LIFECYCLE_STATUSES.approved,
    );
    const tx = {
      legalRuleCatalogVersion: {
        create: jest.fn().mockResolvedValue({
          id: "catalog-new",
          version: "AUTO-ENGINEERING-RULES-ABCDEF0123456789",
        } as never),
      },
      legalRule: {
        createMany: jest.fn().mockResolvedValue({ count: 1 } as never),
      },
      ruleApprovalRecord: {
        create: jest.fn().mockResolvedValue({ id: "approval-1" } as never),
      },
    };
    const prisma = {
      legalRuleCatalogVersion: {
        findMany: jest.fn().mockResolvedValue([] as never),
        findFirst: jest.fn().mockResolvedValue(null as never),
      },
      legalRule: {
        count: jest.fn().mockResolvedValue(0 as never),
      },
      legalCorpusVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "corpus-1",
          version: "VN-LEGAL-CORPUS-test",
          chunks: [
            {
              id: "LAW-134:art-11::cl-1",
              documentId: "LAW-134",
              locator: "art-11::cl-1",
              contentSha256: "sha256:abc",
              legalStatus: "ACTIVE",
              hierarchy: { normativeClass: "ENGINEERING_RULE_CANDIDATE" },
            },
            {
              id: "LAW-134:art-1",
              documentId: "LAW-134",
              locator: "art-1",
              contentSha256: "sha256:def",
              legalStatus: "ACTIVE",
              hierarchy: { normativeClass: "CONTEXT_ONLY" },
            },
          ],
        } as never),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    const service = new RuleCatalogVersionService(prisma as any);
    const result = await service.recoverApprovedRulesFromActiveCorpus({
      idempotencyKey: "recover-1",
      correlationId: "corr-1",
    });

    expect(result.status).toBe(LEGAL_RULE_LIFECYCLE_STATUSES.approved);
    expect(result.ruleCount).toBe(1);
    expect(tx.legalRuleCatalogVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: approvedStatus,
          ruleRefs: [
            expect.objectContaining({
              legalCorpusVersionId: "corpus-1",
              chunkId: "LAW-134:art-11::cl-1",
            }),
          ],
        }),
      }),
    );
    expect(tx.legalRule.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            legalRuleCatalogVersionId: "catalog-new",
            status: approvedStatus,
            citationLocatorRefs: [
              expect.objectContaining({
                legalCorpusVersionId: "corpus-1",
                documentId: "LAW-134",
                locator: "art-11::cl-1",
                id: "LAW-134:art-11::cl-1",
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("returns existing approved catalog when it already has rules", async () => {
    const prisma = {
      legalRuleCatalogVersion: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "catalog-existing", version: "existing" },
          ] as never),
      },
      legalRule: {
        count: jest.fn().mockResolvedValue(7 as never),
      },
    };

    const service = new RuleCatalogVersionService(prisma as any);
    const result = await service.recoverApprovedRulesFromActiveCorpus({
      idempotencyKey: "recover-1",
      correlationId: "corr-1",
    });

    expect(result).toMatchObject({
      id: "catalog-existing",
      version: "existing",
      ruleCount: 7,
      noChanges: true,
    });
  });

  it("recovers approved LegalRule rows from legacy active corpus chunks without stored normative class", async () => {
    const tx = {
      legalRuleCatalogVersion: {
        create: jest.fn().mockResolvedValue({
          id: "catalog-new",
          version: "AUTO-ENGINEERING-RULES-LEGACY",
        } as never),
      },
      legalRule: {
        createMany: jest.fn().mockResolvedValue({ count: 1 } as never),
      },
      ruleApprovalRecord: {
        create: jest.fn().mockResolvedValue({ id: "approval-1" } as never),
      },
    };
    const prisma = {
      legalRuleCatalogVersion: {
        findMany: jest.fn().mockResolvedValue([] as never),
        findFirst: jest.fn().mockResolvedValue(null as never),
      },
      legalRule: {
        count: jest.fn().mockResolvedValue(0 as never),
      },
      legalCorpusVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "corpus-legacy",
          version: "VN-LEGAL-CORPUS-legacy",
          chunks: [
            {
              id: "LAW-134:art-11::cl-2",
              documentId: "LAW-134",
              locator: "art-11::cl-2",
              content:
                "Hệ thống trí tuệ nhân tạo phải bảo đảm khả năng kiểm tra, giám sát và lưu trữ.",
              contentSha256: "sha256:legacy",
              legalStatus: "ACTIVE",
              hierarchy: { articleTitle: "Nghĩa vụ quản lý hệ thống" },
            },
          ],
        } as never),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    const service = new RuleCatalogVersionService(prisma as any);
    const result = await service.recoverApprovedRulesFromActiveCorpus({
      idempotencyKey: "recover-legacy",
      correlationId: "corr-1",
    });

    expect(result.status).toBe(LEGAL_RULE_LIFECYCLE_STATUSES.approved);
    expect(result.ruleCount).toBe(1);
    expect(tx.legalRule.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            legalRuleCatalogVersionId: "catalog-new",
            citationLocatorRefs: [
              expect.objectContaining({
                legalCorpusVersionId: "corpus-legacy",
                id: "LAW-134:art-11::cl-2",
              }),
            ],
          }),
        ],
      }),
    );
  });

  it("normalizes legacy normative class metadata before recovering approved rules", async () => {
    const tx = {
      legalRuleCatalogVersion: {
        create: jest.fn().mockResolvedValue({
          id: "catalog-new",
          version: "AUTO-ENGINEERING-RULES-NORMALIZED",
        } as never),
      },
      legalRule: {
        createMany: jest.fn().mockResolvedValue({ count: 1 } as never),
      },
      ruleApprovalRecord: {
        create: jest.fn().mockResolvedValue({ id: "approval-1" } as never),
      },
    };
    const prisma = {
      legalRuleCatalogVersion: {
        findMany: jest.fn().mockResolvedValue([] as never),
        findFirst: jest.fn().mockResolvedValue(null as never),
      },
      legalRule: {
        count: jest.fn().mockResolvedValue(0 as never),
      },
      legalCorpusVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "corpus-normalized",
          version: "VN-LEGAL-CORPUS-normalized",
          chunks: [
            {
              id: "LAW-134:art-12::cl-1",
              documentId: "LAW-134",
              locator: "art-12::cl-1",
              contentSha256: "sha256:normalized",
              legalStatus: "ACTIVE",
              hierarchy: { normativeClass: "engineering-rule-candidate" },
            },
          ],
        } as never),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    const service = new RuleCatalogVersionService(prisma as any);
    const result = await service.recoverApprovedRulesFromActiveCorpus({
      idempotencyKey: "recover-normalized",
      correlationId: "corr-1",
    });

    expect(result.status).toBe(LEGAL_RULE_LIFECYCLE_STATUSES.approved);
    expect(result.ruleCount).toBe(1);
    expect(tx.legalRule.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            legalRuleCatalogVersionId: "catalog-new",
            status: toPrismaLegalRuleLifecycleStatus(
              LEGAL_RULE_LIFECYCLE_STATUSES.approved,
            ),
          }),
        ],
      }),
    );
  });
});
