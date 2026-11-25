import { jest } from "@jest/globals";
import { CreditLedgerSource as PrismaCreditLedgerSource } from "@prisma/client";
import { CREDIT_LEDGER_SOURCES } from "@lcsp/contracts/billing";

import { PrismaBillingTransaction } from "./prisma-billing-transaction.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

describe("PrismaBillingTransaction runtime policy repository", () => {
  describe("ensure", () => {
    const input = {
      role: "root",
      provider: "LLM7",
      model: "future-model-v99",
      policyVersion: "cfg-0123456789abcdef",
      effectiveAt: new Date("1970-01-01T00:00:00.000Z"),
    };
    function ensureWith(stored: Array<Record<string, unknown>>) {
      const rows = [...stored];
      const snapshot = {
        createMany: jest.fn(
          ({ data }: { data: Array<Record<string, unknown>> }) => {
            for (const row of data)
              if (
                !rows.some(
                  (r) =>
                    r.role === row.role &&
                    r.policyVersion === row.policyVersion,
                )
              )
                rows.push({ id: `id-${rows.length}`, ...row });
            return Promise.resolve({ count: 1 });
          },
        ),
        findUnique: jest.fn(
          ({
            where,
          }: {
            where: { role_policyVersion: Record<string, string> };
          }) =>
            Promise.resolve(
              rows.find(
                (r) =>
                  r.role === where.role_policyVersion.role &&
                  r.policyVersion === where.role_policyVersion.policyVersion,
              ) ?? null,
            ),
        ),
      };
      const tx = {
        $executeRaw: jest.fn(() => Promise.resolve(1)),
        runtimeModelPolicySnapshot: snapshot,
      };
      const transaction = new PrismaBillingTransaction({
        $transaction: <T>(op: (t: typeof tx) => Promise<T>) => op(tx),
      } as unknown as PrismaService);
      return {
        rows,
        snapshot,
        ensure: (value: typeof input) =>
          transaction.runForUser("u", (r) => r.runtimePolicy.ensure(value)),
      };
    }

    it("creates a never-seen model with zero seed, then reuses it", async () => {
      const { ensure, rows } = ensureWith([]);
      const first = await ensure(input);
      const second = await ensure(input);
      expect(second.id).toBe(first.id);
      expect(rows).toHaveLength(1);
    });

    it("adds a new row for a new version/model and leaves history untouched", async () => {
      const historical = {
        id: "old",
        ...input,
        model: "model-alpha",
        policyVersion: "p1",
      };
      const { ensure, rows } = ensureWith([historical]);
      await ensure({
        ...input,
        model: "model-beta",
        policyVersion: "cfg-aaaaaaaaaaaaaaaa",
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(historical);
      await expect(
        ensure({ ...input, model: "model-alpha", policyVersion: "p1" }),
      ).resolves.toMatchObject({ id: "old" });
    });

    it("rejects the same (role, policyVersion) bound to a different model", async () => {
      const { ensure, rows } = ensureWith([{ id: "old", ...input }]);
      await expect(ensure({ ...input, model: "other" })).rejects.toThrow(
        "already bound to a different model",
      );
      await expect(ensure({ ...input, provider: "OPENAI" })).rejects.toThrow(
        "already bound",
      );
      expect(rows[0].model).toBe("future-model-v99");
    });
  });

  describe("shadow microcredit wallet & ledger persistence", () => {
    it("maps ledgerSource at the Prisma boundary and conditionally updates balanceMicrocredits", async () => {
      const createdEntries: Array<Record<string, unknown>> = [];
      const walletUpdates: Array<Record<string, unknown>> = [];

      const tx = {
        $executeRaw: jest.fn(() => Promise.resolve(1)),
        billingWallet: {
          updateMany: jest.fn((args: Record<string, unknown>) => {
            walletUpdates.push(args);
            return Promise.resolve({ count: 1 });
          }),
        },
        creditLedgerEntry: {
          create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
            const row = {
              id: `entry-${createdEntries.length + 1}`,
              referenceId: null,
              billingOrderId: null,
              deltaMicrocredits: null,
              accountingUnitVersion: 1,
              ledgerSource: null,
              ...data,
            };
            createdEntries.push(row);
            return Promise.resolve(row);
          }),
          findUnique: jest.fn(() => Promise.resolve(createdEntries[0] ?? null)),
          findMany: jest.fn(() => Promise.resolve(createdEntries)),
        },
      };

      const transaction = new PrismaBillingTransaction({
        $transaction: <T>(op: (t: typeof tx) => Promise<T>) => op(tx),
      } as unknown as PrismaService);

      const appended = await transaction.runForUser("u-1", (r) =>
        r.ledger.append({
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 5n,
          deltaMicrocredits: 5_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "k-1",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
        }),
      );

      expect(tx.creditLedgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deltaMicrocredits: 5_000_000n,
          accountingUnitVersion: 1,
          ledgerSource: PrismaCreditLedgerSource.BILLING_ORDER_CREDIT,
        }),
      });
      expect(appended.ledgerSource).toBe(
        CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
      );

      await transaction.runForUser("u-1", (r) =>
        r.wallet.compareAndSetProjection({
          walletId: "w-1",
          expectedVersion: 0,
          availableCredits: 5n,
          reservedCredits: 0n,
          balanceMicrocredits: 5_000_000n,
          accountingUnitVersion: 1,
        }),
      );

      expect(walletUpdates[0]).toMatchObject({
        where: { id: "w-1", version: 0 },
        data: {
          availableCredits: 5n,
          reservedCredits: 0n,
          balanceMicrocredits: 5_000_000n,
          accountingUnitVersion: 1,
          version: { increment: 1 },
        },
      });
    });
  });
});
