import { Inject, Injectable } from "@nestjs/common";
import {
  CREDIT_LEDGER_SOURCES,
  MICROCREDITS_PER_CREDIT,
  type CreditLedgerSource,
} from "@lcsp/contracts/billing";
import {
  BillingIdempotencyConflictError,
  BillingConcurrencyError,
  InsufficientCreditError,
  InvalidReservationTransitionError,
  OwnershipMismatchError,
} from "../../domain/billing.errors.js";
import { calculateBillingProjection } from "../../domain/billing-projection.js";
import type {
  BillingTransactionPort,
  BillingTransactionRepositories,
  LedgerRecord,
} from "../../domain/repositories/billing-transaction.port.js";
import { BILLING_TRANSACTION_PORT } from "../../domain/repositories/billing-transaction.port.js";

@Injectable()
export class BillingAccountingKernel {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
  ) {}
  getOrCreateWallet(userId: string) {
    return this.transactions.runForUser(userId, ({ wallet }) =>
      wallet.getOrCreateForUser(userId),
    );
  }
  /**
   * Business purpose: Append an idempotent credit or debit ledger entry for a user wallet
   *   and synchronize the wallet projection inside a serialized user transaction.
   *
   * Business rules:
   * - Wallet must belong to the target user; non-idempotent replays with differing amounts or
   *   sources fail closed with BillingIdempotencyConflictError.
   * - Available balance after the entry must remain non-negative (`>= 0n`) for legacy appends.
   * - Optional WP8 shadow microcredit fields (`deltaMicrocredits`, `ledgerSource`,
   *   `accountingUnitVersion`) are persisted when supplied without breaking legacy callers.
   *
   * Execution flow:
   * 1. Open a serialized per-user transaction via `BillingTransactionPort.runForUser`.
   * 2. Delegate wallet ownership validation, idempotency check, ledger append, and wallet
   *    CAS projection update to `append`.
   *
   * Failure cases:
   * - Throws OwnershipMismatchError if the wallet is missing or owned by another user.
   * - Throws BillingIdempotencyConflictError on conflicting idempotency replay.
   * - Throws InsufficientCreditError or BillingConcurrencyError on balance/CAS failure.
   *
   * Side effects:
   * - Persists one `CreditLedgerEntry` and updates `BillingWallet` projection atomically.
   */
  appendLedger(i: {
    userId: string;
    walletId: string;
    deltaCredits: bigint;
    deltaMicrocredits?: bigint;
    accountingUnitVersion?: number;
    idempotencyKey: string;
    source: string;
    ledgerSource?: CreditLedgerSource;
    referenceId?: string;
    billingOrderId?: string;
  }) {
    return this.transactions.runForUser(i.userId, (r) => this.append(r, i));
  }
  /**
   * Business purpose: Credit a prepaid billing order inside the caller's transaction while
   *   dual-writing WP8 shadow microcredit ledger and wallet fields (`1 credit = 1,000,000 microcredits`).
   *
   * Business rules:
   * - Canonical source and `ledgerSource` are fixed to `CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT`.
   * - `deltaMicrocredits` equals `creditUnits * MICROCREDITS_PER_CREDIT` with `accountingUnitVersion = 1`.
   * - Reuses the deterministic `billing-order:<orderId>:credit` idempotency key so duplicate
   *   settlement attempts replay safely or fail closed on amount conflict.
   *
   * Execution flow:
   * 1. Compute exact integer `deltaMicrocredits` from `input.creditUnits * MICROCREDITS_PER_CREDIT`.
   * 2. Delegate to `append` using the caller-provided transaction repositories (`repos`).
   *
   * Failure cases:
   * - Propagates OwnershipMismatchError, BillingIdempotencyConflictError, or BillingConcurrencyError
   *   from `append` to abort the enclosing transaction atomically.
   *
   * Side effects:
   * - Persists one `CreditLedgerEntry` with shadow microcredits and updates `BillingWallet`
   *   `availableCredits` and `balanceMicrocredits` inside `repos`.
   */
  creditOrderInTransaction(
    repos: BillingTransactionRepositories,
    input: {
      userId: string;
      walletId: string;
      orderId: string;
      creditUnits: bigint;
    },
  ) {
    // Why: WP8 Phase A/A2 dual-writes microcredits alongside legacy integer credits on every
    // paid order top-up so wallet balances are populated ahead of direct-credit cutover.
    // How: Convert creditUnits to microcredits using exact BigInt multiplication and stamp
    // canonical CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT + accountingUnitVersion = 1.
    // Invariants: 1 public credit === 1_000_000n microcredits; legacy credit columns stay in sync.
    return this.append(repos, {
      userId: input.userId,
      walletId: input.walletId,
      deltaCredits: input.creditUnits,
      deltaMicrocredits: input.creditUnits * MICROCREDITS_PER_CREDIT,
      accountingUnitVersion: 1,
      idempotencyKey: `billing-order:${input.orderId}:credit`,
      source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
      ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
      referenceId: input.orderId,
      billingOrderId: input.orderId,
    });
  }
  /**
   * Drains held credit from a reservation created before model use stopped
   * debiting. New reservations are never created; this only returns old holds.
   */
  releaseReservation(i: {
    userId: string;
    reservationId: string;
    assessmentId?: string;
  }) {
    return this.transactions.runForUser(
      i.userId,
      async ({ wallet, ledger, reservation }) => {
        const r = await reservation.findForUser(i.userId, i.reservationId);
        if (!r)
          throw new OwnershipMismatchError(
            "Reservation does not belong to user",
          );
        if (i.assessmentId && r.assessmentId !== i.assessmentId)
          throw new OwnershipMismatchError(
            "Reservation does not belong to the assessment",
          );
        if (r.status === "RELEASED") return { reservationId: r.id };
        if (r.status !== "RESERVED")
          throw new InvalidReservationTransitionError(
            "Reservation is already terminal",
          );
        const w = await wallet.findForUser(i.userId);
        if (!w || w.id !== r.walletId)
          throw new OwnershipMismatchError("Wallet does not belong to user");
        if (
          !(await reservation.releaseReserved({
            reservationId: r.id,
            timestamp: new Date(),
          }))
        )
          throw new InvalidReservationTransitionError(
            "Reservation transition raced",
          );
        await this.reconcile(wallet, ledger, reservation, w, w.version);
        return { reservationId: r.id };
      },
    );
  }
  rebuildProjection(userId: string) {
    return this.transactions.runForUser(
      userId,
      async ({ wallet, ledger, reservation }) => {
        const w = await wallet.findForUser(userId);
        if (!w) throw new OwnershipMismatchError("Wallet does not exist");
        return this.projection(ledger, reservation, w.id);
      },
    );
  }
  /**
   * Business purpose: Validate wallet ownership and idempotency, append a ledger entry, and
   *   atomically update the wallet projection (including shadow microcredit balance when present).
   *
   * Business rules:
   * - Reject operations targeting a wallet not owned by `i.userId`.
   * - Idempotent replays must match `userId`, `walletId`, `deltaCredits`, `source`,
   *   `referenceId`, `billingOrderId`, and supplied `deltaMicrocredits`/`ledgerSource`.
   * - Legacy `availableBalance + deltaCredits` must not drop below `0n`.
   *
   * Execution flow:
   * 1. Verify wallet ownership and check for an existing entry by `idempotencyKey`.
   * 2. Enforce available balance sufficiency, append the ledger entry, and recompute projections.
   * 3. Update wallet projection (and `balanceMicrocredits` when `deltaMicrocredits` is set) via CAS.
   *
   * Failure cases:
   * - Throws OwnershipMismatchError, BillingIdempotencyConflictError, InsufficientCreditError, or
   *   BillingConcurrencyError without leaving partial writes.
   *
   * Side effects:
   * - Inserts one `CreditLedgerEntry` and updates `BillingWallet` projection via `compareAndSetProjection`.
   */
  private async append(
    r: Pick<
      BillingTransactionRepositories,
      "wallet" | "ledger" | "reservation"
    >,
    i: {
      userId: string;
      walletId: string;
      deltaCredits: bigint;
      deltaMicrocredits?: bigint;
      accountingUnitVersion?: number;
      idempotencyKey: string;
      source: string;
      ledgerSource?: CreditLedgerSource;
      referenceId?: string;
      billingOrderId?: string;
    },
  ) {
    const w = await r.wallet.findForUser(i.userId);
    if (!w || w.id !== i.walletId)
      throw new OwnershipMismatchError("Wallet does not belong to user");
    const old = await r.ledger.findByIdempotencyKey(i.idempotencyKey);
    if (old) {
      // Why: Enforce conflict detection on both legacy credit fields and WP8 shadow microcredit
      // fields so conflicting top-up replays never silently reuse an earlier ledger entry.
      if (
        old.userId !== i.userId ||
        old.walletId !== i.walletId ||
        old.deltaCredits !== i.deltaCredits ||
        old.source !== i.source ||
        old.referenceId !== (i.referenceId ?? null) ||
        old.billingOrderId !== (i.billingOrderId ?? null) ||
        (i.deltaMicrocredits !== undefined &&
          (old.deltaMicrocredits ?? null) !== i.deltaMicrocredits) ||
        (i.ledgerSource !== undefined &&
          (old.ledgerSource ?? null) !== i.ledgerSource)
      )
        throw new BillingIdempotencyConflictError("Ledger replay differs");
      return old;
    }
    const before = await this.projection(r.ledger, r.reservation, i.walletId);
    if (before.availableBalance + i.deltaCredits < 0n)
      throw new InsufficientCreditError("Insufficient available credits");
    const e = await r.ledger.append(i);
    const after = await this.projection(r.ledger, r.reservation, i.walletId);
    const balanceMicrocredits =
      i.deltaMicrocredits !== undefined
        ? this.calculateMicrocreditBalance(
            await r.ledger.listForWallet(i.walletId),
          )
        : undefined;
    if (
      !(await r.wallet.compareAndSetProjection({
        walletId: i.walletId,
        expectedVersion: w.version,
        availableCredits: after.availableBalance,
        reservedCredits: after.reservedBalance,
        ...(balanceMicrocredits !== undefined
          ? {
              balanceMicrocredits,
              accountingUnitVersion: i.accountingUnitVersion ?? 1,
            }
          : {}),
      }))
    )
      throw new BillingConcurrencyError("Wallet projection changed");
    return e;
  }
  /**
   * Business purpose: Sum signed microcredit deltas across a wallet's ledger entries to
   *   derive the authoritative shadow `balanceMicrocredits` projection.
   *
   * Business rules:
   * - Historical entries with `deltaMicrocredits` omitted or `null` contribute `0n`.
   * - Arithmetic is exact signed BigInt addition without overflow or rounding.
   *
   * Execution flow:
   * 1. Fold all ledger entries starting from `0n` adding `entry.deltaMicrocredits ?? 0n`.
   * 2. Return the resulting signed BigInt microcredit balance.
   *
   * Failure cases:
   * - Pure reduction over array entries; no thrown domain errors.
   *
   * Side effects:
   * - Pure/read-only calculation; performs no database queries or mutations.
   */
  private calculateMicrocreditBalance(entries: LedgerRecord[]): bigint {
    let total = 0n;
    for (const entry of entries) {
      total += entry.deltaMicrocredits ?? 0n;
    }
    return total;
  }
  private async projection(
    l: BillingTransactionRepositories["ledger"],
    r: BillingTransactionRepositories["reservation"],
    walletId: string,
  ) {
    const [le, re] = await Promise.all([
      l.listForWallet(walletId),
      r.listReservedForWallet(walletId),
    ]);
    return calculateBillingProjection(
      le.map((x) => x.deltaCredits),
      re.map((x) => x.remainingCredits),
    );
  }
  private async reconcile(
    w: BillingTransactionRepositories["wallet"],
    l: BillingTransactionRepositories["ledger"],
    r: BillingTransactionRepositories["reservation"],
    account: { id: string; version: number },
    expectedVersion = account.version + 1,
  ) {
    const p = await this.projection(l, r, account.id);
    if (
      !(await w.compareAndSetProjection({
        walletId: account.id,
        expectedVersion,
        availableCredits: p.availableBalance,
        reservedCredits: p.reservedBalance,
      }))
    )
      throw new BillingConcurrencyError("Wallet projection changed");
  }
}
