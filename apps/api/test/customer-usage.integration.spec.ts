import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  MODEL_ATTEMPT_STATUSES,
  customerUsageQuerySchema,
  USAGE_ANALYTICS_DIMENSIONS,
} from "@lcsp/contracts/billing";
import { UsageAnalyticsReader } from "../src/modules/billing/application/shared/usage-analytics.reader.js";
import { GetCustomerUsageHandler } from "../src/modules/billing/application/queries/get-customer-usage/get-customer-usage.handler.js";
import { GetAdminUsageHandler } from "../src/modules/billing/application/queries/get-admin-usage/get-admin-usage.handler.js";
import { GetCustomerUsageQuery } from "../src/modules/billing/application/queries/get-customer-usage/get-customer-usage.query.js";
import { GetAdminUsageQuery } from "../src/modules/billing/application/queries/get-admin-usage/get-admin-usage.query.js";
import type { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";

describe("Customer Usage persisted isolation and aggregation", () => {
  const run = randomUUID();
  const ownerA = `usage-a-${run}`;
  const ownerB = `usage-b-${run}`;
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const provider = `test-${run}`;
  const from = "2026-11-01T00:00:00.000Z";
  const to = "2026-11-18T23:59:59.999Z";
  const filters = customerUsageQuerySchema.parse({
    from,
    to,
    provider,
    pageSize: 1,
  });
  let prisma: PrismaClient;
  let reader: UsageAnalyticsReader;
  let customer: GetCustomerUsageHandler;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL!;
    if (!url.includes("test"))
      throw new Error("Explicit test database required");
    prisma = new PrismaClient({ adapter: new PrismaPg(url) });
    await prisma.$connect();
    reader = new UsageAnalyticsReader(prisma as unknown as PrismaService);
    customer = new GetCustomerUsageHandler(reader);
    await prisma.user.createMany({
      data: [ownerA, ownerB].map((id) => ({
        id,
        email: `${id}@test.invalid`,
        passwordHash: "test",
        emailVerified: true,
        failedLoginCount: 0,
      })),
    });
    await prisma.llmUsageEvent.createMany({
      data: ids.map((id, index) => ({
        id,
        userId: index < 2 ? ownerA : index === 2 ? ownerB : null,
        provider,
        model: "model-a",
        invocationId: id,
        runId: run,
        attemptStatus:
          index === 1
            ? MODEL_ATTEMPT_STATUSES.FAILED
            : MODEL_ATTEMPT_STATUSES.COMPLETED,
        totalTokens:
          index === 1 ? null : index === 0 ? 9007199254740993n : 999n,
        occurredAt: new Date(from),
      })),
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.llmUsageEvent.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerA, ownerB] } } });
    await prisma.$disconnect();
  });

  it("excludes other customers/system records and keeps summary independent of pagination", async () => {
    const first = await customer.execute(
      new GetCustomerUsageQuery(ownerA, filters),
    );
    const second = await customer.execute(
      new GetCustomerUsageQuery(ownerA, { ...filters, page: 2 }),
    );
    expect(first.totalCount).toBe(2);
    expect(first.items).toHaveLength(1);
    expect(first.summary).toEqual(second.summary);
    expect(first.summary.tokens.totalTokens).toEqual({
      known: "9007199254740993",
      unknownInvocations: 1,
    });
    expect(first.summary.estimatedCostUsd).toBeNull();
    expect(first.items[0].id).not.toBe(second.items[0].id);
    expect(first.breakdowns.map((row) => row.dimension)).not.toContain(
      USAGE_ANALYTICS_DIMENSIONS.WORKFLOW,
    );
    expect(first.items[0]).not.toHaveProperty("runId");
    expect(first.items[0]).not.toHaveProperty("failureClass");
  });

  it("applies filters to both receipt rows and aggregates; empty reports remain distinct", async () => {
    const failed = await customer.execute(
      new GetCustomerUsageQuery(ownerA, {
        ...filters,
        attemptStatus: MODEL_ATTEMPT_STATUSES.FAILED,
      }),
    );
    expect(failed.totalCount).toBe(1);
    expect(failed.summary.tokens.totalTokens.unknownInvocations).toBe(1);
    expect(failed.items[0].tokens.totalTokens).toBeNull();
    const empty = await customer.execute(
      new GetCustomerUsageQuery(ownerA, { ...filters, model: "missing" }),
    );
    expect(empty.totalCount).toBe(0);
    expect(empty.items).toEqual([]);
  });

  it("retains Admin visibility and never creates wallets, reservations or ledger entries", async () => {
    const before = await Promise.all([
      prisma.billingWallet.count(),
      prisma.billingReservation.count(),
      prisma.creditLedgerEntry.count(),
      prisma.llmUsageEvent.count(),
    ]);
    const admin = await new GetAdminUsageHandler(reader).execute(
      new GetAdminUsageQuery({ ...filters, pageSize: 25 }),
    );
    expect(admin.totalCount).toBe(4);
    expect(
      admin.breakdowns.some(
        (row) => row.dimension === USAGE_ANALYTICS_DIMENSIONS.WORKFLOW,
      ),
    ).toBe(true);
    const after = await Promise.all([
      prisma.billingWallet.count(),
      prisma.billingReservation.count(),
      prisma.creditLedgerEntry.count(),
      prisma.llmUsageEvent.count(),
    ]);
    expect(after).toEqual(before);
  });
});
