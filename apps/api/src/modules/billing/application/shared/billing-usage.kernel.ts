import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  LLM_USAGE_AVAILABILITY_REASONS,
  LLM_USAGE_STATUSES,
} from "@lcsp/contracts/billing";
import type { EffectiveRuntimeModel } from "@lcsp/contracts/billing";
import {
  BillingDomainError,
  BillingIdempotencyConflictError,
  OwnershipMismatchError,
} from "../../domain/billing.errors.js";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../domain/repositories/billing-transaction.port.js";
import { BillingAccountingKernel } from "./billing-accounting.kernel.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  assertEffectiveRuntimeModelAt,
  assertMatchesEffectiveRuntimeModel,
} from "../../domain/effective-runtime-model.js";
import {
  calculateCustomerChargeVnd,
  calculateUsageChargeCredits,
} from "../../domain/usage-pricing.js";

export const BILLING_USAGE_KERNEL = Symbol("BILLING_USAGE_KERNEL");

export type BillingUsagePort = {
  resolveAssessmentOwner(assessmentId: string): Promise<string>;
  reserveForAssessment(input: {
    assessmentId: string;
    runId: string;
    amountCredits: bigint;
    maxChargeCredits: bigint;
    provider: string;
    model: string;
    maxInputTokens: bigint;
    maxOutputTokens: bigint;
    maxReasoningTokens: bigint;
    maxInvocations: bigint;
    authorizedModels: Array<{ provider: string; model: string }>;
    idempotencyKey: string;
  }): Promise<unknown>;
  releaseForAssessment(input: {
    assessmentId: string;
    reservationId: string;
  }): Promise<unknown>;
  claimInvocation(input: {
    assessmentId: string;
    reservationId: string;
    invocationId: string;
  }): Promise<unknown>;
  recordAndSettleUsage(input: {
    userId: string;
    assessmentId?: string;
    runId?: string;
    reservationId: string;
    invocationId: string;
    agentRole: string;
    provider?: string;
    model?: string;
    effectiveRuntimeModel?: EffectiveRuntimeModel;
    providerResponseId?: string;
    inputTokens?: bigint;
    cachedInputTokens?: bigint;
    cacheWriteTokens?: bigint;
    outputTokens?: bigint;
    reasoningTokens?: bigint;
    totalTokens?: bigint;
    occurredAt?: Date;
  }): Promise<unknown>;
};

@Injectable()
export class BillingUsageKernel {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly accounting: BillingAccountingKernel,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async resolveAssessmentOwner(assessmentId: string): Promise<string> {
    if (!this.prisma)
      throw new BillingDomainError(
        "Assessment ownership resolver is unavailable",
      );
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { ownerId: true },
    });
    if (!assessment)
      throw new OwnershipMismatchError("Assessment does not exist");
    return assessment.ownerId;
  }

  async reserveForAssessment(input: {
    assessmentId: string;
    runId: string;
    amountCredits: bigint;
    maxChargeCredits: bigint;
    provider: string;
    model: string;
    maxInputTokens: bigint;
    maxOutputTokens: bigint;
    maxReasoningTokens: bigint;
    maxInvocations: bigint;
    authorizedModels: Array<{ provider: string; model: string }>;
    idempotencyKey: string;
  }) {
    const provider = input.provider.trim().toUpperCase();
    const model = input.model.trim();
    const authorizedModels = input.authorizedModels.map((candidate) => ({
      provider: candidate.provider.trim().toUpperCase(),
      model: candidate.model.trim(),
    }));
    if (input.amountCredits < input.maxChargeCredits)
      throw new BillingDomainError(
        "Reservation is below the maximum invocation charge",
      );
    if (
      !authorizedModels.some(
        (candidate) =>
          candidate.provider === provider && candidate.model === model,
      )
    )
      throw new BillingDomainError(
        "Primary runtime model is outside the authorized pricing envelope",
      );
    const userId = await this.resolveAssessmentOwner(input.assessmentId);
    const worstCase = await this.transactions.runForUser(
      userId,
      async (repos) => {
        const charges = await Promise.all(
          authorizedModels.map(async (authorized) => {
            const pricing = await repos.pricing.findApplicable(
              authorized.provider,
              authorized.model,
              new Date(),
            );
            if (!pricing)
              throw new BillingDomainError(
                "Pricing snapshot is required before reserving provider spend",
              );
            return calculateCustomerChargeVnd(
              {
                inputTokens: input.maxInputTokens,
                cachedInputTokens: input.maxInputTokens,
                cacheWriteTokens: input.maxInputTokens,
                outputTokens: input.maxOutputTokens,
                reasoningTokens: input.maxReasoningTokens,
              },
              pricing,
            );
          }),
        );
        const oneInvocation = charges.reduce(
          (maximum, charge) => (charge > maximum ? charge : maximum),
          0n,
        );
        return oneInvocation * input.maxInvocations;
      },
    );
    const oneInvocationWorstCase = worstCase / input.maxInvocations;
    if (input.maxChargeCredits < oneInvocationWorstCase)
      throw new BillingDomainError(
        "Reservation is below the authoritative worst-case provider charge",
      );
    if (input.amountCredits < worstCase)
      throw new BillingDomainError(
        "Reservation is below the aggregate worst-case provider charge",
      );
    return this.accounting.reserveCredits({
      userId,
      assessmentId: input.assessmentId,
      runId: input.runId,
      amountCredits: input.amountCredits,
      idempotencyKey: input.idempotencyKey,
      maxInvocations: input.maxInvocations,
    });
  }

  async claimInvocation(input: {
    assessmentId: string;
    reservationId: string;
    invocationId: string;
  }) {
    const userId = await this.resolveAssessmentOwner(input.assessmentId);
    return this.accounting.claimInvocation({
      userId,
      reservationId: input.reservationId,
      assessmentId: input.assessmentId,
      invocationId: input.invocationId,
    });
  }

  async releaseForAssessment(input: {
    assessmentId: string;
    reservationId: string;
  }) {
    const userId = await this.resolveAssessmentOwner(input.assessmentId);
    return this.accounting.releaseReservation({
      userId,
      reservationId: input.reservationId,
      assessmentId: input.assessmentId,
    });
  }
  recordAndSettleUsage(i: {
    userId: string;
    assessmentId?: string;
    runId?: string;
    reservationId: string;
    invocationId: string;
    agentRole: string;
    provider?: string;
    model?: string;
    effectiveRuntimeModel?: EffectiveRuntimeModel;
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
      if ((i.assessmentId && !i.runId) || (!i.assessmentId && i.runId))
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
      const provider = i.provider ?? i.effectiveRuntimeModel?.provider;
      const model = i.model ?? i.effectiveRuntimeModel?.model;
      if (!i.invocationId || !provider || !model)
        throw new BillingDomainError("Usage identity is required");
      if (i.effectiveRuntimeModel)
        assertEffectiveRuntimeModelAt(i.effectiveRuntimeModel, occurredAt);
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
      const hasRequiredProviderUsage =
        i.inputTokens !== undefined && i.outputTokens !== undefined;
      const retryableExisting =
        existing?.status === LLM_USAGE_STATUSES.RETRYABLE;
      if (existing) {
        if (
          existing.provider !== provider ||
          existing.model !== model ||
          existing.agentRole !== i.agentRole ||
          (existing.inputTokens !== input && !retryableExisting) ||
          (existing.cachedInputTokens !== cachedInput && !retryableExisting) ||
          (existing.cacheWriteTokens !== cacheWrite && !retryableExisting) ||
          (existing.outputTokens !== output && !retryableExisting) ||
          (existing.reasoningTokens !== reasoning && !retryableExisting) ||
          (existing.totalTokens !== (i.totalTokens ?? null) &&
            !retryableExisting) ||
          (existing.providerResponseId !== (i.providerResponseId ?? null) &&
            !retryableExisting) ||
          existing.assessmentId !== (i.assessmentId ?? null) ||
          existing.runId !== (i.runId ?? null) ||
          existing.reservationId !== i.reservationId ||
          (i.occurredAt !== undefined &&
            existing.occurredAt.getTime() !== i.occurredAt.getTime())
        )
          throw new BillingIdempotencyConflictError("Usage replay differs");
        if (!retryableExisting || !hasRequiredProviderUsage) return existing;
      }
      if (i.providerResponseId) {
        const response = await usage.findByProviderResponse(
          provider,
          i.providerResponseId,
        );
        if (response && response.id !== existing?.id)
          throw new BillingIdempotencyConflictError(
            "Provider response already recorded",
          );
      }
      const r = await reservation.findForUser(i.userId, i.reservationId);
      if (!r)
        throw new OwnershipMismatchError("Reservation does not belong to user");
      if (
        (i.assessmentId && r.assessmentId !== i.assessmentId) ||
        (i.runId && r.runId !== i.runId)
      )
        throw new OwnershipMismatchError(
          "Reservation does not belong to the assessment run",
        );
      const createUnavailable = (availabilityReason: string) => {
        if (existing) return existing;
        return usage.create({
          userId: i.userId,
          assessmentId: i.assessmentId,
          runId: i.runId,
          agentRole: i.agentRole,
          provider,
          model,
          invocationId: i.invocationId,
          providerResponseId: i.providerResponseId,
          inputTokens: i.inputTokens,
          cachedInputTokens: i.cachedInputTokens,
          cacheWriteTokens: i.cacheWriteTokens,
          outputTokens: i.outputTokens,
          reasoningTokens: i.reasoningTokens,
          totalTokens: i.totalTokens,
          reservationId: i.reservationId,
          chargedCredits: 0n,
          providerCostCredits: 0n,
          customerChargeVnd: 0n,
          status: LLM_USAGE_STATUSES.UNAVAILABLE,
          availabilityReason,
          occurredAt,
        });
      };
      if (i.assessmentId && i.runId && !hasRequiredProviderUsage)
        return createUnavailable(
          LLM_USAGE_AVAILABILITY_REASONS.providerUsageMetadataMissing,
        );
      const selected = await repos.runtimePolicy.findApplicable(
        i.agentRole,
        occurredAt,
      );
      if (!selected) {
        if (i.assessmentId && i.runId)
          return createUnavailable(
            LLM_USAGE_AVAILABILITY_REASONS.runtimePolicySnapshotMissing,
          );
        throw new BillingDomainError(
          "No effective runtime model configuration",
        );
      }
      const effectiveRuntimeModel = i.effectiveRuntimeModel ?? {
        provider: selected.provider,
        model: selected.model,
        policyVersion: selected.policyVersion,
        effectiveAt: selected.effectiveAt.toISOString(),
      };
      if (
        provider !== effectiveRuntimeModel.provider ||
        model !== effectiveRuntimeModel.model
      )
        throw new BillingDomainError(
          "Usage provider/model differs from effective runtime policy",
        );
      assertMatchesEffectiveRuntimeModel(selected, effectiveRuntimeModel);
      const snapshot = await pricing.findApplicable(
        provider,
        model,
        occurredAt,
      );
      if (!snapshot) {
        if (i.assessmentId && i.runId)
          return createUnavailable(
            LLM_USAGE_AVAILABILITY_REASONS.pricingSnapshotMissing,
          );
        throw new BillingDomainError("No applicable pricing snapshot");
      }
      let providerCost: bigint;
      let customerChargeVnd: bigint;
      try {
        providerCost = calculateUsageChargeCredits(
          {
            inputTokens: input,
            cachedInputTokens: cachedInput,
            cacheWriteTokens: cacheWrite,
            outputTokens: output,
            reasoningTokens: reasoning,
          },
          snapshot,
        );
        customerChargeVnd = calculateCustomerChargeVnd(
          {
            inputTokens: input,
            cachedInputTokens: cachedInput,
            cacheWriteTokens: cacheWrite,
            outputTokens: output,
            reasoningTokens: reasoning,
          },
          snapshot,
        );
      } catch (error) {
        if (i.assessmentId && i.runId && error instanceof BillingDomainError)
          return createUnavailable(
            LLM_USAGE_AVAILABILITY_REASONS.pricingSnapshotInvalid,
          );
        throw error;
      }
      const event =
        existing && retryableExisting
          ? await usage.updateRetryable({
              id: existing.id,
              providerResponseId: i.providerResponseId,
              inputTokens: input,
              cachedInputTokens: cachedInput,
              cacheWriteTokens: cacheWrite,
              outputTokens: output,
              reasoningTokens: reasoning,
              totalTokens: i.totalTokens,
              pricingSnapshotId: snapshot.id,
              runtimePolicySnapshotId: selected.id,
              providerCostCredits: providerCost,
              customerChargeVnd,
            })
          : await usage.create({
              userId: i.userId,
              assessmentId: i.assessmentId,
              runId: i.runId,
              agentRole: i.agentRole,
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
      if (i.assessmentId && i.runId) {
        await this.accounting.settleUsageWithinTransaction(repos, {
          userId: i.userId,
          reservationId: i.reservationId,
          usageEventId: event.id,
          chargedCredits: customerChargeVnd,
        });
      } else {
        await this.accounting.settleWithinTransaction(repos, {
          userId: i.userId,
          reservationId: i.reservationId,
          chargedCredits: customerChargeVnd,
        });
      }
      return event;
    });
  }
}
