import { Inject, Injectable } from "@nestjs/common";
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
  appendLedger(i: {
    userId: string;
    walletId: string;
    deltaCredits: bigint;
    idempotencyKey: string;
    source: string;
    referenceId?: string;
    billingOrderId?: string;
  }) {
    return this.transactions.runForUser(i.userId, (r) => this.append(r, i));
  }
  creditOrderInTransaction(
    repos: BillingTransactionRepositories,
    input: {
      userId: string;
      walletId: string;
      orderId: string;
      creditUnits: bigint;
    },
  ) {
    return this.append(repos, {
      userId: input.userId,
      walletId: input.walletId,
      deltaCredits: input.creditUnits,
      idempotencyKey: `billing-order:${input.orderId}:credit`,
      source: "BILLING_ORDER_CREDIT",
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
  private async append(
    r: Pick<
      BillingTransactionRepositories,
      "wallet" | "ledger" | "reservation"
    >,
    i: {
      userId: string;
      walletId: string;
      deltaCredits: bigint;
      idempotencyKey: string;
      source: string;
      referenceId?: string;
      billingOrderId?: string;
    },
  ) {
    const w = await r.wallet.findForUser(i.userId);
    if (!w || w.id !== i.walletId)
      throw new OwnershipMismatchError("Wallet does not belong to user");
    const old = await r.ledger.findByIdempotencyKey(i.idempotencyKey);
    if (old) {
      if (
        old.userId !== i.userId ||
        old.walletId !== i.walletId ||
        old.deltaCredits !== i.deltaCredits ||
        old.source !== i.source ||
        old.referenceId !== (i.referenceId ?? null) ||
        old.billingOrderId !== (i.billingOrderId ?? null)
      )
        throw new BillingIdempotencyConflictError("Ledger replay differs");
      return old;
    }
    const before = await this.projection(r.ledger, r.reservation, i.walletId);
    if (before.availableBalance + i.deltaCredits < 0n)
      throw new InsufficientCreditError("Insufficient available credits");
    const e = await r.ledger.append(i);
    const after = await this.projection(r.ledger, r.reservation, i.walletId);
    if (
      !(await r.wallet.compareAndSetProjection({
        walletId: i.walletId,
        expectedVersion: w.version,
        availableCredits: after.availableBalance,
        reservedCredits: after.reservedBalance,
      }))
    )
      throw new BillingConcurrencyError("Wallet projection changed");
    return e;
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
