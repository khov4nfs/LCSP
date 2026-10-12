import type { BillingLlmUsageReportRequest } from "@lcsp/contracts/billing";
import type { LlmUsageRecordInput } from "../../../application/commands/billing-usage.types.js";

export function toLlmUsageRecordInput(
  body: BillingLlmUsageReportRequest,
  userId: string,
): LlmUsageRecordInput {
  return {
    userId,
    assessmentId: body.assessmentId,
    runId: body.runId,
    invocationId: body.invocationId,
    agentRole: body.agentRole,
    provider: body.provider.trim().toUpperCase(),
    model: body.model.trim(),
    effectiveRuntimeModel: body.effectiveRuntimeModel,
    providerResponseId: body.providerResponseId,
    inputTokens: toBigInt(body.inputTokens),
    cachedInputTokens: toBigInt(body.cachedInputTokens),
    cacheWriteTokens: toBigInt(body.cacheWriteTokens),
    outputTokens: toBigInt(body.outputTokens),
    reasoningTokens: toBigInt(body.reasoningTokens),
    totalTokens: toBigInt(body.totalTokens),
    occurredAt: new Date(body.occurredAt),
  };
}

function toBigInt(value: string | undefined): bigint | undefined {
  return value === undefined ? undefined : BigInt(value);
}
