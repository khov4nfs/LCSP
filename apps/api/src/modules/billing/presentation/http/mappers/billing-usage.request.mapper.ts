import type {
  BillingUsageClaimRequest,
  BillingUsageReleaseRequest,
  BillingUsageReservationRequest,
  BillingUsageSettlementRequest,
} from "@lcsp/contracts/billing";
import type {
  BillingUsageClaimInput,
  BillingUsageReleaseInput,
  BillingUsageReservationInput,
  BillingUsageSettlementInput,
} from "../../../application/commands/billing-usage.types.js";

export function toReservationInput(
  body: BillingUsageReservationRequest,
): BillingUsageReservationInput {
  return {
    assessmentId: body.assessmentId,
    runId: body.runId,
    amountCredits: BigInt(body.amountCredits),
    maxChargeCredits: BigInt(body.maxChargeCredits),
    provider: body.provider,
    model: body.model,
    maxInputTokens: BigInt(body.maxInputTokens),
    maxOutputTokens: BigInt(body.maxOutputTokens),
    maxReasoningTokens: BigInt(body.maxReasoningTokens),
    maxInvocations: BigInt(body.maxInvocations),
    authorizedModels: body.authorizedModels.map(({ provider, model }) => ({
      provider: provider.toUpperCase(),
      model,
    })),
    idempotencyKey: body.idempotencyKey,
  };
}

export function toReleaseInput(
  reservationId: string,
  body: BillingUsageReleaseRequest,
): BillingUsageReleaseInput {
  return { assessmentId: body.assessmentId, reservationId };
}

export function toClaimInput(
  reservationId: string,
  body: BillingUsageClaimRequest,
): BillingUsageClaimInput {
  return {
    assessmentId: body.assessmentId,
    reservationId,
    invocationId: body.invocationId,
  };
}

export function toSettlementInput(
  body: BillingUsageSettlementRequest,
  userId: string,
): BillingUsageSettlementInput {
  const runtime = body.effectiveRuntimeModel;
  return {
    userId,
    assessmentId: body.assessmentId,
    runId: body.runId,
    reservationId: body.reservationId,
    invocationId: body.invocationId,
    agentRole: body.agentRole,
    provider: body.provider ?? runtime?.provider,
    model: body.model ?? runtime?.model,
    effectiveRuntimeModel: runtime,
    providerResponseId: body.providerResponseId,
    inputTokens: toBigInt(body.inputTokens),
    cachedInputTokens: toBigInt(body.cachedInputTokens),
    cacheWriteTokens: toBigInt(body.cacheWriteTokens),
    outputTokens: toBigInt(body.outputTokens),
    reasoningTokens: toBigInt(body.reasoningTokens),
    totalTokens: toBigInt(body.totalTokens),
    occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
  };
}

function toBigInt(value: string | undefined): bigint | undefined {
  return value === undefined ? undefined : BigInt(value);
}
