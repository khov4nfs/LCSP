import { Inject, Injectable } from "@nestjs/common";
import type { EffectiveRuntimeModel } from "@lcsp/contracts/billing";
import {
  BillingDomainError,
  BillingIdempotencyConflictError,
  OwnershipMismatchError,
} from "../../domain/billing.errors.js";
import {
  assertEffectiveRuntimeModelAt,
  assertMatchesEffectiveRuntimeModel,
} from "../../domain/effective-runtime-model.js";
import {
  calculateCustomerChargeVnd,
  calculateUsageChargeCredits,
} from "../../domain/usage-pricing.js";
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
    agentRole: string;
    provider?: string;
    model?: string;
    effectiveRuntimeModel: EffectiveRuntimeModel;
    providerResponseId?: string;
    inputTokens?: bigint;
    cachedInputTokens?: bigint;
    cacheWriteTokens?: bigint;
    outputTokens?: bigint;
    reasoningTokens?: bigint;
    totalTokens?: bigint;
    occurredAt?: Date;
  }) {
    return this.transactions.runForUser(i.userId, async (repos) => {
      const { usage, pricing, reservation } = repos;
      const occurredAt = i.occurredAt ?? new Date();
      assertEffectiveRuntimeModelAt(i.effectiveRuntimeModel, occurredAt);
      const provider = i.effectiveRuntimeModel.provider;
      const model = i.effectiveRuntimeModel.model;
      if (!i.invocationId || !provider || !model)
        throw new BillingDomainError("Usage identity is required");
      if (
        i.effectiveRuntimeModel &&
        ((i.provider && i.provider !== i.effectiveRuntimeModel.provider) ||
          (i.model && i.model !== i.effectiveRuntimeModel.model))
      )
        throw new BillingDomainError(
          "Usage provider/model differs from effective runtime policy",
        );
      const input = i.inputTokens ?? 0n;
      const cachedInput = i.cachedInputTokens ?? 0n;
      const cacheWrite = i.cacheWriteTokens ?? 0n;
      const output = i.outputTokens ?? 0n;
      const reasoning = i.reasoningTokens ?? 0n;
      if (
        [input, cachedInput, cacheWrite, output, reasoning].some((x) => x < 0n)
      )
        throw new BillingDomainError("Token counts cannot be negative");
      if (i.totalTokens !== undefined && i.totalTokens < 0n)
        throw new BillingDomainError("Token counts cannot be negative");
      const existing = await usage.findByInvocation(i.userId, i.invocationId);
      if (existing) {
        if (
          existing.provider !== provider ||
          existing.model !== model ||
          existing.inputTokens !== input ||
          existing.cachedInputTokens !== cachedInput ||
          existing.cacheWriteTokens !== cacheWrite ||
          existing.outputTokens !== output ||
          existing.reasoningTokens !== reasoning ||
          existing.totalTokens !== (i.totalTokens ?? null) ||
          existing.providerResponseId !== (i.providerResponseId ?? null) ||
          existing.reservationId !== i.reservationId ||
          (i.occurredAt !== undefined &&
            existing.occurredAt.getTime() !== i.occurredAt.getTime())
        )
          throw new BillingIdempotencyConflictError("Usage replay differs");
        return existing;
      }
      const selected = await repos.runtimePolicy.findApplicable(
        i.agentRole,
        occurredAt,
      );
      if (!selected)
        throw new BillingDomainError(
          "No effective runtime model configuration",
        );
      assertMatchesEffectiveRuntimeModel(selected, i.effectiveRuntimeModel);
      const snapshot = await pricing.findApplicable(
        provider,
        model,
        occurredAt,
      );
      if (!snapshot)
        throw new BillingDomainError("No applicable pricing snapshot");
      const providerCost = calculateUsageChargeCredits(
        {
          inputTokens: input,
          cachedInputTokens: cachedInput,
          cacheWriteTokens: cacheWrite,
          outputTokens: output,
          reasoningTokens: reasoning,
        },
        snapshot,
      );
      const customerChargeVnd = calculateCustomerChargeVnd(
        {
          inputTokens: input,
          cachedInputTokens: cachedInput,
          cacheWriteTokens: cacheWrite,
          outputTokens: output,
          reasoningTokens: reasoning,
        },
        snapshot,
      );
      if (i.providerResponseId) {
        const response = await usage.findByProviderResponse(
          provider,
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
        provider,
        model,
        invocationId: i.invocationId,
        providerResponseId: i.providerResponseId,
        inputTokens: input,
        cachedInputTokens: cachedInput,
        cacheWriteTokens: cacheWrite,
        outputTokens: output,
        reasoningTokens: reasoning,
        // Provider totals can overlap canonical billable dimensions; they are
        // informational and must never be rebuilt from billed buckets.
        totalTokens: i.totalTokens,
        pricingSnapshotId: snapshot.id,
        runtimePolicySnapshotId: selected.id,
        providerCostCredits: providerCost,
        customerChargeVnd,
        reservationId: i.reservationId,
        chargedCredits: customerChargeVnd,
        occurredAt,
      });
      await this.accounting.settleWithinTransaction(repos, {
        userId: i.userId,
        reservationId: i.reservationId,
        chargedCredits: customerChargeVnd,
      });
      return event;
    });
  }
}
