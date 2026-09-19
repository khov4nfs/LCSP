import { BillingDomainError } from "../../../domain/billing.errors.js";
import type {
  BillingUsageClaimInput,
  BillingUsageReleaseInput,
  BillingUsageReservationInput,
  BillingUsageSettlementInput,
} from "../../../application/commands/billing-usage.types.js";
import {
  parseInteger,
  parseNonNegativeInteger,
  text,
} from "../parsers/billing-usage.request-parser.js";

export function toReservationInput(
  body: Record<string, unknown>,
): BillingUsageReservationInput {
  const assessmentId = text(body.assessmentId);
  const runId = text(body.runId);
  const idempotencyKey = text(body.idempotencyKey);
  const provider = text(body.provider);
  const model = text(body.model);
  const amount = text(body.amountCredits);
  const maxChargeCredits = text(body.maxChargeCredits);
  const maxInputTokens = text(body.maxInputTokens);
  const maxOutputTokens = text(body.maxOutputTokens);
  const maxReasoningTokens = text(body.maxReasoningTokens);
  const maxInvocations = text(body.maxInvocations);
  const authorizedModels = body.authorizedModels;
  if (
    !assessmentId ||
    !runId ||
    !idempotencyKey ||
    !amount ||
    !maxChargeCredits ||
    !provider ||
    !model ||
    !maxInputTokens ||
    !maxOutputTokens ||
    !maxReasoningTokens ||
    !maxInvocations ||
    !Array.isArray(authorizedModels) ||
    authorizedModels.length === 0
  )
    throw new BillingDomainError("Reservation input is required");
  const modelEnvelope = authorizedModels.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new BillingDomainError("authorizedModels is invalid");
    const entry = value as Record<string, unknown>;
    const entryProvider = text(entry.provider).toUpperCase();
    const entryModel = text(entry.model);
    if (!entryProvider || !entryModel)
      throw new BillingDomainError("authorizedModels is invalid");
    return { provider: entryProvider, model: entryModel };
  });
  const amountValue = parseInteger(amount, "amountCredits");
  const maxChargeValue = parseInteger(maxChargeCredits, "maxChargeCredits");
  if (amountValue < maxChargeValue)
    throw new BillingDomainError(
      "Reservation is below the maximum invocation charge",
    );
  return {
    assessmentId,
    runId,
    amountCredits: amountValue,
    maxChargeCredits: maxChargeValue,
    provider,
    model,
    maxInputTokens: parseNonNegativeInteger(maxInputTokens, "maxInputTokens"),
    maxOutputTokens: parseNonNegativeInteger(
      maxOutputTokens,
      "maxOutputTokens",
    ),
    maxReasoningTokens: parseNonNegativeInteger(
      maxReasoningTokens,
      "maxReasoningTokens",
    ),
    maxInvocations: parseNonNegativeInteger(maxInvocations, "maxInvocations"),
    authorizedModels: modelEnvelope,
    idempotencyKey,
  };
}

export function toReleaseInput(
  reservationId: string,
  body: Record<string, unknown>,
): BillingUsageReleaseInput {
  const assessmentId = text(body.assessmentId);
  if (!assessmentId || !reservationId.trim())
    throw new BillingDomainError("Release input is required");
  return { assessmentId, reservationId: reservationId.trim() };
}

export function toClaimInput(
  reservationId: string,
  body: Record<string, unknown>,
): BillingUsageClaimInput {
  const assessmentId = text(body.assessmentId);
  const invocationId = text(body.invocationId);
  if (!assessmentId || !reservationId.trim() || !invocationId)
    throw new BillingDomainError("Claim input is required");
  return { assessmentId, reservationId: reservationId.trim(), invocationId };
}

export function toSettlementInput(
  body: Record<string, unknown>,
  userId: string,
): BillingUsageSettlementInput {
  const runtimeValue = body.effectiveRuntimeModel;
  const runtime =
    runtimeValue &&
    typeof runtimeValue === "object" &&
    !Array.isArray(runtimeValue)
      ? (runtimeValue as Record<string, unknown>)
      : undefined;
  const provider =
    text(body.provider) ||
    (runtime && typeof runtime.provider === "string"
      ? runtime.provider.trim()
      : "");
  const model =
    text(body.model) ||
    (runtime && typeof runtime.model === "string" ? runtime.model.trim() : "");
  if (
    typeof body.assessmentId !== "string" ||
    !body.assessmentId.trim() ||
    typeof body.runId !== "string" ||
    !body.runId.trim() ||
    typeof body.agentRole !== "string" ||
    !body.agentRole.trim() ||
    !provider ||
    !model
  )
    throw new BillingDomainError("usage identity is required");
  if (runtimeValue !== undefined && !runtime)
    throw new BillingDomainError("effective runtime model is invalid");
  if (
    runtime &&
    ((typeof runtime.provider === "string" &&
      runtime.provider.trim() !== provider) ||
      (typeof runtime.model === "string" && runtime.model.trim() !== model))
  )
    throw new BillingDomainError(
      "Usage provider/model differs from effective runtime policy",
    );
  return {
    userId,
    assessmentId: body.assessmentId.trim(),
    runId: body.runId.trim(),
    reservationId: text(body.reservationId),
    invocationId: text(body.invocationId),
    agentRole: body.agentRole.trim(),
    provider,
    model,
    effectiveRuntimeModel:
      runtime &&
      typeof runtime.policyVersion === "string" &&
      typeof runtime.effectiveAt === "string" &&
      !Number.isNaN(new Date(runtime.effectiveAt).getTime())
        ? {
            provider,
            model,
            policyVersion: runtime.policyVersion,
            effectiveAt: runtime.effectiveAt,
          }
        : undefined,
    providerResponseId: body.providerResponseId
      ? text(body.providerResponseId)
      : undefined,
    inputTokens: optionalBigInt(body, "inputTokens"),
    cachedInputTokens: optionalBigInt(body, "cachedInputTokens"),
    cacheWriteTokens: optionalBigInt(body, "cacheWriteTokens"),
    outputTokens: optionalBigInt(body, "outputTokens"),
    reasoningTokens: optionalBigInt(body, "reasoningTokens"),
    totalTokens: optionalBigInt(body, "totalTokens"),
    occurredAt: body.occurredAt ? new Date(text(body.occurredAt)) : undefined,
  };
}

function optionalBigInt(
  body: Record<string, unknown>,
  name: string,
): bigint | undefined {
  const value = body[name];
  return value === undefined ? undefined : parseInteger(text(value), name);
}
