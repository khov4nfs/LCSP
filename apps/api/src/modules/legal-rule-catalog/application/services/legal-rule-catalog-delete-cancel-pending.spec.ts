import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState } from "@prisma/client";
import { LEGAL_RULE_CATALOG_ERRORS } from "@lcsp/contracts/legal-rule-catalog";

import { LegalRuleCatalogService } from "./legal-rule-catalog.service.js";

describe("Catalog deletion while native cancellation is pending", () => {
  it("includes CANCEL_REQUESTED in the database conflict query", async () => {
    const order: string[] = [];
    const lock = jest.fn(() => {
      order.push("lock");
      return Promise.resolve([{ id: "catalog-1" }]);
    });
    const findFirst = jest.fn((query: unknown) => {
      order.push("active-runs");
      void query;
      return Promise.resolve({ id: "unresolved-result" });
    });
    const tx = {
      $queryRaw: lock,
      legalRuleCatalogVersion: {
        findUnique: () => {
          order.push("catalog");
          return Promise.resolve({ id: "catalog-1" });
        },
      },
      preparationRuleResult: { findFirst },
    };
    const prisma = {
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
        await work(tx),
    };
    const service = Reflect.construct(LegalRuleCatalogService, [
      prisma,
      {},
      {},
    ]) as LegalRuleCatalogService;

    await expect(
      service.deleteCatalog("catalog-1", "admin-1", "cancel-pending-test"),
    ).rejects.toMatchObject({
      response: { problem: { code: LEGAL_RULE_CATALOG_ERRORS.CONFLICT } },
    });
    // Why: Submit takes the catalog row lock before creating a run; delete must serialize on it.
    expect(order).toEqual(["lock", "catalog", "active-runs"]);
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        preparationRun: {
          executionState: {
            in: expect.arrayContaining([AgentExecutionState.CANCEL_REQUESTED]),
          },
        },
      },
    });
  });
});
