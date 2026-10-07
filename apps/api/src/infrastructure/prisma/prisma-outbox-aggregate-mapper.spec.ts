import { describe, expect, it } from "@jest/globals";
import { OutboxAggregateType as PrismaOutboxAggregateType } from "@prisma/client";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";

import {
  fromPrismaOutboxAggregateType,
  toPrismaOutboxAggregateType,
} from "./prisma-enum-mappers.js";

describe("outbox aggregate type mapping", () => {
  it("round-trips every persisted aggregate type so no stored event becomes unpublishable", () => {
    for (const persisted of Object.values(PrismaOutboxAggregateType)) {
      const contract = fromPrismaOutboxAggregateType(persisted);
      expect(toPrismaOutboxAggregateType(contract)).toBe(persisted);
    }
  });

  it("maps the legal portfolio aggregate used by activation events", () => {
    expect(
      fromPrismaOutboxAggregateType(
        PrismaOutboxAggregateType.LEGAL_PORTFOLIO_VERSION,
      ),
    ).toBe(OUTBOX_AGGREGATE_TYPES.legalPortfolioVersion);
  });
});
