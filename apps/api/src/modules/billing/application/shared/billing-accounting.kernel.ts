import { Inject, Injectable } from "@nestjs/common";
import {
  BillingDomainError,
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
  settleWithinTransaction(
    repos: BillingTransactionRepositories,
    i: { userId: string; reservationId: string; chargedCredits: bigint },
  ) {
    return (async () => {
      const r = await repos.reservation.findForUser(i.userId, i.reservationId);
      if (!r || r.status !== "RESERVED")
        throw new InvalidReservationTransitionError(
          "Reservation is not reservable",
        );
      if (i.chargedCredits < 0n || i.chargedCredits > r.amountCredits)
        throw new BillingDomainError("Invalid charge amount");
      const w = await repos.wallet.findForUser(i.userId);
      if (!w || w.id !== r.walletId)
        throw new OwnershipMismatchError("Wallet does not belong to user");
      await this.append(
        repos,
        {
          userId: i.userId,
          walletId: w.id,
          deltaCredits: -i.chargedCredits,
          idempotencyKey: `reservation:${r.id}:settle`,
          source: "RESERVATION_SETTLEMENT",
          referenceId: r.id,
        },
        true,
      );
      if (
        !(await repos.reservation.transitionFromReserved({
          reservationId: r.id,
          to: "SETTLED",
          timestamp: new Date(),
        }))
      )
        throw new InvalidReservationTransitionError(
          "Reservation transition raced",
        );
      await this.reconcile(repos.wallet, repos.ledger, repos.reservation, w);
      return r;
    })();
  }
  settleUsageWithinTransaction(
    repos: BillingTransactionRepositories,
    i: {
      userId: string;
      reservationId: string;
      usageEventId: string;
      chargedCredits: bigint;
    },
  ) {
    return (async () => {
      const debitKey = `llm-usage:${i.usageEventId}:debit`;
      const existingDebit = await repos.ledger.findByIdempotencyKey(debitKey);
      if (existingDebit) {
        const usage = await repos.usage.findById(i.usageEventId);
        if (
          existingDebit.userId !== i.userId ||
          existingDebit.deltaCredits !== -i.chargedCredits ||
          existingDebit.referenceId !== i.usageEventId ||
          usage?.reservationId !== i.reservationId
        )
          throw new BillingIdempotencyConflictError(
            "Usage debit replay differs",
          );
        return {
          reservationId: i.reservationId,
          chargedCredits: i.chargedCredits,
        };
      }
      const r = await repos.reservation.findForUser(i.userId, i.reservationId);
      if (!r || r.status !== "RESERVED")
        throw new InvalidReservationTransitionError(
          "Reservation is not reservable",
        );
      if (i.chargedCredits < 0n || i.chargedCredits > r.remainingCredits)
        throw new BillingDomainError("Invalid charge amount");
      const w = await repos.wallet.findForUser(i.userId);
      if (!w || w.id !== r.walletId)
        throw new OwnershipMismatchError("Wallet does not belong to user");
      if (
        !(await repos.reservation.consumeRemaining({
          reservationId: r.id,
          amountCredits: i.chargedCredits,
        }))
      )
        throw new BillingConcurrencyError("Reservation balance changed");
      await this.append(
        repos,
        {
          userId: i.userId,
          walletId: w.id,
          deltaCredits: -i.chargedCredits,
          idempotencyKey: debitKey,
          source: "LLM_USAGE_DEBIT",
          referenceId: i.usageEventId,
        },
        true,
      );
      await this.reconcile(repos.wallet, repos.ledger, repos.reservation, w);
      return { reservationId: r.id, chargedCredits: i.chargedCredits };
    })();
  }
  reserveCredits(i: {
    userId: string;
    amountCredits: bigint;
    idempotencyKey: string;
    assessmentId?: string;
    runId?: string;
    maxInvocations?: bigint;
  }) {
    if (i.amountCredits <= 0n)
      throw new BillingDomainError("Reservation amount must be positive");
    return this.transactions.runForUser(i.userId, async (repos) => {
      const { wallet, ledger, reservation } = repos;
      if (i.assessmentId && !i.runId)
        throw new BillingDomainError(
          "Assessment and run identifiers must be supplied together",
        );
      if (i.runId && !i.assessmentId)
        throw new BillingDomainError(
          "Assessment and run identifiers must be supplied together",
        );
      if (i.assessmentId) {
        const ownerId = await repos.assessment.findOwnerId(i.assessmentId);
        if (ownerId !== i.userId)
          throw new OwnershipMismatchError(
            "Assessment does not belong to the billing user",
          );
      }
      const old = await reservation.findByIdempotencyKey(
        i.userId,
        i.idempotencyKey,
      );
      if (old) {
        if (
          old.amountCredits !== i.amountCredits ||
          old.assessmentId !== (i.assessmentId ?? null) ||
          old.runId !== (i.runId ?? null) ||
          (i.maxInvocations !== undefined &&
            old.maxInvocations !== i.maxInvocations)
        )
          throw new BillingIdempotencyConflictError(
            "Reservation replay differs",
          );
        return old;
      }
      const w = await wallet.findForUser(i.userId);
      if (!w) throw new OwnershipMismatchError("Wallet does not exist");
      const p = await this.projection(ledger, reservation, w.id);
      if (p.availableBalance < i.amountCredits)
        throw new InsufficientCreditError("Insufficient available credits");
      const out = await reservation.createReserved({
        userId: i.userId,
        walletId: w.id,
        amountCredits: i.amountCredits,
        assessmentId: i.assessmentId,
        runId: i.runId,
        idempotencyKey: i.idempotencyKey,
        maxInvocations: i.maxInvocations,
      });
      if (
        !(await wallet.compareAndSetProjection({
          walletId: w.id,
          expectedVersion: w.version,
          availableCredits: p.availableBalance - i.amountCredits,
          reservedCredits: p.reservedBalance + i.amountCredits,
        }))
      )
        throw new BillingConcurrencyError("Wallet projection changed");
      return out;
    });
  }
  claimInvocation(i: {
    userId: string;
    reservationId: string;
    assessmentId: string;
    invocationId: string;
  }) {
    return this.transactions.runForUser(i.userId, async (repos) => {
      const reservation = await repos.reservation.findForUser(
        i.userId,
        i.reservationId,
      );
      if (!reservation || reservation.status !== "RESERVED")
        throw new InvalidReservationTransitionError(
          "Reservation is not reservable",
        );
      if (reservation.assessmentId !== i.assessmentId)
        throw new OwnershipMismatchError(
          "Reservation does not belong to the assessment",
        );
      if (!(await repos.reservation.claimInvocation(i)))
        throw new BillingConcurrencyError(
          "Reservation invocation capacity is exhausted",
        );
      return { reservationId: i.reservationId };
    });
  }
  settleReservation(i: {
    userId: string;
    reservationId: string;
    chargedCredits: bigint;
  }) {
    return this.transactions.runForUser(
      i.userId,
      async ({ wallet, ledger, reservation }) => {
        const r = await reservation.findForUser(i.userId, i.reservationId);
        if (!r)
          throw new OwnershipMismatchError(
            "Reservation does not belong to user",
          );
        if (r.status === "SETTLED") {
          const existing = await ledger.findByIdempotencyKey(
            `reservation:${r.id}:settle`,
          );
          if (!existing || existing.deltaCredits !== -i.chargedCredits)
            throw new BillingIdempotencyConflictError(
              "Reservation settlement replay differs",
            );
          return { reservationId: r.id, chargedCredits: i.chargedCredits };
        }
        if (r.status !== "RESERVED")
          throw new InvalidReservationTransitionError(
            "Reservation is already terminal",
          );
        // A grouped reservation may already have been consumed by individual
        // usage events. The legacy finalizer can only consume what remains.
        if (i.chargedCredits < 0n || i.chargedCredits > r.remainingCredits)
          throw new BillingDomainError("Invalid charge amount");
        const w = await wallet.findForUser(i.userId);
        if (!w || w.id !== r.walletId)
          throw new OwnershipMismatchError("Wallet does not belong to user");
        await this.append(
          { wallet, ledger, reservation },
          {
            userId: i.userId,
            walletId: w.id,
            deltaCredits: -i.chargedCredits,
            idempotencyKey: `reservation:${r.id}:settle`,
            source: "RESERVATION_SETTLEMENT",
            referenceId: r.id,
          },
          true,
        );
        if (
          !(await reservation.transitionFromReserved({
            reservationId: r.id,
            to: "SETTLED",
            timestamp: new Date(),
          }))
        )
          throw new InvalidReservationTransitionError(
            "Reservation transition raced",
          );
        await this.reconcile(wallet, ledger, reservation, w);
        return { reservationId: r.id, chargedCredits: i.chargedCredits };
      },
    );
  }
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
          !(await reservation.transitionFromReserved({
            reservationId: r.id,
            to: "RELEASED",
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
    allowReserved = false,
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
    if (!allowReserved && before.availableBalance + i.deltaCredits < 0n)
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
