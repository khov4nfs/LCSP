import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  LLM_USAGE_AVAILABILITY_REASONS,
  LLM_USAGE_STATUSES,
} from "@lcsp/contracts/billing";
import {
  BillingDomainError,
  BillingIdempotencyConflictError,
  OwnershipMismatchError,
} from "../../domain/billing.errors.js";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../domain/repositories/billing-transaction.port.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  assertEffectiveRuntimeModelAt,
  assertMatchesEffectiveRuntimeModel,
} from "../../domain/effective-runtime-model.js";
import type { LlmUsageRecordInput } from "../commands/billing-usage.types.js";

export const BILLING_USAGE_KERNEL = Symbol("BILLING_USAGE_KERNEL");

export type BillingUsagePort = {
  resolveAssessmentOwner(assessmentId: string): Promise<string>;
  recordUsage(input: LlmUsageRecordInput): Promise<unknown>;
};

const TOKEN_FIELDS = [
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
] as const;

/**
 * Provider-reported token usage is telemetry only. Recording a model invocation
 * never reads a price, reserves or debits credits, or depends on the wallet:
 * assessment execution is independent of balance.
 */
@Injectable()
export class BillingUsageKernel {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
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

  /** Idempotent on (userId, invocationId); stores only what the provider reported. */
  recordUsage(i: LlmUsageRecordInput) {
    return this.transactions.runForUser(i.userId, async (repos) => {
      const { usage } = repos;
      if (!i.invocationId || !i.provider || !i.model)
        throw new BillingDomainError("Usage identity is required");
      if (i.effectiveRuntimeModel)
        assertEffectiveRuntimeModelAt(i.effectiveRuntimeModel, i.occurredAt);
      if (TOKEN_FIELDS.some((field) => (i[field] ?? 0n) < 0n))
        throw new BillingDomainError("Token counts cannot be negative");

      const existing = await usage.findByInvocation(i.userId, i.invocationId);
      if (existing) {
        if (
          existing.provider !== i.provider ||
          existing.model !== i.model ||
          existing.agentRole !== i.agentRole ||
          existing.assessmentId !== i.assessmentId ||
          existing.runId !== i.runId ||
          TOKEN_FIELDS.some(
            (field) => existing[field] !== (i[field] ?? null),
          ) ||
          existing.providerResponseId !== (i.providerResponseId ?? null) ||
          existing.occurredAt.getTime() !== i.occurredAt.getTime()
        )
          throw new BillingIdempotencyConflictError("Usage replay differs");
        return existing;
      }
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
      // The authenticated internal worker callback reports the content-addressed
      // cfg-<hash> policy; its immutable snapshot is derived on first sight.
      let runtimePolicySnapshotId: string | undefined;
      if (i.effectiveRuntimeModel) {
        const selected = await repos.runtimePolicy.ensure({
          role: i.agentRole,
          provider: i.effectiveRuntimeModel.provider,
          model: i.effectiveRuntimeModel.model,
          policyVersion: i.effectiveRuntimeModel.policyVersion,
          effectiveAt: new Date(i.effectiveRuntimeModel.effectiveAt),
        });
        assertMatchesEffectiveRuntimeModel(selected, i.effectiveRuntimeModel);
        runtimePolicySnapshotId = selected.id;
      }
      const reportedNothing = TOKEN_FIELDS.every(
        (field) => i[field] === undefined,
      );
      return usage.create({
        userId: i.userId,
        assessmentId: i.assessmentId,
        runId: i.runId,
        agentRole: i.agentRole,
        provider: i.provider,
        model: i.model,
        invocationId: i.invocationId,
        providerResponseId: i.providerResponseId,
        inputTokens: i.inputTokens,
        cachedInputTokens: i.cachedInputTokens,
        cacheWriteTokens: i.cacheWriteTokens,
        outputTokens: i.outputTokens,
        reasoningTokens: i.reasoningTokens,
        // Informational provider total; never rebuilt from the other buckets.
        totalTokens: i.totalTokens,
        runtimePolicySnapshotId,
        status: reportedNothing
          ? LLM_USAGE_STATUSES.UNAVAILABLE
          : LLM_USAGE_STATUSES.SETTLED,
        availabilityReason: reportedNothing
          ? LLM_USAGE_AVAILABILITY_REASONS.providerUsageMetadataMissing
          : undefined,
        occurredAt: i.occurredAt,
      });
    });
  }
}
