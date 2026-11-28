import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  CREDIT_LEDGER_SOURCES,
  MICROCREDITS_PER_CREDIT,
} from "@lcsp/contracts/billing";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
  type BillingTransactionRepositories,
  type LedgerRecord,
  type WalletRecord,
} from "../../domain/repositories/billing-transaction.port.js";
import {
  BillingDomainError,
  BillingConcurrencyError,
} from "../../domain/billing.errors.js";
import { fromPrismaCreditLedgerSource } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { PrismaBillingTransaction } from "../../infrastructure/persistence/prisma-billing-transaction.js";

export const WALLET_CUTOVER_STATUSES = {
  MATCH: "MATCH",
  MISMATCH: "MISMATCH",
  UNMIGRATED: "UNMIGRATED",
} as const;

export type WalletCutoverStatus =
  (typeof WALLET_CUTOVER_STATUSES)[keyof typeof WALLET_CUTOVER_STATUSES];

export interface WalletReconciliationReport {
  walletId: string;
  userId: string;
  status: WalletCutoverStatus;
  accountingUnitVersion: number;
  unmigratedEntriesCount: number;
  ledgerMicrocredits: bigint;
  walletBalanceMicrocredits: bigint;
  legacyAvailableCredits: bigint;
  ledgerLegacyCredits: bigint;
  parityDifferenceMicrocredits: bigint;
  legacyDifferenceCredits: bigint;
}

export interface BackfillReport {
  processed: number;
  totalBackfilled: number;
}

/**
 * Service orchestrating GATE-03 microcredit migration, per-wallet reconciliation audit,
 * and accounting authority cutover / rollback according to ADR-028 standards.
 */
@Injectable()
export class BillingCutoverService {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    @Optional()
    private readonly repos?: BillingTransactionRepositories,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {}

  /**
   * Business purpose: Backfill historical `CreditLedgerEntry` rows where `deltaMicrocredits` is null
   *   by computing `deltaCredits * MICROCREDITS_PER_CREDIT` without altering legacy credit values.
   *
   * Business rules:
   * - Only rows with `deltaMicrocredits === null` are touched.
   * - Preserves `deltaCredits`, `accountingUnitVersion`, and idempotency keys untouched.
   * - Backfill execution is strictly idempotent; re-running on an already-migrated dataset produces 0 updates.
   *
   * Execution flow:
   * 1. Query batches of ledger entries where `deltaMicrocredits IS NULL`.
   * 2. For each entry, compute `deltaMicrocredits = entry.deltaCredits * MICROCREDITS_PER_CREDIT`.
   * 3. Update entry with the calculated microcredits using an atomic null-check guard.
   * 4. Return total count of processed and backfilled entries.
   *
   * Failure cases:
   * - Database connection errors propagate without marking partial progress as complete.
   *
   * Side effects:
   * - Populates `deltaMicrocredits` column on unmigrated historical `CreditLedgerEntry` rows.
   */
  async backfillHistoricalLedgerEntries(
    batchSize = 100,
  ): Promise<BackfillReport> {
    // Why: Pre-WP8 entries were created before shadow microcredits existed. They must be backfilled
    // using exact integer multiplication (1 credit = 1,000,000 microcredits) before cutover.
    // How: Update entries where deltaMicrocredits is null in batches with atomic where-null guards.
    // Invariants: Already backfilled rows are never modified; deltaCredits is preserved.
    let processed = 0;
    let totalBackfilled = 0;

    if (
      this.repos?.ledger?.listUnmigrated &&
      this.repos?.ledger?.backfillDeltaMicrocredits
    ) {
      const unmigrated = await this.repos.ledger.listUnmigrated(batchSize);
      processed = unmigrated.length;
      for (const entry of unmigrated) {
        const deltaMicrocredits = entry.deltaCredits * MICROCREDITS_PER_CREDIT;
        const updated = await this.repos.ledger.backfillDeltaMicrocredits(
          entry.id,
          deltaMicrocredits,
          1,
        );
        if (updated) {
          totalBackfilled += 1;
        }
      }
      return { processed, totalBackfilled };
    }

    if (this.prisma) {
      const rows = await this.prisma.creditLedgerEntry.findMany({
        where: { deltaMicrocredits: null },
        take: batchSize,
        orderBy: { createdAt: "asc" },
      });
      processed = rows.length;
      for (const row of rows) {
        const deltaMicrocredits = row.deltaCredits * MICROCREDITS_PER_CREDIT;
        const result = await this.prisma.creditLedgerEntry.updateMany({
          where: { id: row.id, deltaMicrocredits: null },
          data: { deltaMicrocredits, accountingUnitVersion: 1 },
        });
        if (result.count === 1) {
          totalBackfilled += 1;
        }
      }
      return { processed, totalBackfilled };
    }

    return { processed, totalBackfilled };
  }

  /**
   * Business purpose: Synchronize a wallet's `balanceMicrocredits` projection from its ledger entries
   *   prior to cutover using an optimistic concurrency control (CAS) guard.
   *
   * Business rules:
   * - Reads all ledger records for the wallet and derives total microcredits.
   * - CAS update ensures no concurrent writes are lost during synchronization.
   *
   * Execution flow:
   * 1. Retrieve current wallet record and its complete ledger history.
   * 2. Sum `deltaMicrocredits` (or derived from `deltaCredits * MICROCREDITS_PER_CREDIT`).
   * 3. Update `BillingWallet.balanceMicrocredits` via `compareAndSetProjection`.
   *
   * Failure cases:
   * - Throws `BillingDomainError` if wallet does not exist.
   * - Throws `BillingConcurrencyError` if wallet version changed concurrently.
   *
   * Side effects:
   * - Updates `BillingWallet.balanceMicrocredits` in database and increments version.
   */
  async syncWalletMicrocreditProjection(
    walletId: string,
  ): Promise<{ walletId: string; balanceMicrocredits: bigint }> {
    // Why: Ensure wallet balanceMicrocredits projection matches the exact sum of microcredits in ledger.
    // How: Calculate authoritative sum and update via compareAndSetProjection.
    // Invariants: CAS ensures atomic projection synchronization.
    const wallet = await this.findWalletById(walletId);
    if (!wallet) {
      throw new BillingDomainError("Wallet does not exist");
    }

    const entries = await this.listEntriesForWallet(walletId);
    let totalMicrocredits = 0n;
    for (const entry of entries) {
      totalMicrocredits +=
        entry.deltaMicrocredits ?? entry.deltaCredits * MICROCREDITS_PER_CREDIT;
    }

    const updated = await this.updateWalletProjection({
      walletId,
      expectedVersion: wallet.version,
      availableCredits: wallet.availableCredits,
      reservedCredits: wallet.reservedCredits,
      balanceMicrocredits: totalMicrocredits,
      accountingUnitVersion: wallet.accountingUnitVersion ?? 1,
    });

    if (!updated) {
      throw new BillingConcurrencyError(
        "Wallet projection changed during sync",
      );
    }

    return { walletId, balanceMicrocredits: totalMicrocredits };
  }

  /**
   * Business purpose: Perform a comprehensive, per-wallet reconciliation audit comparing ledger
   *   microcredit totals against the wallet's projected balance and checking for unmigrated entries.
   *
   * Business rules:
   * - Status is `UNMIGRATED` if any ledger entry has `deltaMicrocredits === null`.
   * - Status is `MATCH` if all entries have microcredits and `sum(deltaMicrocredits) === wallet.balanceMicrocredits`.
   * - Status is `MISMATCH` if there is any numerical discrepancy between ledger sum and wallet balance.
   *
   * Execution flow:
   * 1. Fetch wallet record and all corresponding ledger entries.
   * 2. Delegate status and parity calculation to `evaluateReconciliation`.
   * 3. Return the resulting `WalletReconciliationReport`.
   *
   * Failure cases:
   * - Throws `BillingDomainError` if wallet does not exist.
   *
   * Side effects:
   * - Read-only audit; performs zero mutations.
   */
  async reconcileWallet(walletId: string): Promise<WalletReconciliationReport> {
    // Why: GATE-03 requires per-wallet verification that ledger sum matches wallet projection before cutover.
    // How: Load wallet and ledger entries and delegate parity classification to evaluateReconciliation.
    // Invariants: Cutover is strictly prohibited unless status is MATCH.
    const wallet = await this.findWalletById(walletId);
    if (!wallet) {
      throw new BillingDomainError("Wallet does not exist");
    }

    const entries = await this.listEntriesForWallet(walletId);
    return this.evaluateReconciliation(wallet, entries);
  }

  /**
   * Business purpose: Execute the official cutover transition for a verified wallet from legacy
   *   accounting unit (`accountingUnitVersion = 1`) to microcredit authority (`accountingUnitVersion = 2`)
   *   while fencing against active reservations and concurrent writes.
   *
   * Business rules:
   * - Must execute wallet read, pending reservation check, reconciliation audit, and CAS update
   *   inside the same per-user transaction and advisory lock boundary (`runInWalletTransaction`).
   * - Rejects cutover if `wallet.reservedCredits !== 0n` or any `RESERVED` reservation row exists;
   *   never zeros `reservedCredits` to bypass an active hold.
   * - Must pass per-wallet reconciliation with status `MATCH` before cutover can proceed.
   * - Uses optimistic concurrency control (`expectedVersion`) to fence against stale callers.
   *
   * Execution flow:
   * 1. Look up the target wallet to resolve its owning `userId` for per-user locking.
   * 2. Enter `runInWalletTransaction(initialWallet.userId, ...)` to acquire the serialized user lock.
   * 3. Re-read wallet, pending `RESERVED` reservations, and ledger entries inside the lock.
   * 4. Reject with `BillingDomainError` if any reserved credits or pending reservations exist, or if
   *    reconciliation status is not `MATCH`.
   * 5. Atomically CAS `accountingUnitVersion` to `2` while preserving `wallet.reservedCredits`.
   *
   * Failure cases:
   * - Throws `BillingDomainError` if wallet is missing, has held/reserved credits, or fails `MATCH` parity.
   * - Throws `BillingConcurrencyError` if wallet version does not match `expectedVersion`.
   *
   * Side effects:
   * - Sets `BillingWallet.accountingUnitVersion = 2` and increments version inside the locked transaction.
   */
  async cutoverWallet(
    walletId: string,
    expectedVersion: number,
  ): Promise<{
    success: boolean;
    walletId: string;
    accountingUnitVersion: number;
  }> {
    // Why: Checking reservations or reconciliation outside a user lock lets a concurrent reservation
    // slip in before cutover CAS, and hardcoding reservedCredits=0n silently destroys held balances.
    // How: Resolve userId, then re-read wallet + pending RESERVED rows + ledger inside runInWalletTransaction
    // before running evaluateReconciliation and compareAndSetProjection.
    // Invariants: reservedCredits is never zeroed during cutover; no concurrent reservation can interleave.
    const initialWallet = await this.findWalletById(walletId);
    if (!initialWallet) {
      throw new BillingDomainError("Wallet does not exist");
    }

    return this.runInWalletTransaction(
      initialWallet.userId,
      async (txRepos) => {
        const wallet = await txRepos.wallet.findById(walletId);
        if (!wallet || wallet.userId !== initialWallet.userId) {
          throw new BillingDomainError("Wallet does not exist");
        }

        const pendingReservations =
          await txRepos.reservation.listReservedForWallet(walletId);
        if (wallet.reservedCredits !== 0n || pendingReservations.length > 0) {
          throw new BillingDomainError(
            "Cannot cutover wallet while reserved credits or pending reservations exist; release reservations first.",
          );
        }

        const entries = await txRepos.ledger.listForWallet(walletId);
        let ledgerLegacyCredits = 0n;
        for (const entry of entries) {
          ledgerLegacyCredits += entry.deltaCredits;
        }
        if (ledgerLegacyCredits !== wallet.availableCredits) {
          throw new BillingDomainError(
            `Cannot cutover wallet: legacy availableCredits (${wallet.availableCredits}) does not match ledger sum (${ledgerLegacyCredits}).`,
          );
        }

        const audit = this.evaluateReconciliation(wallet, entries);
        if (audit.status !== WALLET_CUTOVER_STATUSES.MATCH) {
          throw new BillingDomainError(
            `Cannot cutover wallet with integrity status '${audit.status}'. Expected MATCH.`,
          );
        }

        const updated = await txRepos.wallet.compareAndSetProjection({
          walletId,
          expectedVersion,
          availableCredits: wallet.availableCredits,
          reservedCredits: wallet.reservedCredits,
          balanceMicrocredits: audit.walletBalanceMicrocredits,
          accountingUnitVersion: 2,
        });

        if (!updated) {
          throw new BillingConcurrencyError(
            "Wallet projection changed during cutover",
          );
        }

        return { success: true, walletId, accountingUnitVersion: 2 };
      },
    );
  }

  /**
   * Business purpose: Safely rollback a cutover wallet back to legacy accounting authority
   *   (`accountingUnitVersion = 1`) only when exact legacy-credit and microcredit parity holds
   *   and no microcredit-only activity has occurred.
   *
   * Business rules:
   * - Executes inside the per-user transaction and advisory lock boundary (`runInWalletTransaction`).
   * - Rejects rollback if `wallet.reservedCredits !== 0n` or any pending `RESERVED` reservation exists.
   * - Rejects rollback if `balanceMicrocredits < 0n` or `balanceMicrocredits % 1_000_000n !== 0n`.
   * - Rejects rollback if any ledger entry is unmigrated (`deltaMicrocredits == null`), represents
   *   microcredit-only activity (`MODEL_USAGE_DEBIT`, `COMPENSATION`, `GOODWILL_CREDIT`,
   *   `admissionId != null`, or `originalLedgerEntryId != null`), or has non-integer / mismatched
   *   `deltaMicrocredits !== deltaCredits * 1_000_000n`.
   * - Rejects rollback unless `availableCredits === sum(deltaCredits)`,
   *   `sum(deltaMicrocredits) === balanceMicrocredits`, and
   *   `availableCredits * 1_000_000n === balanceMicrocredits`.
   * - Never mutates wallet balances or ledger rows to synthesize parity.
   *
   * Execution flow:
   * 1. Look up the target wallet to resolve its owning `userId` for per-user locking.
   * 2. Inside `runInWalletTransaction`, re-read wallet, ledger entries, and pending reservations.
   * 3. Validate absence of reservations, whole-credit non-negative microcredit balance, and absence
   *    of unmigrated or microcredit-only ledger entries while summing both legacy and microcredit deltas.
   * 4. Verify exact three-way parity between `availableCredits`, `sum(deltaCredits)`, and `balanceMicrocredits`.
   * 5. Atomically CAS `accountingUnitVersion` to `1` preserving existing balance columns intact.
   *
   * Failure cases:
   * - Throws `BillingDomainError` if wallet is missing, has reservations, fractional/negative
   *   microcredits, any microcredit-only ledger entry, unmigrated entries, or legacy/microcredit drift.
   * - Throws `BillingConcurrencyError` if wallet version changed concurrently.
   *
   * Side effects:
   * - Resets `BillingWallet.accountingUnitVersion = 1` and increments version without altering balances.
   */
  async rollbackWallet(
    walletId: string,
    expectedVersion: number,
  ): Promise<{
    success: boolean;
    walletId: string;
    accountingUnitVersion: number;
  }> {
    // Why: Reversing accountingUnitVersion to 1 when fractional debits, microcredit-only transactions,
    // or legacy-vs-microcredit drift exist would silently restore stale legacy availableCredits.
    // How: Inside runInWalletTransaction, verify zero reservations, exact divisibility, zero microcredit-only
    // entries (including net-zero debit+compensation pairs), and exact 3-way parity before CAS to v1.
    // Invariants: Never mutates balances to fake parity; historical ledger and balances remain untouched.
    const initialWallet = await this.findWalletById(walletId);
    if (!initialWallet) {
      throw new BillingDomainError("Wallet does not exist");
    }

    return this.runInWalletTransaction(
      initialWallet.userId,
      async (txRepos) => {
        const wallet = await txRepos.wallet.findById(walletId);
        if (!wallet || wallet.userId !== initialWallet.userId) {
          throw new BillingDomainError("Wallet does not exist");
        }

        const [entries, pendingReservations] = await Promise.all([
          txRepos.ledger.listForWallet(walletId),
          txRepos.reservation.listReservedForWallet(walletId),
        ]);

        if (wallet.reservedCredits !== 0n || pendingReservations.length > 0) {
          throw new BillingDomainError(
            "Cannot rollback wallet while reserved credits or pending reservations exist.",
          );
        }

        const walletBalanceMicrocredits = wallet.balanceMicrocredits ?? 0n;
        if (
          walletBalanceMicrocredits < 0n ||
          walletBalanceMicrocredits % MICROCREDITS_PER_CREDIT !== 0n
        ) {
          throw new BillingDomainError(
            "Cannot rollback wallet: balanceMicrocredits is negative or not an exact multiple of 1,000,000 microcredits.",
          );
        }

        const microcreditOnlySources = new Set<string>([
          CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
          CREDIT_LEDGER_SOURCES.COMPENSATION,
          CREDIT_LEDGER_SOURCES.GOODWILL_CREDIT,
        ]);
        let legacyLedgerCredits = 0n;
        let ledgerMicrocredits = 0n;

        for (const entry of entries) {
          if (
            entry.deltaMicrocredits === null ||
            entry.deltaMicrocredits === undefined
          ) {
            throw new BillingDomainError(
              `Cannot rollback wallet: ledger entry '${entry.id}' is unmigrated (deltaMicrocredits is null).`,
            );
          }

          if (
            (entry.ledgerSource != null &&
              microcreditOnlySources.has(entry.ledgerSource)) ||
            microcreditOnlySources.has(entry.source) ||
            entry.admissionId != null ||
            entry.originalLedgerEntryId != null
          ) {
            throw new BillingDomainError(
              `Cannot rollback wallet: microcredit-only transaction '${entry.id}' (${entry.ledgerSource ?? entry.source}) prevents safe reversion to legacy accounting.`,
            );
          }

          if (
            entry.deltaMicrocredits % MICROCREDITS_PER_CREDIT !== 0n ||
            entry.deltaMicrocredits !==
              entry.deltaCredits * MICROCREDITS_PER_CREDIT
          ) {
            throw new BillingDomainError(
              `Cannot rollback wallet: ledger entry '${entry.id}' has microcredit/legacy delta mismatch.`,
            );
          }

          legacyLedgerCredits += entry.deltaCredits;
          ledgerMicrocredits += entry.deltaMicrocredits;
        }

        if (wallet.availableCredits !== legacyLedgerCredits) {
          throw new BillingDomainError(
            "Cannot rollback wallet: availableCredits does not match legacy CreditLedgerEntry sum.",
          );
        }

        if (ledgerMicrocredits !== walletBalanceMicrocredits) {
          throw new BillingDomainError(
            "Cannot rollback wallet: ledger microcredits do not match wallet balanceMicrocredits.",
          );
        }

        if (
          wallet.availableCredits * MICROCREDITS_PER_CREDIT !==
          walletBalanceMicrocredits
        ) {
          throw new BillingDomainError(
            "Cannot rollback wallet: availableCredits * 1,000,000 does not match wallet balanceMicrocredits.",
          );
        }

        const updated = await txRepos.wallet.compareAndSetProjection({
          walletId,
          expectedVersion,
          availableCredits: wallet.availableCredits,
          reservedCredits: wallet.reservedCredits,
          balanceMicrocredits: walletBalanceMicrocredits,
          accountingUnitVersion: 1,
        });

        if (!updated) {
          throw new BillingConcurrencyError(
            "Wallet projection changed during rollback",
          );
        }

        return { success: true, walletId, accountingUnitVersion: 1 };
      },
    );
  }

  /**
   * Business purpose: Compute a wallet's reconciliation status and parity metrics from an
   *   already-loaded wallet snapshot and its ordered ledger entries.
   *
   * Business rules:
   * - Status is `UNMIGRATED` if any entry has `deltaMicrocredits == null`.
   * - Status is `MATCH` only if all entries are migrated, `sum(deltaMicrocredits) === wallet.balanceMicrocredits`,
   *   `sum(deltaCredits) === wallet.availableCredits`, and `wallet.availableCredits * 1_000_000n === wallet.balanceMicrocredits`.
   * - Status is `MISMATCH` if any microcredit, legacy credit, or cross-unit discrepancy exists.
   *
   * Execution flow:
   * 1. Fold all ledger entries counting unmigrated rows and summing both legacy credits and microcredit deltas.
   * 2. Compute `parityDifferenceMicrocredits` against `wallet.balanceMicrocredits ?? 0n`
   *    and `legacyDifferenceCredits` against `wallet.availableCredits`.
   * 3. Classify status and return `WalletReconciliationReport`.
   *
   * Failure cases:
   * - Pure calculation; throws no domain errors.
   *
   * Side effects:
   * - Pure/read-only calculation; performs no database queries or mutations.
   */
  private evaluateReconciliation(
    wallet: WalletRecord,
    entries: LedgerRecord[],
  ): WalletReconciliationReport {
    // Why: Single-source reconciliation computation shared by both read-only reconcileWallet()
    // and locked cutoverWallet() so parity rules cannot diverge. Reconciles BOTH legacy and microcredit sources.
    // How: Pure reduction over wallet + entries comparing ledger sums against wallet projections.
    // Invariants: UNMIGRATED takes precedence over MISMATCH/MATCH whenever any deltaMicrocredits is null.
    // Status is MATCH only if both legacy availableCredits and balanceMicrocredits match their respective ledger sums.
    let unmigratedEntriesCount = 0;
    let ledgerMicrocredits = 0n;
    let ledgerLegacyCredits = 0n;

    for (const entry of entries) {
      ledgerLegacyCredits += entry.deltaCredits;
      if (
        entry.deltaMicrocredits === null ||
        entry.deltaMicrocredits === undefined
      ) {
        unmigratedEntriesCount += 1;
        ledgerMicrocredits += entry.deltaCredits * MICROCREDITS_PER_CREDIT;
      } else {
        ledgerMicrocredits += entry.deltaMicrocredits;
      }
    }

    const walletBalanceMicrocredits = wallet.balanceMicrocredits ?? 0n;
    const parityDifferenceMicrocredits =
      ledgerMicrocredits - walletBalanceMicrocredits;
    const legacyDifferenceCredits =
      ledgerLegacyCredits - wallet.availableCredits;
    const crossUnitParityMatch =
      wallet.availableCredits * MICROCREDITS_PER_CREDIT ===
      walletBalanceMicrocredits;

    let status: WalletCutoverStatus;
    if (unmigratedEntriesCount > 0) {
      status = WALLET_CUTOVER_STATUSES.UNMIGRATED;
    } else if (
      parityDifferenceMicrocredits === 0n &&
      legacyDifferenceCredits === 0n &&
      crossUnitParityMatch
    ) {
      status = WALLET_CUTOVER_STATUSES.MATCH;
    } else {
      status = WALLET_CUTOVER_STATUSES.MISMATCH;
    }

    return {
      walletId: wallet.id,
      userId: wallet.userId,
      status,
      accountingUnitVersion: wallet.accountingUnitVersion ?? 1,
      unmigratedEntriesCount,
      ledgerMicrocredits,
      walletBalanceMicrocredits,
      legacyAvailableCredits: wallet.availableCredits,
      ledgerLegacyCredits,
      parityDifferenceMicrocredits,
      legacyDifferenceCredits,
    };
  }

  /**
   * Business purpose: Execute a wallet cutover or rollback operation inside a serialized
   *   per-user database transaction and advisory lock (`pg_advisory_xact_lock`).
   *
   * Business rules:
   * - Delegates to `this.transactions.runForUser(userId, ...)` so NestJS DI and test harnesses
   *   enforce the canonical per-user lock boundary.
   * - If `txRepos` omits `wallet`/`ledger`/`reservation` (for example in standalone CLI tooling
   *   wired with a no-op transaction port) and `this.prisma` is available, opens an explicit
   *   `this.prisma.$transaction` with `pg_advisory_xact_lock(hashtext(userId))`.
   *
   * Execution flow:
   * 1. Invoke `this.transactions.runForUser(userId, ...)`.
   * 2. Use `txRepos` directly when `wallet`, `ledger`, and `reservation` ports are present.
   * 3. Otherwise fall back to `PrismaBillingTransaction.runForUser(userId, operation)` over `this.prisma`.
   *
   * Failure cases:
   * - Throws `BillingDomainError` if neither transaction repositories nor `PrismaService` are available.
   *
   * Side effects:
   * - Acquires a per-user advisory transaction lock for the duration of `operation`.
   */
  private async runInWalletTransaction<T>(
    userId: string,
    operation: (
      repos: Pick<
        BillingTransactionRepositories,
        "wallet" | "ledger" | "reservation"
      >,
    ) => Promise<T>,
  ): Promise<T> {
    // Why: Cutover and rollback must serialize with concurrent billing mutations (reservations,
    // top-ups, settlements) using the same per-user pg_advisory_xact_lock(hashtext(userId)) boundary.
    // How: Prefer BillingTransactionPort.runForUser when full repositories are provided; fall back to
    // PrismaBillingTransaction.runForUser when invoked with a minimal transaction stub + PrismaService.
    // Invariants: Never runs cutover/rollback validation and CAS outside a user-locked transaction.
    return this.transactions.runForUser(userId, async (txRepos) => {
      if (txRepos?.wallet && txRepos?.ledger && txRepos?.reservation) {
        return operation(txRepos);
      }

      if (!this.prisma) {
        throw new BillingDomainError(
          "Transaction repositories or PrismaService are required for locked cutover operations.",
        );
      }

      return new PrismaBillingTransaction(this.prisma).runForUser(
        userId,
        operation,
      );
    });
  }

  /**
   * Business purpose:
   * Retrieves a wallet record by its unique identifier using either the transaction repository port
   * or the direct Prisma service for standalone migration tasks.
   *
   * Business rules:
   * - Read-only lookup; never creates or mutates wallet state.
   * - Returns complete wallet record including current accountingUnitVersion, balanceMicrocredits, and version.
   *
   * Execution flow:
   * 1. Check if repository port is available and query wallet via port.
   * 2. If repository port is unavailable, fall back to direct Prisma client query.
   * 3. Return mapped wallet record or null if not found.
   *
   * Failure cases:
   * - Returns null if wallet does not exist or neither repository nor Prisma client is configured.
   *
   * Side effects:
   * - Pure database read; no persistent mutations or side effects.
   */
  private async findWalletById(walletId: string): Promise<WalletRecord | null> {
    if (this.repos?.wallet?.findById) {
      return this.repos.wallet.findById(walletId);
    }
    if (this.prisma) {
      const row = await this.prisma.billingWallet.findUnique({
        where: { id: walletId },
      });
      return row ? { ...row } : null;
    }
    return null;
  }

  /**
   * Business purpose:
   * Queries the complete ledger history for a specified wallet in ascending chronological order
   * to enable authoritative reconciliation and audit calculations.
   *
   * Business rules:
   * - Read-only query; strictly preserves chronological order of ledger entries.
   * - Exposes both legacy deltaCredits and post-cutover deltaMicrocredits for exact parity analysis.
   *
   * Execution flow:
   * 1. Check if repository port is available and query ledger via port.
   * 2. If repository port is unavailable, query Prisma creditLedgerEntry ordered by createdAt ASC.
   * 3. Map returned database records to domain LedgerRecord structures.
   *
   * Failure cases:
   * - Returns empty array if no entries exist or neither repository nor Prisma client is configured.
   *
   * Side effects:
   * - Pure database read; no persistent mutations or side effects.
   */
  private async listEntriesForWallet(
    walletId: string,
  ): Promise<LedgerRecord[]> {
    if (this.repos?.ledger?.listForWallet) {
      return this.repos.ledger.listForWallet(walletId);
    }
    if (this.prisma) {
      const rows = await this.prisma.creditLedgerEntry.findMany({
        where: { walletId },
        orderBy: { createdAt: "asc" },
      });
      // Why: Translate Prisma CreditLedgerSource enum and microcredit linkage IDs faithfully so
      // CLI/Prisma-backed audits and rollback parity guards never miss microcredit-only entries.
      // How: Map ledgerSource via fromPrismaCreditLedgerSource when non-null and forward admissionId/originalLedgerEntryId.
      // Invariants: Prisma enum values never leak past this persistence boundary.
      return rows.map((r) => ({
        id: r.id,
        walletId: r.walletId,
        userId: r.userId,
        deltaCredits: r.deltaCredits,
        deltaMicrocredits: r.deltaMicrocredits,
        accountingUnitVersion: r.accountingUnitVersion,
        idempotencyKey: r.idempotencyKey,
        source: r.source,
        ledgerSource: r.ledgerSource
          ? fromPrismaCreditLedgerSource(r.ledgerSource)
          : null,
        referenceId: r.referenceId,
        billingOrderId: r.billingOrderId,
        admissionId: r.admissionId ?? null,
        originalLedgerEntryId: r.originalLedgerEntryId ?? null,
      }));
    }
    return [];
  }

  /**
   * Business purpose:
   * Performs an atomic compare-and-set update on wallet balances and cutover version
   * to guarantee race-free cutover and rollback transitions.
   *
   * Business rules:
   * - Optimistic locking: update succeeds only if the existing row version matches expectedVersion.
   * - Automatically increments wallet version by 1 upon successful mutation.
   * - Never mutates unversioned or conflicting wallet states.
   *
   * Execution flow:
   * 1. Check if repository port is available and invoke compareAndSetProjection.
   * 2. If repository port is unavailable, execute Prisma updateMany filtered by id and expectedVersion.
   * 3. Return true if exactly one row was updated, false if version conflict occurred.
   *
   * Failure cases:
   * - Returns false if wallet version changed concurrently or row does not exist.
   *
   * Side effects:
   * - Persists updated availableCredits, reservedCredits, balanceMicrocredits, and accountingUnitVersion;
   *   increments version by 1.
   */
  private async updateWalletProjection(input: {
    walletId: string;
    expectedVersion: number;
    availableCredits: bigint;
    reservedCredits: bigint;
    balanceMicrocredits?: bigint;
    accountingUnitVersion?: number;
  }): Promise<boolean> {
    if (this.repos?.wallet?.compareAndSetProjection) {
      return this.repos.wallet.compareAndSetProjection(input);
    }
    if (this.prisma) {
      const result = await this.prisma.billingWallet.updateMany({
        where: { id: input.walletId, version: input.expectedVersion },
        data: {
          availableCredits: input.availableCredits,
          reservedCredits: input.reservedCredits,
          ...(input.balanceMicrocredits !== undefined
            ? { balanceMicrocredits: input.balanceMicrocredits }
            : {}),
          ...(input.accountingUnitVersion !== undefined
            ? { accountingUnitVersion: input.accountingUnitVersion }
            : {}),
          version: { increment: 1 },
        },
      });
      return result.count === 1;
    }
    return false;
  }
}
