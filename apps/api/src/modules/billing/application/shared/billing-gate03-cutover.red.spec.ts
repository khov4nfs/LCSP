import { describe, expect, it, jest } from "@jest/globals";
import {
  BILLING_RESERVATION_STATUSES,
  CREDIT_LEDGER_SOURCES,
  MICROCREDITS_PER_CREDIT,
} from "@lcsp/contracts/billing";
import { BillingAccountingKernel } from "./billing-accounting.kernel.js";
import {
  BillingCutoverService,
  WALLET_CUTOVER_STATUSES,
} from "./billing-cutover.service.js";
import {
  BillingDomainError,
  BillingConcurrencyError,
} from "../../domain/billing.errors.js";
import type {
  BillingTransactionPort,
  BillingTransactionRepositories,
  CreditLedgerPort,
  LedgerRecord,
  LegacyReservationRecord,
} from "../../domain/repositories/billing-transaction.port.js";

type MockWalletState = {
  id: string;
  userId: string;
  availableCredits: bigint;
  reservedCredits: bigint;
  balanceMicrocredits: bigint;
  accountingUnitVersion: number;
  version: number;
};

type MockLedgerState = LedgerRecord;

type HarnessOptions = {
  onBeforeLock?: (userId: string) => Promise<void> | void;
};

function createHarness(
  initialWallets: MockWalletState[] = [],
  initialLedger: MockLedgerState[] = [],
  initialReservations: LegacyReservationRecord[] = [],
  options: HarnessOptions = {},
) {
  const wallets = new Map<string, MockWalletState>(
    initialWallets.map((w) => [w.id, { ...w }]),
  );
  const userToWallet = new Map<string, string>(
    initialWallets.map((w) => [w.userId, w.id]),
  );
  const ledger: MockLedgerState[] = initialLedger.map((l) => ({ ...l }));
  const reservations: LegacyReservationRecord[] = initialReservations.map(
    (r) => ({ ...r }),
  );
  const runForUserCalls: string[] = [];
  const lockQueues = new Map<string, Promise<void>>();

  const compareAndSetSpy = jest.fn(
    async (i: {
      walletId: string;
      expectedVersion: number;
      availableCredits: bigint;
      reservedCredits: bigint;
      balanceMicrocredits?: bigint;
      accountingUnitVersion?: number;
    }) => {
      await Promise.resolve();
      const current = wallets.get(i.walletId);
      if (!current || current.version !== i.expectedVersion) return false;
      current.availableCredits = i.availableCredits;
      current.reservedCredits = i.reservedCredits;
      if (i.balanceMicrocredits !== undefined) {
        current.balanceMicrocredits = i.balanceMicrocredits;
      }
      if (i.accountingUnitVersion !== undefined) {
        current.accountingUnitVersion = i.accountingUnitVersion;
      }
      current.version += 1;
      return true;
    },
  );
  const listReservedSpy = jest.fn(async (walletId: string) => {
    await Promise.resolve();
    return reservations
      .filter(
        (r) =>
          r.walletId === walletId &&
          r.status === BILLING_RESERVATION_STATUSES.RESERVED,
      )
      .map((r) => ({ ...r }));
  });

  const repos: BillingTransactionRepositories = {
    wallet: {
      findForUser: jest.fn(async (userId: string) => {
        await Promise.resolve();
        const walletId = userToWallet.get(userId);
        if (!walletId) return null;
        const w = wallets.get(walletId);
        return w ? { ...w } : null;
      }),
      findById: jest.fn(async (walletId: string) => {
        await Promise.resolve();
        const w = wallets.get(walletId);
        return w ? { ...w } : null;
      }),
      getOrCreateForUser: jest.fn(async (userId: string) => {
        await Promise.resolve();
        let walletId = userToWallet.get(userId);
        if (!walletId) {
          walletId = `wallet-${userId}`;
          const newWallet: MockWalletState = {
            id: walletId,
            userId,
            availableCredits: 0n,
            reservedCredits: 0n,
            balanceMicrocredits: 0n,
            accountingUnitVersion: 1,
            version: 0,
          };
          wallets.set(walletId, newWallet);
          userToWallet.set(userId, walletId);
        }
        return { ...wallets.get(walletId)! };
      }),
      compareAndSetProjection: compareAndSetSpy,
    },
    ledger: {
      findByIdempotencyKey: jest.fn(async (key: string) => {
        await Promise.resolve();
        const row = ledger.find((l) => l.idempotencyKey === key);
        return row ? { ...row } : null;
      }),
      listForWallet: jest.fn(async (walletId: string) => {
        await Promise.resolve();
        return ledger
          .filter((l) => l.walletId === walletId)
          .map((l) => ({ ...l }));
      }),
      listUnmigrated: jest.fn(
        async (batchSize: number = 100): Promise<LedgerRecord[]> => {
          await Promise.resolve();
          return ledger
            .filter(
              (l) =>
                l.deltaMicrocredits === null ||
                l.deltaMicrocredits === undefined,
            )
            .slice(0, batchSize)
            .map((l) => ({ ...l }));
        },
      ),
      backfillDeltaMicrocredits: jest.fn(
        async (
          id: string,
          deltaMicrocredits: bigint,
          accountingUnitVersion: number = 1,
        ): Promise<boolean> => {
          await Promise.resolve();
          const row = ledger.find(
            (l) =>
              l.id === id &&
              (l.deltaMicrocredits === null ||
                l.deltaMicrocredits === undefined),
          );
          if (!row) return false;
          row.deltaMicrocredits = deltaMicrocredits;
          row.accountingUnitVersion = accountingUnitVersion;
          return true;
        },
      ),
      append: jest.fn(async (i: Parameters<CreditLedgerPort["append"]>[0]) => {
        await Promise.resolve();
        const entry: MockLedgerState = {
          id: `ledger-${ledger.length + 1}`,
          userId: i.userId,
          walletId: i.walletId,
          deltaCredits: i.deltaCredits,
          deltaMicrocredits: i.deltaMicrocredits ?? null,
          accountingUnitVersion: i.accountingUnitVersion ?? 1,
          idempotencyKey: i.idempotencyKey,
          source: i.source,
          ledgerSource: i.ledgerSource ?? null,
          referenceId: i.referenceId ?? null,
          billingOrderId: i.billingOrderId ?? null,
        };
        ledger.push(entry);
        return { ...entry };
      }),
    },
    reservation: {
      findForUser: jest.fn(async (userId: string, reservationId: string) => {
        await Promise.resolve();
        const found = reservations.find(
          (r) => r.userId === userId && r.id === reservationId,
        );
        return found ? { ...found } : null;
      }),
      listReservedForWallet: listReservedSpy,
      releaseReserved: jest.fn(
        async (input: { reservationId: string; timestamp: Date }) => {
          await Promise.resolve();
          const row = reservations.find(
            (r) =>
              r.id === input.reservationId &&
              r.status === BILLING_RESERVATION_STATUSES.RESERVED,
          );
          if (!row) return false;
          row.status = BILLING_RESERVATION_STATUSES.RELEASED;
          row.remainingCredits = 0n;
          return true;
        },
      ),
    },
    order: {} as unknown as BillingTransactionRepositories["order"],
    payment: {} as unknown as BillingTransactionRepositories["payment"],
    webhook: {} as unknown as BillingTransactionRepositories["webhook"],
    usage: {} as unknown as BillingTransactionRepositories["usage"],
    runtimePolicy:
      {} as unknown as BillingTransactionRepositories["runtimePolicy"],
    audit: {
      append: jest.fn(async () => {
        await Promise.resolve();
      }),
    },
    lockUserAccount: jest.fn(async () => {
      await Promise.resolve();
    }),
  };

  const tx: BillingTransactionPort = {
    runForUser: jest.fn(
      async <T>(
        userId: string,
        fn: (r: BillingTransactionRepositories) => Promise<T>,
      ): Promise<T> => {
        if (options.onBeforeLock) {
          await options.onBeforeLock(userId);
        }
        const previous = lockQueues.get(userId) ?? Promise.resolve();
        let release!: () => void;
        const next = new Promise<void>((resolve) => {
          release = resolve;
        });
        const tail = previous.then(() => next);
        lockQueues.set(userId, tail);
        await previous;
        try {
          runForUserCalls.push(userId);
          return await fn(repos);
        } finally {
          release();
        }
      },
    ) as unknown as BillingTransactionPort["runForUser"],
  };

  const accountingKernel = new BillingAccountingKernel(tx);
  const cutoverService = new BillingCutoverService(tx, repos);

  return {
    wallets,
    ledger,
    reservations,
    runForUserCalls,
    compareAndSetSpy,
    listReservedSpy,
    repos,
    tx,
    accountingKernel,
    cutoverService,
  };
}

describe("GATE-03 Microcredit Migration & Cutover (RED Suite)", () => {
  it("AC-01: Historical ledger entries without deltaMicrocredits are backfilled to deltaCredits * 1,000,000", async () => {
    // Why: Pre-WP8 rows have deltaMicrocredits = null. They must be accurately converted to microcredits without loss.
    // Invariants: 1 credit === 1,000,000 microcredits; historical deltaCredits and accountingUnitVersion=1 preserved.
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 50n,
          reservedCredits: 0n,
          balanceMicrocredits: 0n, // Pre-migration state
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 30n,
          deltaMicrocredits: null, // Historical row
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: null,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
        {
          id: "entry-2",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 20n,
          deltaMicrocredits: null, // Historical row
          accountingUnitVersion: 1,
          idempotencyKey: "order-2:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: null,
          referenceId: "order-2",
          billingOrderId: "order-2",
        },
      ],
    );

    const report = await h.cutoverService.backfillHistoricalLedgerEntries();
    expect(report.totalBackfilled).toBe(2);

    const entries = await h.repos.ledger.listForWallet("w-1");
    expect(entries[0].deltaMicrocredits).toBe(30_000_000n);
    expect(entries[1].deltaMicrocredits).toBe(20_000_000n);
  });

  it("AC-02: Dual-write on top-up populates both credits and microcredits atomically on new entries", async () => {
    // Why: Inbound payment reconciliation must write both units atomically before cutover so shadow balance stays in parity.
    // Invariants: deltaMicrocredits = deltaCredits * 1_000_000n.
    const h = createHarness([
      {
        id: "w-1",
        userId: "u-1",
        availableCredits: 0n,
        reservedCredits: 0n,
        balanceMicrocredits: 0n,
        accountingUnitVersion: 1,
        version: 0,
      },
    ]);

    await h.accountingKernel.creditOrderInTransaction(h.repos, {
      userId: "u-1",
      walletId: "w-1",
      orderId: "order-topup-1",
      creditUnits: 100n,
    });

    const entries = await h.repos.ledger.listForWallet("w-1");
    expect(entries).toHaveLength(1);
    expect(entries[0].deltaCredits).toBe(100n);
    expect(entries[0].deltaMicrocredits).toBe(100_000_000n);
    expect(entries[0].accountingUnitVersion).toBe(1);

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.availableCredits).toBe(100n);
    expect(wallet?.balanceMicrocredits).toBe(100_000_000n);
  });

  it("AC-03: Backfill is strictly idempotent and does not double-count or alter already backfilled entries", async () => {
    // Why: In production, backfill scripts may be interrupted and re-run. Re-running must be a no-op.
    // Invariants: Running backfill N times produces the exact same ledger and wallet state as 1 run.
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 50n,
          reservedCredits: 0n,
          balanceMicrocredits: 0n,
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 50n,
          deltaMicrocredits: null,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: null,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    // First run
    const firstRun = await h.cutoverService.backfillHistoricalLedgerEntries();
    expect(firstRun.totalBackfilled).toBe(1);

    // Second run
    const secondRun = await h.cutoverService.backfillHistoricalLedgerEntries();
    expect(secondRun.totalBackfilled).toBe(0);

    const entries = await h.repos.ledger.listForWallet("w-1");
    expect(entries[0].deltaMicrocredits).toBe(50_000_000n);
  });

  it("AC-04: Per-wallet reconciliation audits exact ledger-wallet parity and flags UNMIGRATED or MATCH", async () => {
    // Why: GATE-03 requires per-wallet verification before cutover can be approved.
    // Invariants: MATCH requires sum(deltaMicrocredits) === balanceMicrocredits and 0 unmigrated rows.
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 50n,
          reservedCredits: 0n,
          balanceMicrocredits: 0n,
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 50n,
          deltaMicrocredits: null,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: null,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    // Before backfill -> UNMIGRATED
    const preCheck = await h.cutoverService.reconcileWallet("w-1");
    expect(preCheck.status).toBe(WALLET_CUTOVER_STATUSES.UNMIGRATED);
    expect(preCheck.unmigratedEntriesCount).toBe(1);

    // Backfill & sync wallet
    await h.cutoverService.backfillHistoricalLedgerEntries();
    await h.cutoverService.syncWalletMicrocreditProjection("w-1");

    // After backfill -> MATCH
    const postCheck = await h.cutoverService.reconcileWallet("w-1");
    expect(postCheck.status).toBe(WALLET_CUTOVER_STATUSES.MATCH);
    expect(postCheck.ledgerMicrocredits).toBe(50_000_000n);
    expect(postCheck.walletBalanceMicrocredits).toBe(50_000_000n);
  });

  it("AC-05: Cutover blocks if ledger-projection mismatch exists (Mismatch Alarm)", async () => {
    // Why: If a wallet has corrupted balance or out-of-band edit, cutover must fail closed.
    // Invariants: Cutover is impossible when ledger sum !== wallet balance.
    const h = createHarness(
      [
        {
          id: "w-corrupted",
          userId: "u-corrupted",
          availableCredits: 50n,
          reservedCredits: 0n,
          balanceMicrocredits: 99_000_000n, // Corrupted: mismatch with ledger
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-corrupted",
          walletId: "w-corrupted",
          deltaCredits: 50n,
          deltaMicrocredits: 50_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: null,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    const audit = await h.cutoverService.reconcileWallet("w-corrupted");
    expect(audit.status).toBe(WALLET_CUTOVER_STATUSES.MISMATCH);

    await expect(
      h.cutoverService.cutoverWallet("w-corrupted", 1),
    ).rejects.toThrow(BillingDomainError);
  });

  it("AC-06: Cutover transitions wallet to accountingUnitVersion=2 (microcredit authority)", async () => {
    // Why: GATE-03 defines cutover as establishing microcredit ledger and balance as the sole accounting authority.
    // Invariants: accountingUnitVersion transitions from 1 to 2; no competing accounting authority.
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: null,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    const result = await h.cutoverService.cutoverWallet("w-1", 1);
    expect(result.success).toBe(true);

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(2);
    expect(wallet?.balanceMicrocredits).toBe(100_000_000n);
  });

  it("AC-07: Rollback safely reverts wallet accountingUnitVersion to 1 without losing legacy credits", async () => {
    // Why: If an operational anomaly occurs post-cutover, operator can rollback accounting authority to legacy unit safely.
    // Invariants: availableCredits and historical ledger rows remain intact; accountingUnitVersion reverts to 1.
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 2, // Cutover active
          version: 2,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    const result = await h.cutoverService.rollbackWallet("w-1", 2);
    expect(result.success).toBe(true);

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(1);
    expect(wallet?.availableCredits).toBe(100n);
  });

  it("AC-08: Concurrent writer during cutover detects version conflict and rejects safely (CAS fence)", async () => {
    // Why: If a payment arrives concurrently during cutover, optimistic concurrency control must prevent race condition.
    // Invariants: Wallet version mismatch fails with BillingConcurrencyError; no lost writes.
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          version: 5, // Reality version is 5
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: null,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    // Caller attempts cutover with stale expectedVersion = 4
    await expect(h.cutoverService.cutoverWallet("w-1", 4)).rejects.toThrow(
      BillingConcurrencyError,
    );

    // Wallet remains untouched
    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(1);
    expect(wallet?.version).toBe(5);
  });

  it("R1-A: Wallet cut over to accountingUnitVersion=2 retains accountingUnitVersion=2 after top-up", async () => {
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    const cutover = await h.cutoverService.cutoverWallet("w-1", 1);
    expect(cutover.accountingUnitVersion).toBe(2);

    const topupEntry = await h.accountingKernel.creditOrderInTransaction(
      h.repos,
      {
        userId: "u-1",
        walletId: "w-1",
        orderId: "order-v2-topup",
        creditUnits: 25n,
      },
    );

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(2);
    expect(wallet?.availableCredits).toBe(125n);
    expect(wallet?.balanceMicrocredits).toBe(125n * MICROCREDITS_PER_CREDIT);
    expect(topupEntry.accountingUnitVersion).toBe(2);
  });

  it("R1-B: Wallet at accountingUnitVersion=1 retains accountingUnitVersion=1 after top-up", async () => {
    const h = createHarness([
      {
        id: "w-1",
        userId: "u-1",
        availableCredits: 0n,
        reservedCredits: 0n,
        balanceMicrocredits: 0n,
        accountingUnitVersion: 1,
        version: 0,
      },
    ]);

    const topupEntry = await h.accountingKernel.creditOrderInTransaction(
      h.repos,
      {
        userId: "u-1",
        walletId: "w-1",
        orderId: "order-v1-topup",
        creditUnits: 30n,
      },
    );

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(1);
    expect(topupEntry.accountingUnitVersion).toBe(1);
  });

  it("R2-A: Cutover rejects with BillingDomainError when wallet.reservedCredits > 0n and never zeroes reservedCredits", async () => {
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 80n,
          reservedCredits: 20n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
      [
        {
          id: "res-1",
          userId: "u-1",
          walletId: "w-1",
          remainingCredits: 20n,
          assessmentId: "assess-1",
          status: BILLING_RESERVATION_STATUSES.RESERVED,
        },
      ],
    );

    await expect(h.cutoverService.cutoverWallet("w-1", 1)).rejects.toThrow(
      BillingDomainError,
    );

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.reservedCredits).toBe(20n);
    expect(wallet?.accountingUnitVersion).toBe(1);
    expect(wallet?.version).toBe(1);
  });

  it("R2-B: Cutover rejects with BillingDomainError when a pending RESERVED row exists even if reservedCredits is 0n", async () => {
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
      [
        {
          id: "res-1",
          userId: "u-1",
          walletId: "w-1",
          remainingCredits: 15n,
          assessmentId: "assess-1",
          status: BILLING_RESERVATION_STATUSES.RESERVED,
        },
      ],
    );

    await expect(h.cutoverService.cutoverWallet("w-1", 1)).rejects.toThrow(
      BillingDomainError,
    );

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(1);
    expect(wallet?.version).toBe(1);
  });

  it("R2-C: Concurrent reservation before lock acquisition is caught inside runForUser lock boundary without calling CAS or zeroing reservedCredits", async () => {
    let raced = false;
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
      [],
      {
        onBeforeLock: () => {
          if (raced) return;
          raced = true;
          const w = h.wallets.get("w-1")!;
          w.availableCredits = 75n;
          w.reservedCredits = 25n;
          w.version = 2;
          h.reservations.push({
            id: "res-race-1",
            userId: "u-1",
            walletId: "w-1",
            remainingCredits: 25n,
            assessmentId: "assess-race",
            status: BILLING_RESERVATION_STATUSES.RESERVED,
          });
        },
      },
    );

    await expect(h.cutoverService.cutoverWallet("w-1", 1)).rejects.toThrow(
      BillingDomainError,
    );

    expect(h.runForUserCalls).toContain("u-1");
    expect(h.compareAndSetSpy).not.toHaveBeenCalled();

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.reservedCredits).toBe(25n);
    expect(wallet?.availableCredits).toBe(75n);
    expect(wallet?.accountingUnitVersion).toBe(1);
    expect(wallet?.version).toBe(2);
  });

  it("R2-D: Cutover check and CAS execute atomically inside serialized per-user runForUser lock without interleaving", async () => {
    const timeline: string[] = [];
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    let concurrentPromise: Promise<void> | undefined;
    const origListReserved = h.listReservedSpy;
    h.repos.reservation.listReservedForWallet = jest.fn(
      async (walletId: string) => {
        timeline.push("cutover:check-reservations");
        // Launch a concurrent reservation attempt while cutover holds the user lock.
        concurrentPromise = h.tx.runForUser("u-1", async () => {
          await Promise.resolve();
          timeline.push("concurrent:reservation-write");
        });
        await new Promise((r) => setTimeout(r, 15));
        return await origListReserved(walletId);
      },
    );
    const origCas = h.compareAndSetSpy;
    h.repos.wallet.compareAndSetProjection = jest.fn(
      async (
        input: Parameters<
          BillingTransactionRepositories["wallet"]["compareAndSetProjection"]
        >[0],
      ) => {
        timeline.push("cutover:cas");
        return await origCas(input);
      },
    );

    const cutoverResult = await h.cutoverService.cutoverWallet("w-1", 1);
    await concurrentPromise;

    expect(cutoverResult.accountingUnitVersion).toBe(2);
    expect(h.runForUserCalls).toEqual(["u-1", "u-1"]);
    expect(timeline).toEqual([
      "cutover:check-reservations",
      "cutover:cas",
      "concurrent:reservation-write",
    ]);
  });

  it("R3-A: Rollback rejects fractional microcredit debit without modifying wallet balances", async () => {
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 99_750_000n,
          accountingUnitVersion: 2,
          version: 3,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
        {
          id: "entry-2",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 0n,
          deltaMicrocredits: -250_000n,
          accountingUnitVersion: 2,
          idempotencyKey: "usage-1:debit",
          source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
          referenceId: "adm-1",
          billingOrderId: null,
        },
      ],
    );

    await expect(h.cutoverService.rollbackWallet("w-1", 3)).rejects.toThrow(
      BillingDomainError,
    );

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(2);
    expect(wallet?.availableCredits).toBe(100n);
    expect(wallet?.balanceMicrocredits).toBe(99_750_000n);
    expect(wallet?.version).toBe(3);
  });

  it("R3-B: Rollback rejects whole-credit microcredit-only debit (MODEL_USAGE_DEBIT divisible by 1_000_000n)", async () => {
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 99_000_000n,
          accountingUnitVersion: 2,
          version: 3,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
        {
          id: "entry-2",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 0n,
          deltaMicrocredits: -1_000_000n,
          accountingUnitVersion: 2,
          idempotencyKey: "usage-2:debit",
          source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
          referenceId: "adm-2",
          billingOrderId: null,
        },
      ],
    );

    await expect(h.cutoverService.rollbackWallet("w-1", 3)).rejects.toThrow(
      BillingDomainError,
    );

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(2);
    expect(wallet?.availableCredits).toBe(100n);
    expect(wallet?.balanceMicrocredits).toBe(99_000_000n);
  });

  it("R3-C: Rollback rejects net-zero microcredit-only pair (MODEL_USAGE_DEBIT + COMPENSATION) even when balances appear divisible", async () => {
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 2,
          version: 4,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
        {
          id: "entry-2",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 0n,
          deltaMicrocredits: -1_000_000n,
          accountingUnitVersion: 2,
          idempotencyKey: "usage-3:debit",
          source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
          referenceId: "adm-3",
          billingOrderId: null,
        },
        {
          id: "entry-3",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 0n,
          deltaMicrocredits: 1_000_000n,
          accountingUnitVersion: 2,
          idempotencyKey: "usage-3:comp",
          source: CREDIT_LEDGER_SOURCES.COMPENSATION,
          ledgerSource: CREDIT_LEDGER_SOURCES.COMPENSATION,
          referenceId: "adm-3",
          billingOrderId: null,
        },
      ],
    );

    await expect(h.cutoverService.rollbackWallet("w-1", 4)).rejects.toThrow(
      BillingDomainError,
    );

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(2);
    expect(wallet?.version).toBe(4);
  });

  it("R3-D: Rollback rejects legacy ledger vs availableCredits parity mismatch without mutating balances", async () => {
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 90n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 2,
          version: 2,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    await expect(h.cutoverService.rollbackWallet("w-1", 2)).rejects.toThrow(
      BillingDomainError,
    );

    const wallet = await h.repos.wallet.findForUser("u-1");
    expect(wallet?.accountingUnitVersion).toBe(2);
    expect(wallet?.availableCredits).toBe(90n);
    expect(wallet?.balanceMicrocredits).toBe(100_000_000n);
    expect(wallet?.version).toBe(2);
  });

  it("R3-E: Rollback rejects admissionId-linked ledger entry even when ledgerSource is null", async () => {
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 2,
          version: 3,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
        {
          id: "entry-2",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 0n,
          deltaMicrocredits: 0n,
          accountingUnitVersion: 2,
          idempotencyKey: "adm-zero-1",
          source: "USAGE_SETTLEMENT",
          ledgerSource: null,
          referenceId: "adm-1",
          billingOrderId: null,
          admissionId: "adm-1",
        },
      ],
    );

    await expect(h.cutoverService.rollbackWallet("w-1", 3)).rejects.toThrow(
      BillingDomainError,
    );
  });

  it("R3-F: Cutover followed by dual-written top-up preserves v2 and can still safely roll back to v1", async () => {
    const h = createHarness(
      [
        {
          id: "w-1",
          userId: "u-1",
          availableCredits: 100n,
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-1",
          walletId: "w-1",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    await h.cutoverService.cutoverWallet("w-1", 1);
    await h.accountingKernel.creditOrderInTransaction(h.repos, {
      userId: "u-1",
      walletId: "w-1",
      orderId: "order-2",
      creditUnits: 25n,
    });

    const v2Wallet = await h.repos.wallet.findForUser("u-1");
    expect(v2Wallet?.accountingUnitVersion).toBe(2);
    expect(v2Wallet?.version).toBe(3);

    const rollback = await h.cutoverService.rollbackWallet("w-1", 3);
    expect(rollback.accountingUnitVersion).toBe(1);

    const v1Wallet = await h.repos.wallet.findForUser("u-1");
    expect(v1Wallet?.accountingUnitVersion).toBe(1);
    expect(v1Wallet?.availableCredits).toBe(125n);
    expect(v1Wallet?.balanceMicrocredits).toBe(125_000_000n);
  });

  it("AC-14: Cutover blocks if ledger legacy credits mismatch wallet availableCredits even when microcredits match", async () => {
    // Why: If a wallet has corrupted legacy availableCredits, cutover must fail closed even if microcredits match.
    // Invariants: Cutover is impossible when sum(deltaCredits) !== wallet.availableCredits.
    const h = createHarness(
      [
        {
          id: "w-legacy-corrupted",
          userId: "u-legacy-corrupted",
          availableCredits: 999n, // Corrupted: mismatch with ledger sum (100n)
          reservedCredits: 0n,
          balanceMicrocredits: 100_000_000n, // Microcredits match ledger!
          accountingUnitVersion: 1,
          version: 1,
        },
      ],
      [
        {
          id: "entry-1",
          userId: "u-legacy-corrupted",
          walletId: "w-legacy-corrupted",
          deltaCredits: 100n,
          deltaMicrocredits: 100_000_000n,
          accountingUnitVersion: 1,
          idempotencyKey: "order-1:credit",
          source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
          ledgerSource: null,
          referenceId: "order-1",
          billingOrderId: "order-1",
        },
      ],
    );

    const audit = await h.cutoverService.reconcileWallet("w-legacy-corrupted");
    expect(audit.status).toBe(WALLET_CUTOVER_STATUSES.MISMATCH);

    await expect(
      h.cutoverService.cutoverWallet("w-legacy-corrupted", 1),
    ).rejects.toThrow(BillingDomainError);

    // Verify wallet remains untouched
    const wallet = await h.repos.wallet.findById("w-legacy-corrupted");
    expect(wallet?.accountingUnitVersion).toBe(1);
    expect(wallet?.version).toBe(1);
  });
});
