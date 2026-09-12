import { Inject, Injectable } from "@nestjs/common";
import {
  BillingDomainError,
  BillingIdempotencyConflictError,
  OwnershipMismatchError,
} from "../../domain/billing.errors.js";
import { calculateUsageChargeCredits } from "../../domain/usage-pricing.js";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../domain/repositories/billing-transaction.port.js";
import { BillingAccountingService } from "./billing-accounting.service.js";

@Injectable()
export class BillingUsageService {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly accounting: BillingAccountingService,
  ) {}
  recordAndSettleUsage(i: {
    userId: string;
    reservationId: string;
    invocationId: string;
    provider: string;
    model: string;
    providerResponseId?: string;
    inputTokens?: bigint;
    outputTokens?: bigint;
    totalTokens?: bigint;
    occurredAt?: Date;
  }) {
    return this.transactions.runForUser(i.userId, async (repos) => {
      const { usage, pricing, reservation } = repos;
      if (!i.invocationId || !i.provider || !i.model)
        throw new BillingDomainError("Usage identity is required");
      const input = i.inputTokens ?? 0n;
      const output = i.outputTokens ?? 0n;
      if (input < 0n || output < 0n)
        throw new BillingDomainError("Token counts cannot be negative");
      if (i.totalTokens !== undefined && i.totalTokens < 0n)
        throw new BillingDomainError("Token counts cannot be negative");
      if (i.totalTokens !== undefined && i.totalTokens < input + output)
        throw new BillingDomainError("Total tokens are inconsistent");
      const existing = await usage.findByInvocation(i.userId, i.invocationId);
      if (existing) {
        if (
          existing.provider !== i.provider ||
          existing.model !== i.model ||
          existing.inputTokens !== input ||
          existing.outputTokens !== output ||
          existing.totalTokens !== (i.totalTokens ?? input + output) ||
          existing.providerResponseId !== (i.providerResponseId ?? null) ||
          existing.reservationId !== i.reservationId ||
          (i.occurredAt !== undefined &&
            existing.occurredAt.getTime() !== i.occurredAt.getTime())
        )
          throw new BillingIdempotencyConflictError("Usage replay differs");
        return existing;
      }
      const occurredAt = i.occurredAt ?? new Date();
      const snapshot = await pricing.findApplicable(
        i.provider,
        i.model,
        occurredAt,
      );
      if (!snapshot)
        throw new BillingDomainError("No applicable pricing snapshot");
      const charge = calculateUsageChargeCredits(input, output, snapshot);
      if (i.providerResponseId) {
        const response = await usage.findByProviderResponse(
          i.provider,
          i.providerResponseId,
        );
        if (response)
          throw new BillingIdempotencyConflictError(
            "Provider response already recorded",
          );
      }
      const r = await reservation.findForUser(i.userId, i.reservationId);
      if (!r)
        throw new OwnershipMismatchError("Reservation does not belong to user");
      const event = await usage.create({
        userId: i.userId,
        provider: i.provider,
        model: i.model,
        invocationId: i.invocationId,
        providerResponseId: i.providerResponseId,
        inputTokens: input,
        outputTokens: output,
        totalTokens: i.totalTokens ?? input + output,
        pricingSnapshotId: snapshot.id,
        reservationId: i.reservationId,
        chargedCredits: charge,
        occurredAt,
      });
      await this.accounting.settleWithinTransaction(repos, {
        userId: i.userId,
        reservationId: i.reservationId,
        chargedCredits: charge,
      });
      return event;
    });
  }
}
