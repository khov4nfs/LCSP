import { describe, expect, it, jest } from "@jest/globals";
import {
  CUSTOMER_USAGE_PRICING,
  USAGE_TOKEN_FIELDS,
  adminUsageAnalyticsSchema,
  customerUsageQuerySchema,
  type AdminUsageQuery,
} from "@lcsp/contracts/billing";
import { GetCustomerUsageHandler } from "../src/modules/billing/application/queries/get-customer-usage/get-customer-usage.handler.js";
import { GetCustomerUsageQuery } from "../src/modules/billing/application/queries/get-customer-usage/get-customer-usage.query.js";

describe("Customer Usage selling estimate", () => {
  it.each([false, true])(
    "quotes complete/partial reports without mutating reference cost (incomplete=%s)",
    async (incomplete) => {
      const report = adminUsageAnalyticsSchema.parse({
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-18T00:00:00.000Z",
        page: 1,
        pageSize: 25,
        totalCount: 1,
        items: [],
        breakdowns: [],
        summary: {
          calls: 1,
          successfulResponses: 1,
          failedAttempts: 0,
          unresolvedAttempts: 0,
          usageUnknownInvocations: 0,
          unpricedInvocations: 0,
          incompleteCostInvocations: incomplete ? 1 : 0,
          tokens: Object.fromEntries(
            USAGE_TOKEN_FIELDS.map((field) => [
              field,
              { known: "100", unknownInvocations: 0 },
            ]),
          ),
          knownEstimatedCostUsd: "0.01",
          estimatedCostUsd: incomplete ? null : "0.01",
        },
      });
      const before = structuredClone(report);
      const read = jest
        .fn<(query: AdminUsageQuery) => Promise<typeof report>>()
        .mockResolvedValue(report);
      const handler = new GetCustomerUsageHandler({ read } as never);
      const result = await handler.execute(
        new GetCustomerUsageQuery("owner", customerUsageQuerySchema.parse({})),
      );
      expect(result.sellingPrice).toEqual({
        version: CUSTOMER_USAGE_PRICING.version,
        multiplier: "1.8",
        knownSubtotalUsd: "0.018",
        estimatedTotalUsd: incomplete ? null : "0.018",
      });
      expect(result.summary).toEqual(before.summary);
      expect(report).toEqual(before);
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "owner" }),
      );
    },
  );
});
