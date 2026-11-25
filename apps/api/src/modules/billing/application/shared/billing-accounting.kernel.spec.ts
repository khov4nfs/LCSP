import { describe, expect, it, jest } from "@jest/globals";
import {
  CREDIT_LEDGER_SOURCES,
  MICROCREDITS_PER_CREDIT,
} from "@lcsp/contracts/billing";

import { BillingIdempotencyConflictError } from "../../domain/billing.errors.js";
import type {
  BillingTransactionPort,
  BillingTransactionRepositories,
  LedgerRecord,
  WalletRecord,
} from "../../domain/repositories/billing-transaction.port.js";
import { BillingAccountingKernel } from "./billing-accounting.kernel.js";

function createInMemoryAccountingHarness() {
  const wallets = new Map<string, WalletRecord>();
  const ledgerEntries: LedgerRecord[] = [];
  const compareAndSetCalls: Array<Record<string, unknown>> = [];
  const appendCalls: Array<Record<string, unknown>> = [];

  const seedWallet = (userId: string, walletId = "wallet-1") => {
    const wallet: WalletRecord = {
      id: walletId,
      userId,
      availableCredits: 0n,
      reservedCredits: 0n,
      balanceMicrocredits: 0n,
      accountingUnitVersion: 1,
      version: 0,
    };
    wallets.set(userId, wallet);
    return wallet;
  };

  const repos = {
    wallet: {
      findForUser: jest.fn((userId: string) =>
        Promise.resolve(wallets.get(userId) ?? null),
      ),
      getOrCreateForUser: jest.fn((userId: string) => {
        const existing = wallets.get(userId);
        if (existing) return Promise.resolve(existing);
        return Promise.resolve(seedWallet(userId));
      }),
      compareAndSetProjection: jest.fn(
        (input: {
          walletId: string;
          expectedVersion: number;
          availableCredits: bigint;
          reservedCredits: bigint;
          balanceMicrocredits?: bigint;
          accountingUnitVersion?: number;
        }) => {
          compareAndSetCalls.push(input as unknown as Record<string, unknown>);
          const wallet = [...wallets.values()].find(
            (w) => w.id === input.walletId,
          );
          if (!wallet || wallet.version !== input.expectedVersion) {
            return Promise.resolve(false);
          }
          wallet.availableCredits = input.availableCredits;
          wallet.reservedCredits = input.reservedCredits;
          if (input.balanceMicrocredits !== undefined) {
            wallet.balanceMicrocredits = input.balanceMicrocredits;
          }
          if (input.accountingUnitVersion !== undefined) {
            wallet.accountingUnitVersion = input.accountingUnitVersion;
          }
          wallet.version += 1;
          return Promise.resolve(true);
        },
      ),
    },
    ledger: {
      findByIdempotencyKey: jest.fn((key: string) =>
        Promise.resolve(
          ledgerEntries.find((entry) => entry.idempotencyKey === key) ?? null,
        ),
      ),
      append: jest.fn(
        (input: {
          userId: string;
          walletId: string;
          deltaCredits: bigint;
          deltaMicrocredits?: bigint;
          accountingUnitVersion?: number;
          idempotencyKey: string;
          source: string;
          ledgerSource?: string;
          referenceId?: string;
          billingOrderId?: string;
        }) => {
          appendCalls.push(input as unknown as Record<string, unknown>);
          const created: LedgerRecord = {
            id: `ledger-${ledgerEntries.length + 1}`,
            userId: input.userId,
            walletId: input.walletId,
            deltaCredits: input.deltaCredits,
            deltaMicrocredits: input.deltaMicrocredits ?? null,
            accountingUnitVersion: input.accountingUnitVersion ?? 1,
            idempotencyKey: input.idempotencyKey,
            source: input.source,
            ledgerSource: (input.ledgerSource as LedgerRecord["ledgerSource"]) ?? null,
            referenceId: input.referenceId ?? null,
            billingOrderId: input.billingOrderId ?? null,
          };
          ledgerEntries.push(created);
          return Promise.resolve(created);
        },
      ),
      listForWallet: jest.fn((walletId: string) =>
        Promise.resolve(
          ledgerEntries.filter((entry) => entry.walletId === walletId),
        ),
      ),
    },
    reservation: {
      findForUser: jest.fn(() => Promise.resolve(null)),
      listReservedForWallet: jest.fn(() => Promise.resolve([])),
      releaseReserved: jest.fn(() => Promise.resolve(false)),
    },
  } as unknown as BillingTransactionRepositories;

  const txPort: BillingTransactionPort = {
    runForUser: (_userId, operation) => operation(repos),
  };

  return {
    kernel: new BillingAccountingKernel(txPort),
    repos,
    wallets,
    ledgerEntries,
    compareAndSetCalls,
    appendCalls,
    seedWallet,
  };
}

describe("BillingAccountingKernel shadow microcredit dual-write", () => {
  it("dual-writes deltaMicrocredits, accountingUnitVersion=1, source, ledgerSource, and balanceMicrocredits on creditOrderInTransaction", async () => {
    const h = createInMemoryAccountingHarness();
    const wallet = h.seedWallet("user-1", "wallet-1");

    const entry = await h.kernel.creditOrderInTransaction(h.repos, {
      userId: "user-1",
      walletId: wallet.id,
      orderId: "order-1",
      creditUnits: 25n,
    });

    expect(h.appendCalls).toHaveLength(1);
    expect(h.appendCalls[0]).toMatchObject({
      deltaCredits: 25n,
      deltaMicrocredits: 25n * MICROCREDITS_PER_CREDIT,
      accountingUnitVersion: 1,
      source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
      ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
      referenceId: "order-1",
      billingOrderId: "order-1",
    });

    expect(entry.deltaMicrocredits).toBe(25_000_000n);
    expect(entry.ledgerSource).toBe(CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT);

    expect(h.compareAndSetCalls[0]).toMatchObject({
      walletId: "wallet-1",
      availableCredits: 25n,
      reservedCredits: 0n,
      balanceMicrocredits: 25_000_000n,
      accountingUnitVersion: 1,
    });
    expect(wallet.balanceMicrocredits).toBe(25_000_000n);
  });

  it("supports idempotent replay and rejects differing deltaMicrocredits or ledgerSource", async () => {
    const h = createInMemoryAccountingHarness();
    const wallet = h.seedWallet("user-1", "wallet-1");

    const first = await h.kernel.creditOrderInTransaction(h.repos, {
      userId: "user-1",
      walletId: wallet.id,
      orderId: "order-1",
      creditUnits: 10n,
    });
    const replay = await h.kernel.creditOrderInTransaction(h.repos, {
      userId: "user-1",
      walletId: wallet.id,
      orderId: "order-1",
      creditUnits: 10n,
    });
    expect(replay).toBe(first);
    expect(h.appendCalls).toHaveLength(1);

    await expect(
      h.kernel.appendLedger({
        userId: "user-1",
        walletId: wallet.id,
        deltaCredits: 10n,
        deltaMicrocredits: 9_999_999n,
        idempotencyKey: "billing-order:order-1:credit",
        source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
        ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
        referenceId: "order-1",
        billingOrderId: "order-1",
      }),
    ).rejects.toBeInstanceOf(BillingIdempotencyConflictError);

    await expect(
      h.kernel.appendLedger({
        userId: "user-1",
        walletId: wallet.id,
        deltaCredits: 10n,
        deltaMicrocredits: 10n * MICROCREDITS_PER_CREDIT,
        idempotencyKey: "billing-order:order-1:credit",
        source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
        ledgerSource: CREDIT_LEDGER_SOURCES.GOODWILL_CREDIT,
        referenceId: "order-1",
        billingOrderId: "order-1",
      }),
    ).rejects.toBeInstanceOf(BillingIdempotencyConflictError);
  });

  it("preserves legacy TEST callers without ledgerSource/deltaMicrocredits and keeps rebuildProjection 3-key shape", async () => {
    const h = createInMemoryAccountingHarness();
    const wallet = h.seedWallet("user-1", "wallet-1");

    const entry = await h.kernel.appendLedger({
      userId: "user-1",
      walletId: wallet.id,
      deltaCredits: 500n,
      idempotencyKey: "legacy-test-key",
      source: "TEST",
    });

    expect(entry.deltaMicrocredits).toBeNull();
    expect(entry.ledgerSource).toBeNull();

    const projected = await h.kernel.rebuildProjection("user-1");
    expect(projected).toEqual({
      ledgerBalance: 500n,
      reservedBalance: 0n,
      availableBalance: 500n,
    });
    expect(Object.keys(projected).sort()).toEqual([
      "availableBalance",
      "ledgerBalance",
      "reservedBalance",
    ]);
  });
});
