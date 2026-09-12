import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { BillingAccountingService } from "../src/modules/billing/application/services/billing-accounting.service.js";
import { BillingUsageService } from "../src/modules/billing/application/services/billing-usage.service.js";
import { calculateUsageChargeCredits } from "../src/modules/billing/domain/usage-pricing.js";
import { PrismaBillingTransaction } from "../src/modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
import type {
  BillingTransactionPort,
  BillingTransactionRepositories,
} from "../src/modules/billing/domain/repositories/billing-transaction.port.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";

describe("LCSP-310 usage and pricing foundation", () => {
  let prisma: PrismaClient;
  let accounting: BillingAccountingService;
  let usage: BillingUsageService;
  const id = () => randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "prevent_model_pricing_snapshot_mutation"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'ModelPricingSnapshot rows are append-only'; END;
      $$;
      DROP TRIGGER IF EXISTS "ModelPricingSnapshot_immutable" ON "ModelPricingSnapshot";
      CREATE TRIGGER "ModelPricingSnapshot_immutable"
      BEFORE UPDATE OR DELETE ON "ModelPricingSnapshot"
      FOR EACH ROW EXECUTE FUNCTION "prevent_model_pricing_snapshot_mutation"();
    `);
    const tx = new PrismaBillingTransaction(new PrismaService());
    accounting = new BillingAccountingService(tx);
    usage = new BillingUsageService(tx, accounting);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS "ModelPricingSnapshot_immutable" ON "ModelPricingSnapshot"',
    );
    await prisma.llmUsageEvent.deleteMany();
    await prisma.billingReservation.deleteMany();
    await prisma.creditLedgerEntry.deleteMany();
    await prisma.modelPricingSnapshot.deleteMany();
    await prisma.billingWallet.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { endsWith: "@usage.test" } },
    });
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "ModelPricingSnapshot_immutable"
      BEFORE UPDATE OR DELETE ON "ModelPricingSnapshot"
      FOR EACH ROW EXECUTE FUNCTION "prevent_model_pricing_snapshot_mutation"();
    `);
  });
  afterAll(async () => prisma?.$disconnect());

  async function fixture() {
    const user = {
      id: `usage-${id()}`,
      email: `${id()}@usage.test`,
      passwordHash: "test",
      emailVerified: true,
      failedLoginCount: 0,
    };
    await prisma.user.create({ data: user });
    const wallet = await accounting.getOrCreateWallet(user.id);
    await accounting.appendLedger({
      userId: user.id,
      walletId: wallet.id,
      deltaCredits: 100n,
      idempotencyKey: `seed-${id()}`,
      source: "TEST",
    });
    const reservation = await accounting.reserveCredits({
      userId: user.id,
      amountCredits: 20n,
      idempotencyKey: `reserve-${id()}`,
    });
    const pricing = await prisma.modelPricingSnapshot.create({
      data: {
        provider: "OPENAI",
        model: "MODEL_A",
        version: Math.floor(Math.random() * 1_000_000_000),
        inputPricePerMillion: "1.00000000",
        outputPricePerMillion: "2.00000000",
        effectiveAt: new Date(Date.now() - 1000),
      },
    });
    return { user, wallet, reservation, pricing };
  }

  it("calculates exact deterministic charges with ceil rounding", () => {
    const pricing = {
      id: "pricing-test",
      provider: "OPENAI",
      model: "MODEL_A",
      inputPricePerMillion: "1.00000000",
      outputPricePerMillion: "2.00000000",
      version: 1,
      effectiveAt: new Date(),
    };
    expect(calculateUsageChargeCredits(1_000_000n, 500_000n, pricing)).toBe(2n);
    expect(calculateUsageChargeCredits(1n, 0n, pricing)).toBe(1n);
  });

  it("records and settles usage exactly once, preserving its pricing snapshot", async () => {
    const f = await fixture();
    const input = {
      userId: f.user.id,
      reservationId: f.reservation.id,
      invocationId: "INV-1",
      provider: "OPENAI",
      model: "MODEL_A",
      inputTokens: 1_000_000n,
      outputTokens: 0n,
      totalTokens: 1_000_000n,
    };
    const first = await usage.recordAndSettleUsage(input);
    const replay = await usage.recordAndSettleUsage(input);
    expect(replay.id).toBe(first.id);
    expect(
      await prisma.llmUsageEvent.count({
        where: { userId: f.user.id, invocationId: "INV-1" },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.billingReservation.findUniqueOrThrow({
          where: { id: f.reservation.id },
        })
      ).status,
    ).toBe("SETTLED");
    expect(
      await prisma.creditLedgerEntry.count({
        where: {
          referenceId: f.reservation.id,
          source: "RESERVATION_SETTLEMENT",
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.llmUsageEvent.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).pricingSnapshotId,
    ).toBe(f.pricing.id);
  });

  it("rejects conflicting invocation replay and provider/model pricing mismatch", async () => {
    const f = await fixture();
    const base = {
      userId: f.user.id,
      reservationId: f.reservation.id,
      invocationId: "INV-2",
      provider: "OPENAI",
      model: "MODEL_A",
      inputTokens: 1n,
      outputTokens: 0n,
    };
    await usage.recordAndSettleUsage(base);
    await expect(
      usage.recordAndSettleUsage({
        ...base,
        model: "MODEL_B",
        reservationId: id(),
      }),
    ).rejects.toThrow();
    const f2 = await fixture();
    await expect(
      usage.recordAndSettleUsage({
        userId: f2.user.id,
        reservationId: f2.reservation.id,
        invocationId: "INV-3",
        provider: "ANTHROPIC",
        model: "MODEL_A",
        inputTokens: 1n,
      }),
    ).rejects.toThrow("No applicable pricing snapshot");
  });

  it("rejects replay of an invocation against a different reservation", async () => {
    const f = await fixture();
    const second = await accounting.reserveCredits({
      userId: f.user.id,
      amountCredits: 10n,
      idempotencyKey: "SECOND-RESERVATION",
    });
    const base = {
      userId: f.user.id,
      reservationId: f.reservation.id,
      invocationId: "INV-RESERVATION-LINK",
      provider: "OPENAI",
      model: "MODEL_A",
      inputTokens: 1n,
      outputTokens: 0n,
    };
    const event = await usage.recordAndSettleUsage(base);
    await expect(
      usage.recordAndSettleUsage({ ...base, reservationId: second.id }),
    ).rejects.toThrow();
    expect(
      (
        await prisma.billingReservation.findUniqueOrThrow({
          where: { id: f.reservation.id },
        })
      ).status,
    ).toBe("SETTLED");
    expect(
      (
        await prisma.billingReservation.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).status,
    ).toBe("RESERVED");
    expect(event.reservationId).toBe(f.reservation.id);
    expect(
      await prisma.llmUsageEvent.count({
        where: { invocationId: base.invocationId },
      }),
    ).toBe(1);
    expect(
      await prisma.creditLedgerEntry.count({
        where: {
          referenceId: f.reservation.id,
          source: "RESERVATION_SETTLEMENT",
        },
      }),
    ).toBe(1);
  });

  it("deduplicates non-null provider responses while allowing null response IDs", async () => {
    const f = await fixture();
    const common = {
      userId: f.user.id,
      provider: "OPENAI",
      model: "MODEL_A",
      inputTokens: 1n,
      outputTokens: 0n,
      totalTokens: 1n,
    };
    const a = await prisma.llmUsageEvent.create({
      data: {
        ...common,
        invocationId: "RESP-A",
        providerResponseId: "RESP-1",
        pricingSnapshotId: f.pricing.id,
      },
    });
    await expect(
      prisma.llmUsageEvent.create({
        data: {
          ...common,
          invocationId: "RESP-B",
          providerResponseId: "RESP-1",
          pricingSnapshotId: f.pricing.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await prisma.llmUsageEvent.create({
      data: {
        ...common,
        invocationId: "NULL-A",
        pricingSnapshotId: f.pricing.id,
      },
    });
    await prisma.llmUsageEvent.create({
      data: {
        ...common,
        invocationId: "NULL-B",
        pricingSnapshotId: f.pricing.id,
      },
    });
    expect(a.providerResponseId).toBe("RESP-1");
  });

  it("keeps historical pricing references stable when newer snapshots are added", async () => {
    const f = await fixture();
    const v2 = await prisma.modelPricingSnapshot.create({
      data: {
        provider: "OPENAI",
        model: "MODEL_A",
        version: 2,
        inputPricePerMillion: "9.00000000",
        outputPricePerMillion: "9.00000000",
        effectiveAt: new Date(),
      },
    });
    const event = await prisma.llmUsageEvent.create({
      data: {
        userId: f.user.id,
        provider: "OPENAI",
        model: "MODEL_A",
        invocationId: "HIST-1",
        inputTokens: 1n,
        pricingSnapshotId: f.pricing.id,
      },
    });
    expect(v2.id).not.toBe(f.pricing.id);
    expect(
      (
        await prisma.llmUsageEvent.findUniqueOrThrow({
          where: { id: event.id },
        })
      ).pricingSnapshotId,
    ).toBe(f.pricing.id);
  });

  it("anchors invocation replay to its persisted pricing snapshot", async () => {
    const f = await fixture();
    const t3 = new Date();
    const first = await usage.recordAndSettleUsage({
      userId: f.user.id,
      reservationId: f.reservation.id,
      invocationId: "INV-HISTORICAL-REPLAY",
      provider: "OPENAI",
      model: "MODEL_A",
      inputTokens: 1_000_000n,
      occurredAt: t3,
    });
    const p2 = await prisma.modelPricingSnapshot.create({
      data: {
        provider: "OPENAI",
        model: "MODEL_A",
        version: Math.floor(Math.random() * 1_000_000_000),
        inputPricePerMillion: "9.00000000",
        outputPricePerMillion: "9.00000000",
        effectiveAt: new Date(t3.getTime() - 100),
      },
    });
    const replay = await usage.recordAndSettleUsage({
      userId: f.user.id,
      reservationId: f.reservation.id,
      invocationId: "INV-HISTORICAL-REPLAY",
      provider: "OPENAI",
      model: "MODEL_A",
      inputTokens: 1_000_000n,
      occurredAt: t3,
    });
    expect(replay.id).toBe(first.id);
    expect(replay.pricingSnapshotId).toBe(f.pricing.id);
    expect(replay.chargedCredits).toBe(1n);
    expect(p2.id).not.toBe(f.pricing.id);
    const second = await accounting.reserveCredits({
      userId: f.user.id,
      amountCredits: 10n,
      idempotencyKey: "HIST-SECOND-RESERVATION",
    });
    const fresh = await usage.recordAndSettleUsage({
      userId: f.user.id,
      reservationId: second.id,
      invocationId: "INV-HISTORICAL-NEW",
      provider: "OPENAI",
      model: "MODEL_A",
      inputTokens: 1_000_000n,
      occurredAt: t3,
    });
    expect(fresh.pricingSnapshotId).toBe(p2.id);
    expect(
      await prisma.llmUsageEvent.count({
        where: { invocationId: "INV-HISTORICAL-REPLAY" },
      }),
    ).toBe(1);
  });

  it("rejects direct pricing snapshot mutation while allowing new versions", async () => {
    const f = await fixture();
    const event = await usage.recordAndSettleUsage({
      userId: f.user.id,
      reservationId: f.reservation.id,
      invocationId: "INV-IMMUTABLE",
      provider: "OPENAI",
      model: "MODEL_A",
      inputTokens: 1n,
    });
    const p2 = await prisma.modelPricingSnapshot.create({
      data: {
        provider: "OPENAI",
        model: "MODEL_A",
        version: Math.floor(Math.random() * 1_000_000_000),
        inputPricePerMillion: "3.00000000",
        outputPricePerMillion: "4.00000000",
        effectiveAt: new Date(),
      },
    });
    await expect(
      prisma.modelPricingSnapshot.update({
        where: { id: f.pricing.id },
        data: { inputPricePerMillion: "9.00000000" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.modelPricingSnapshot.update({
        where: { id: p2.id },
        data: { inputPricePerMillion: "8.00000000" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.modelPricingSnapshot.delete({ where: { id: p2.id } }),
    ).rejects.toThrow();
    const p1 = await prisma.modelPricingSnapshot.findUniqueOrThrow({
      where: { id: f.pricing.id },
    });
    const persisted = await prisma.llmUsageEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(p1.inputPricePerMillion.toString()).toBe("1");
    expect(persisted.pricingSnapshotId).toBe(f.pricing.id);
    expect(persisted.chargedCredits).toBe(1n);
    await expect(
      prisma.modelPricingSnapshot.findUnique({ where: { id: p2.id } }),
    ).resolves.toBeTruthy();
  });

  it("rejects a calculated charge larger than the prepaid reservation", async () => {
    const f = await fixture();
    await expect(
      usage.recordAndSettleUsage({
        userId: f.user.id,
        reservationId: f.reservation.id,
        invocationId: "OVER-1",
        provider: "OPENAI",
        model: "MODEL_A",
        inputTokens: 21_000_000n,
        outputTokens: 0n,
      }),
    ).rejects.toThrow("Invalid charge amount");
    expect(
      await prisma.llmUsageEvent.count({ where: { userId: f.user.id } }),
    ).toBe(0);
    expect(
      (
        await prisma.billingReservation.findUniqueOrThrow({
          where: { id: f.reservation.id },
        })
      ).status,
    ).toBe("RESERVED");
    expect(
      await prisma.creditLedgerEntry.count({
        where: { walletId: f.wallet.id },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.billingWallet.findUniqueOrThrow({
          where: { id: f.wallet.id },
        })
      ).availableCredits,
    ).toBe(80n);
  });

  it("settles one concurrent invocation exactly once", async () => {
    const f = await fixture();
    const input = {
      userId: f.user.id,
      reservationId: f.reservation.id,
      invocationId: "INV-CONCURRENT",
      provider: "OPENAI",
      model: "MODEL_A",
      inputTokens: 1_000_000n,
      outputTokens: 0n,
    };
    const results = await Promise.allSettled([
      usage.recordAndSettleUsage(input),
      usage.recordAndSettleUsage(input),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    expect(
      await prisma.llmUsageEvent.count({
        where: { userId: f.user.id, invocationId: input.invocationId },
      }),
    ).toBe(1);
    expect(
      await prisma.creditLedgerEntry.count({
        where: {
          referenceId: f.reservation.id,
          source: "RESERVATION_SETTLEMENT",
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.billingReservation.findUniqueOrThrow({
          where: { id: f.reservation.id },
        })
      ).status,
    ).toBe("SETTLED");
  });

  it("deduplicates concurrent provider responses across distinct invocations", async () => {
    const f = await fixture();
    const secondReservation = await accounting.reserveCredits({
      userId: f.user.id,
      amountCredits: 20n,
      idempotencyKey: `reserve-${id()}`,
    });
    const base = {
      userId: f.user.id,
      provider: "OPENAI",
      model: "MODEL_A",
      providerResponseId: "RESP-CONCURRENT",
      inputTokens: 1_000_000n,
      outputTokens: 0n,
    };
    await Promise.allSettled([
      usage.recordAndSettleUsage({
        ...base,
        reservationId: f.reservation.id,
        invocationId: "INV-A",
      }),
      usage.recordAndSettleUsage({
        ...base,
        reservationId: secondReservation.id,
        invocationId: "INV-B",
      }),
    ]);
    expect(
      await prisma.llmUsageEvent.count({
        where: { userId: f.user.id, providerResponseId: "RESP-CONCURRENT" },
      }),
    ).toBe(1);
    expect(
      await prisma.creditLedgerEntry.count({
        where: { source: "RESERVATION_SETTLEMENT" },
      }),
    ).toBe(1);
  });

  it("rolls back usage, reservation, ledger and wallet on injected transaction failure", async () => {
    const f = await fixture();
    class FaultTransaction implements BillingTransactionPort {
      constructor(private readonly real: BillingTransactionPort) {}
      runForUser<T>(
        userId: string,
        operation: (repositories: BillingTransactionRepositories) => Promise<T>,
      ): Promise<T> {
        return this.real.runForUser(userId, (repos) =>
          operation({
            ...repos,
            wallet: {
              ...repos.wallet,
              compareAndSetProjection: () => {
                throw new Error("TEST_INJECTED_USAGE_FAILURE");
              },
            },
          }),
        );
      }
    }
    const real = new PrismaBillingTransaction(new PrismaService());
    const faultUsage = new BillingUsageService(
      new FaultTransaction(real),
      new BillingAccountingService(real),
    );
    await expect(
      faultUsage.recordAndSettleUsage({
        userId: f.user.id,
        reservationId: f.reservation.id,
        invocationId: "INV-ROLLBACK",
        provider: "OPENAI",
        model: "MODEL_A",
        inputTokens: 1_000_000n,
        outputTokens: 0n,
      }),
    ).rejects.toThrow("TEST_INJECTED_USAGE_FAILURE");
    expect(
      await prisma.llmUsageEvent.count({
        where: { userId: f.user.id, invocationId: "INV-ROLLBACK" },
      }),
    ).toBe(0);
    expect(
      await prisma.creditLedgerEntry.count({
        where: {
          referenceId: f.reservation.id,
          source: "RESERVATION_SETTLEMENT",
        },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.billingReservation.findUniqueOrThrow({
          where: { id: f.reservation.id },
        })
      ).status,
    ).toBe("RESERVED");
    const w = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: f.wallet.id },
    });
    expect(w.availableCredits).toBe(80n);
    expect(w.reservedCredits).toBe(20n);
  });

  it("rejects usage settlement against another user's reservation", async () => {
    const a = await fixture();
    const bUser = {
      id: `usage-${id()}`,
      email: `${id()}@usage.test`,
      passwordHash: "test",
      emailVerified: true,
      failedLoginCount: 0,
    };
    await prisma.user.create({ data: bUser });
    const bWallet = await accounting.getOrCreateWallet(bUser.id);
    await accounting.appendLedger({
      userId: bUser.id,
      walletId: bWallet.id,
      deltaCredits: 100n,
      idempotencyKey: `seed-${id()}`,
      source: "TEST",
    });
    const bReservation = await accounting.reserveCredits({
      userId: bUser.id,
      amountCredits: 20n,
      idempotencyKey: `reserve-${id()}`,
    });
    await expect(
      usage.recordAndSettleUsage({
        userId: a.user.id,
        reservationId: bReservation.id,
        invocationId: "CROSS-1",
        provider: "OPENAI",
        model: "MODEL_A",
        inputTokens: 1n,
      }),
    ).rejects.toThrow();
    expect(
      await prisma.llmUsageEvent.count({ where: { invocationId: "CROSS-1" } }),
    ).toBe(0);
    expect(
      (
        await prisma.billingReservation.findUniqueOrThrow({
          where: { id: bReservation.id },
        })
      ).status,
    ).toBe("RESERVED");
  });
});
