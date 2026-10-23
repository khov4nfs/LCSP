import { RULE_SET_PREPARATION_SYSTEM_ACTOR } from "@lcsp/contracts/compliance-rule-set";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  LLM_USAGE_AVAILABILITY_REASONS,
  LLM_USAGE_STATUSES,
  MODEL_ATTEMPT_STATUSES,
  USAGE_TOKEN_FIELDS,
  estimateOfficialReferenceCost,
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
  resolvePreparationOwner(runId: string): Promise<string | null>;
  recordUsage(input: LlmUsageRecordInput): Promise<unknown>;
};

const TOKEN_FIELDS = USAGE_TOKEN_FIELDS;

/**
 * Provider-reported token usage is telemetry only. Recording a model invocation
 * never reserves or debits credits, or depends on the wallet:
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

  async resolvePreparationOwner(runId: string): Promise<string | null> {
    const run = await this.prisma?.ruleSetPreparationRun.findUnique({
      where: { id: runId },
      select: { requestedBy: true },
    });
    if (!run)
      throw new OwnershipMismatchError("Preparation run does not exist");
    if (run.requestedBy === RULE_SET_PREPARATION_SYSTEM_ACTOR) return null;
    const owner = await this.prisma!.user.findUnique({
      where: { id: run.requestedBy },
      select: { id: true },
    });
    if (!owner)
      throw new OwnershipMismatchError("Preparation requester does not exist");
    return owner.id;
  }

  /** Idempotent on (userId, invocationId); stores only what the provider reported. */
  recordUsage(i: LlmUsageRecordInput) {
    return this.transactions.runForUser(i.userId ?? i.runId, async (repos) => {
      const { usage } = repos;
      if (!i.invocationId || !i.provider || !i.model)
        throw new BillingDomainError("Usage identity is required");
      if (i.effectiveRuntimeModel)
        assertEffectiveRuntimeModelAt(i.effectiveRuntimeModel, i.occurredAt);
      if (TOKEN_FIELDS.some((field) => (i[field] ?? 0n) < 0n))
        throw new BillingDomainError("Token counts cannot be negative");

      const existing = await usage.findByInvocation(
        i.userId,
        i.invocationId,
        i.runId,
      );
      if (existing) {
        if (
          existing.provider !== i.provider ||
          existing.model !== i.model ||
          existing.agentRole !== i.agentRole ||
          existing.assessmentId !== (i.assessmentId ?? null) ||
          existing.runId !== i.runId ||
          existing.occurredAt.getTime() !== i.occurredAt.getTime()
        )
          throw new BillingIdempotencyConflictError(
            "Usage identity replay differs",
          );
        // A response may arrive after timeout. Completed usage wins over delivery-order races.
        if (
          existing.attemptStatus &&
          i.attemptStatus &&
          existing.attemptStatus !== MODEL_ATTEMPT_STATUSES.COMPLETED
        ) {
          if (
            i.attemptStatus !== MODEL_ATTEMPT_STATUSES.STARTED &&
            i.attemptStatus !== existing.attemptStatus
          ) {
            if (i.providerResponseId) {
              const response = await usage.findByProviderResponse(
                i.provider,
                i.providerResponseId,
              );
              if (response && response.id !== existing.id)
                throw new BillingIdempotencyConflictError(
                  "Provider response already recorded",
                );
            }
            return usage.update(existing.id, {
              attemptStatus: i.attemptStatus,
              failureClass: i.failureClass,
              providerResponseId: i.providerResponseId,
              ...Object.fromEntries(
                TOKEN_FIELDS.filter((f) => i[f] !== undefined).map((f) => [
                  f,
                  i[f],
                ]),
              ),
              ...(i.attemptStatus === MODEL_ATTEMPT_STATUSES.COMPLETED
                ? {
                    referenceCostSnapshot: estimateOfficialReferenceCost(
                      i.provider,
                      i.model,
                      i.occurredAt,
                      i,
                    ),
                    status: TOKEN_FIELDS.some((f) => i[f] !== undefined)
                      ? LLM_USAGE_STATUSES.SETTLED
                      : LLM_USAGE_STATUSES.UNAVAILABLE,
                    availabilityReason: TOKEN_FIELDS.some(
                      (f) => i[f] !== undefined,
                    )
                      ? null
                      : LLM_USAGE_AVAILABILITY_REASONS.providerUsageMetadataMissing,
                  }
                : {}),
            });
          }
          return existing;
        }
        if (
          i.attemptStatus &&
          i.attemptStatus !== MODEL_ATTEMPT_STATUSES.COMPLETED
        )
          return existing;
        if (
          TOKEN_FIELDS.some((f) => (existing[f] ?? null) !== (i[f] ?? null)) ||
          (existing.providerResponseId ?? null) !==
            (i.providerResponseId ?? null)
        )
          throw new BillingIdempotencyConflictError("Usage replay differs");
        if (
          existing.status === LLM_USAGE_STATUSES.SETTLED &&
          existing.availabilityReason ===
            LLM_USAGE_AVAILABILITY_REASONS.providerUsageMetadataMissing
        )
          return usage.update(existing.id, { availabilityReason: null });
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
        attemptStatus: i.attemptStatus,
        failureClass: i.failureClass,
        referenceCostSnapshot: estimateOfficialReferenceCost(
          i.provider,
          i.model,
          i.occurredAt,
          i,
        ),
        inputTokensIncludingCache: i.inputTokensIncludingCache,
        cacheWrite5mTokens: i.cacheWrite5mTokens,
        cacheWrite1hTokens: i.cacheWrite1hTokens,
        visibleOutputTokens: i.visibleOutputTokens,
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
