import { describe, expect, it, jest } from "@jest/globals";
import { LegalEffectStatus } from "@prisma/client";
import {
  LEGAL_RULE_CATALOG_ERRORS,
  LEGAL_RULE_CATALOG_EVENTS,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  LegalRuleCatalogService,
  isEligibleLegalChunkStatus,
} from "./legal-rule-catalog.service.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";

describe("LegalRuleCatalogService.deleteCatalog", () => {
  const catalogId = "11111111-1111-4111-8111-111111111111";
  const actor = "test-admin";
  const cid = "test-cid";

  function createService(overrides: {
    catalog?: { id: string; version: string } | null;
    activeRuns?: { id: string } | null;
  }) {
    const catalogFindUnique =
      jest.fn<
        (args: unknown) => Promise<{ id: string; version: string } | null>
      >();
    catalogFindUnique.mockResolvedValue(
      overrides.catalog !== undefined
        ? overrides.catalog
        : { id: catalogId, version: "v1-catalog" },
    );

    const catalogDelete = jest.fn<(args: unknown) => Promise<{ id: string }>>();
    catalogDelete.mockResolvedValue({ id: catalogId });

    const preparationResultFindFirst =
      jest.fn<(args: unknown) => Promise<{ id: string } | null>>();
    preparationResultFindFirst.mockResolvedValue(
      overrides.activeRuns !== undefined ? overrides.activeRuns : null,
    );

    const preparationResultDeleteMany =
      jest.fn<(args: unknown) => Promise<{ count: number }>>();
    preparationResultDeleteMany.mockResolvedValue({ count: 2 });

    const preparationRuleDeleteMany =
      jest.fn<(args: unknown) => Promise<{ count: number }>>();
    preparationRuleDeleteMany.mockResolvedValue({ count: 2 });

    const preparationBatchDeleteMany =
      jest.fn<(args: unknown) => Promise<{ count: number }>>();
    preparationBatchDeleteMany.mockResolvedValue({ count: 1 });

    const preparationSelectionDeleteMany =
      jest.fn<(args: unknown) => Promise<{ count: number }>>();
    preparationSelectionDeleteMany.mockResolvedValue({ count: 1 });

    const legalRuleDeleteMany =
      jest.fn<(args: unknown) => Promise<{ count: number }>>();
    legalRuleDeleteMany.mockResolvedValue({ count: 5 });

    const mockTx = {
      legalRuleCatalogVersion: {
        findUnique: catalogFindUnique,
        delete: catalogDelete,
      },
      preparationRuleResult: {
        findFirst: preparationResultFindFirst,
        deleteMany: preparationResultDeleteMany,
      },
      preparationRule: {
        deleteMany: preparationRuleDeleteMany,
      },
      preparationRuleBatch: {
        deleteMany: preparationBatchDeleteMany,
      },
      preparationRuleSelection: {
        deleteMany: preparationSelectionDeleteMany,
      },
      legalRule: {
        deleteMany: legalRuleDeleteMany,
      },
    };

    const mockPrisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx),
      ),
    } as unknown as PrismaService;

    const writeInTx =
      jest.fn<(event: unknown, tx?: unknown) => Promise<void>>();
    writeInTx.mockResolvedValue(undefined);

    const mockAudit = {
      writeInTx,
    } as unknown as AuditWriterService;

    const service = new LegalRuleCatalogService(mockPrisma, mockAudit);
    return {
      service,
      mockTx,
      writeInTx,
      catalogDelete,
      preparationResultDeleteMany,
      preparationRuleDeleteMany,
      preparationBatchDeleteMany,
      preparationSelectionDeleteMany,
      legalRuleDeleteMany,
    };
  }

  it("throws 404 when catalog is not found", async () => {
    const { service } = createService({ catalog: null });
    await expect(
      service.deleteCatalog(catalogId, actor, cid),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        problem: expect.objectContaining({
          code: LEGAL_RULE_CATALOG_ERRORS.NOT_FOUND,
          status: 404,
        }),
      },
    });
  });

  it("throws 409 conflict when active or queued preparation runs exist", async () => {
    const { service, catalogDelete } = createService({
      activeRuns: { id: "result-1" },
    });
    await expect(
      service.deleteCatalog(catalogId, actor, cid),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        problem: expect.objectContaining({
          code: LEGAL_RULE_CATALOG_ERRORS.CONFLICT,
          status: 409,
        }),
      },
    });
    expect(catalogDelete).not.toHaveBeenCalled();
  });

  it("cascades deletion and writes audit trail when idle", async () => {
    const {
      service,
      mockTx,
      writeInTx,
      catalogDelete,
      preparationResultDeleteMany,
      preparationRuleDeleteMany,
      preparationBatchDeleteMany,
      preparationSelectionDeleteMany,
      legalRuleDeleteMany,
    } = createService({});
    const result = await service.deleteCatalog(catalogId, actor, cid);

    expect(result).toEqual({ id: catalogId, deleted: true });
    expect(preparationResultDeleteMany).toHaveBeenCalledWith({
      where: {
        preparationRule: {
          legalRule: {
            catalogVersionId: catalogId,
          },
        },
      },
    });
    expect(preparationRuleDeleteMany).toHaveBeenCalledWith({
      where: {
        legalRule: {
          catalogVersionId: catalogId,
        },
      },
    });
    expect(preparationBatchDeleteMany).toHaveBeenCalledWith({
      where: {
        selection: {
          catalogVersionId: catalogId,
        },
      },
    });
    expect(preparationSelectionDeleteMany).toHaveBeenCalledWith({
      where: {
        catalogVersionId: catalogId,
      },
    });
    expect(legalRuleDeleteMany).toHaveBeenCalledWith({
      where: {
        catalogVersionId: catalogId,
      },
    });
    expect(catalogDelete).toHaveBeenCalledWith({
      where: { id: catalogId },
    });
    expect(writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: LEGAL_RULE_CATALOG_EVENTS.DELETED,
        resourceId: catalogId,
        actorId: actor,
      }),
      mockTx,
    );
  });
});

describe("isEligibleLegalChunkStatus", () => {
  it("allows EFFECTIVE chunks", () => {
    expect(isEligibleLegalChunkStatus(LegalEffectStatus.EFFECTIVE)).toBe(true);
  });

  it("allows UNKNOWN unreviewed chunks", () => {
    expect(isEligibleLegalChunkStatus(LegalEffectStatus.UNKNOWN)).toBe(true);
  });

  it("rejects REPEALED chunks", () => {
    expect(isEligibleLegalChunkStatus(LegalEffectStatus.REPEALED)).toBe(false);
  });

  it("rejects FUTURE chunks", () => {
    expect(isEligibleLegalChunkStatus(LegalEffectStatus.FUTURE)).toBe(false);
  });
});
