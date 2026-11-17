import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState } from "@prisma/client";
import { LEGAL_RULE_CATALOG_ERRORS, LEGAL_RULE_CATALOG_EVENTS } from "@lcsp/contracts/legal-rule-catalog";
import { LegalRuleCatalogService } from "./legal-rule-catalog.service.js";
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
    const mockTx = {
      legalRuleCatalogVersion: {
        findUnique: jest.fn<any>().mockResolvedValue(overrides.catalog !== undefined ? overrides.catalog : { id: catalogId, version: "v1-catalog" }),
        delete: jest.fn<any>().mockResolvedValue({ id: catalogId }),
      },
      preparationRuleResult: {
        findFirst: jest.fn<any>().mockResolvedValue(overrides.activeRuns !== undefined ? overrides.activeRuns : null),
        deleteMany: jest.fn<any>().mockResolvedValue({ count: 2 }),
      },
      preparationRule: {
        deleteMany: jest.fn<any>().mockResolvedValue({ count: 2 }),
      },
      preparationRuleBatch: {
        deleteMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
      },
      preparationRuleSelection: {
        deleteMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
      },
      legalRule: {
        deleteMany: jest.fn<any>().mockResolvedValue({ count: 5 }),
      },
    };

    const mockPrisma = {
      $transaction: jest.fn<any>().mockImplementation((callback: any) => callback(mockTx)),
    } as unknown as PrismaService;

    const mockAudit = {
      writeInTx: jest.fn<any>().mockResolvedValue(undefined),
    } as unknown as AuditWriterService;

    const service = new LegalRuleCatalogService(mockPrisma, mockAudit);
    return { service, mockTx, mockAudit };
  }

  it("throws 404 when catalog is not found", async () => {
    const { service } = createService({ catalog: null });
    await expect(service.deleteCatalog(catalogId, actor, cid)).rejects.toMatchObject({
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
    const { service, mockTx } = createService({
      activeRuns: { id: "result-1" },
    });
    await expect(service.deleteCatalog(catalogId, actor, cid)).rejects.toMatchObject({
      response: {
        ok: false,
        problem: expect.objectContaining({
          code: LEGAL_RULE_CATALOG_ERRORS.CONFLICT,
          status: 409,
        }),
      },
    });
    expect(mockTx.legalRuleCatalogVersion.delete).not.toHaveBeenCalled();
  });

  it("cascades deletion and writes audit trail when idle", async () => {
    const { service, mockTx, mockAudit } = createService({});
    const result = await service.deleteCatalog(catalogId, actor, cid);

    expect(result).toEqual({ id: catalogId, deleted: true });
    expect(mockTx.preparationRuleResult.deleteMany).toHaveBeenCalledWith({
      where: {
        preparationRule: {
          legalRule: {
            catalogVersionId: catalogId,
          },
        },
      },
    });
    expect(mockTx.preparationRule.deleteMany).toHaveBeenCalledWith({
      where: {
        legalRule: {
          catalogVersionId: catalogId,
        },
      },
    });
    expect(mockTx.preparationRuleBatch.deleteMany).toHaveBeenCalledWith({
      where: {
        selection: {
          catalogVersionId: catalogId,
        },
      },
    });
    expect(mockTx.preparationRuleSelection.deleteMany).toHaveBeenCalledWith({
      where: {
        catalogVersionId: catalogId,
      },
    });
    expect(mockTx.legalRule.deleteMany).toHaveBeenCalledWith({
      where: {
        catalogVersionId: catalogId,
      },
    });
    expect(mockTx.legalRuleCatalogVersion.delete).toHaveBeenCalledWith({
      where: { id: catalogId },
    });
    expect(mockAudit.writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: LEGAL_RULE_CATALOG_EVENTS.DELETED,
        resourceId: catalogId,
        actorId: actor,
      }),
      mockTx,
    );
  });
});
