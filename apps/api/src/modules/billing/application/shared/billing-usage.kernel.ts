import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  LLM_USAGE_AVAILABILITY_REASONS,
  LLM_USAGE_STATUSES,
  MODEL_ATTEMPT_STATUSES,
  MODEL_USAGE_DEBIT_MODES,
  USAGE_TOKEN_FIELDS,
  calculateMicrocreditCharge,
  estimateOfficialReferenceCost,
  projectSignedWalletBalance,
  resolveEffectivePricingScope,
  type MicrocreditTariffRates,
  type ModelPricingScope,
  type ModelUsageDebitMode,
  type TokenBucketPolicy,
} from "@lcsp/contracts/billing";
import { RULE_SET_PREPARATION_SYSTEM_ACTOR } from "@lcsp/contracts/compliance-rule-set";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type {
  AppConfig,
  ModelUsageDebitConfig,
} from "../../../../config/config.types.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
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
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../domain/repositories/billing-transaction.port.js";
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
    @Optional() private readonly configService?: ConfigService<AppConfig, true>,
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

  /**
   * Business purpose: Attribute Preparation usage to its real requesting user while keeping
   *   system-requested work ownerless.
   *
   * Business rules:
   * - The Preparation run must exist; the canonical system actor maps to null instead of a
   *   fabricated customer.
   * - A user-requested run must reference an existing user.
   *
   * Execution flow:
   * 1. Read the run’s requester.
   * 2. Return null for the system actor, otherwise resolve and return the existing requester’s
   *   user ID.
   *
   * Failure cases:
   * - A missing run, unavailable resolver or missing requester raises OwnershipMismatchError;
   *   database errors propagate.
   *
   * Side effects:
   * - Read-only database lookups; no usage, reservation or credit movement.
   */
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

  /**
   * Business purpose: Record provider-reported invocation telemetry idempotently, preserving
   *   late completion and unknown usage without charging a wallet.
   *
   * Business rules:
   * - Require invocation/provider/model identity, nonnegative reported token buckets and a
   *   temporally valid effective model when supplied.
   * - A replay must preserve workflow, actor-role, provider/model and occurrence identity; one
   *   provider response cannot belong to another invocation.
   * - Completed usage wins delivery races; absent token buckets stay absent, provider totals
   *   are not reconstructed, and official reference costs remain estimates.
   *
   * Execution flow:
   * 1. Serialize the owner/run transaction and validate incoming usage identity, tokens and
   *   effective-model metadata.
   * 2. Resolve an existing invocation, reconcile a later attempt outcome or verify an exact
   *   completed replay.
   * 3. For a new invocation, reject duplicate response ownership and resolve the immutable
   *   routing-policy snapshot if supplied.
   * 4. Persist only reported token fields, attempt metadata and the reference estimate, marking
   *   unavailable usage explicitly.
   *
   * Failure cases:
   * - Invalid identity/tokens/model timing raises the existing billing errors; conflicting
   *   replays or reused provider responses raise BillingIdempotencyConflictError.
   * - Transaction/repository failures propagate without partial transactional writes; missing
   *   provider usage is UNAVAILABLE rather than invented zero usage.
   *
   * Side effects:
   * - Creates or updates usage receipts and may ensure a routing-policy snapshot inside the
   *   transaction; never reserves/debits credits or invokes a model.
   */
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

  /**
   * Business purpose: Evaluate server-issued admission invariants for a physical provider invocation
   *   at the contract/pure-logic boundary without activating live provider dispatch or wallet holds.
   *
   * Business rules:
   * - Funding principal determines wallet binding requirements:
   *   - `CUSTOMER_WALLET`: requires non-empty `walletId` (non-whitespace) and `spendableMicrocredits > 0n`.
   *   - `PLATFORM_SPONSORED`: strictly requires `walletId === null`; customer wallet balance may be `0n`.
   * - Token bounds must be valid: `maxOutputTokens > 0n` and `maxInputTokens >= 0n`.
   * - In-flight concurrency slot must not be occupied (`inFlightCount < 1`).
   * - Resolved model must be in the runtime allowlist and resolve deterministically to an active
   *   pricing scope (`EXACT_MODEL -> PROVIDER_DEFAULT -> GLOBAL_DEFAULT`).
   * - Computes `maximumExposureMicrocredits` using the canonical microcredit calculator from the
   *   pinned tariff and applied input/output token hard bounds.
   *
   * Execution flow:
   * 1. Validate funding principal and enforce corresponding walletId and balance invariants.
   * 2. Validate token bounds (`maxOutputTokens > 0n`, `maxInputTokens >= 0n`) and in-flight concurrency.
   * 3. Resolve pricing scope for `(resolvedModel, provider)` against the allowlist.
   * 4. Compute `maximumExposureMicrocredits` using `calculateMicrocreditCharge`.
   * 5. Return the pure `ADMITTED` admission contract decision without DB writes.
   *
   * Failure cases:
   * - Throws `BillingDomainError` when:
   *   - `CUSTOMER_WALLET` has blank/whitespace `walletId` or `spendableMicrocredits <= 0n`.
   *   - `PLATFORM_SPONSORED` binds a non-null `walletId`.
   *   - `maxOutputTokens <= 0n` or `maxInputTokens < 0n`.
   *   - Concurrency slot is occupied (`inFlightCount >= 1`).
   *   - Model is unlisted or pricing resolution fails.
   *
   * Side effects:
   * - Pure/read-only contract evaluation; performs zero wallet holds, reservations, or DB writes.
   */
  issueModelUsageAdmission(input: {
    invocationId: string;
    walletId: string | null;
    fundingPrincipal?: string;
    spendableMicrocredits: bigint;
    inFlightCount: number;
    resolvedModel: string;
    provider: string;
    allowlistedModels: readonly string[];
    availableScopes: readonly ModelPricingScope[];
    pricingSnapshotId: string;
    maxInputTokens: bigint;
    maxOutputTokens: bigint;
    maxCachedInputTokens?: bigint;
    maxCacheWriteTokens?: bigint;
    ratesMicrocreditsPerMillion: MicrocreditTariffRates;
  }) {
    // Why: Discriminate between customer-paid invocations (requiring a valid wallet with positive balance)
    // and platform-sponsored invocations (which are funded by system and must never bind customer wallets).
    // How: Validate fundingPrincipal against canonical ADMISSION_FUNDING_PRINCIPALS and verify walletId / balance invariants.
    // Invariants: CUSTOMER_WALLET requires trimmed walletId.length > 0 and spendableMicrocredits > 0n;
    // PLATFORM_SPONSORED requires walletId === null.
    const fundingPrincipal =
      input.fundingPrincipal ?? ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET;

    if (fundingPrincipal === ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET) {
      if (!input.walletId || input.walletId.trim().length === 0) {
        throw new BillingDomainError(
          "CUSTOMER_WALLET admission requires a valid non-empty walletId",
        );
      }
      if (input.spendableMicrocredits <= 0n) {
        throw new BillingDomainError(
          "Insufficient spendable microcredits for paid model invocation admission",
        );
      }
    } else if (
      fundingPrincipal === ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED
    ) {
      if (input.walletId !== null) {
        throw new BillingDomainError(
          "PLATFORM_SPONSORED admission must not bind a customer walletId",
        );
      }
    } else {
      throw new BillingDomainError(
        `Unsupported admission funding principal: ${fundingPrincipal}`,
      );
    }

    // Why: In-flight concurrency is bounded to 1 billable invocation per wallet to prevent race conditions.
    // How: Compare inFlightCount against the single-slot threshold.
    // Invariants: inFlightCount must be 0 for admission to proceed.
    if (input.inFlightCount >= 1) {
      throw new BillingDomainError(
        "Wallet in-flight billable invocation concurrency slot is occupied",
      );
    }

    // Why: Output and input token bounds define the maximum financial exposure of the model call.
    // How: Ensure maxOutputTokens is strictly positive and maxInputTokens is non-negative.
    // Invariants: Exposure calculation requires strictly non-negative integer token bounds.
    if (input.maxOutputTokens <= 0n) {
      throw new BillingDomainError("maxOutputTokens must be strictly positive");
    }
    if (input.maxInputTokens < 0n) {
      throw new BillingDomainError("maxInputTokens cannot be negative");
    }

    const resolvedScope = resolveEffectivePricingScope({
      resolvedModel: input.resolvedModel,
      provider: input.provider,
      allowlistedModels: input.allowlistedModels,
      availableScopes: input.availableScopes,
    });
    const maximumExposureMicrocredits = calculateMicrocreditCharge({
      usage: {
        inputTokens: input.maxInputTokens,
        outputTokens: input.maxOutputTokens,
        cachedInputTokens: input.maxCachedInputTokens,
        cacheWriteTokens: input.maxCacheWriteTokens,
      },
      ratesMicrocreditsPerMillion: input.ratesMicrocreditsPerMillion,
    });
    return {
      invocationId: input.invocationId,
      walletId: input.walletId,
      fundingPrincipal,
      state: ADMISSION_STATES.ADMITTED,
      resolvedModel: input.resolvedModel,
      provider: input.provider,
      pricingSnapshotId: input.pricingSnapshotId,
      pricingResolution: resolvedScope.scope,
      maximumExposureMicrocredits,
    };
  }

  /**
   * Business purpose: Compute pure-logic settlement and signed wallet projection for an admitted
   *   physical invocation while enforcing the WP8 Phase A/A2 `MODEL_USAGE_DEBIT = OFF` gate.
   *
   * Business rules:
   * - Mode resolution rule:
   *   - Candidate mode is resolved with explicit precedence: `input.debitMode ?? configuredMode ?? MODEL_USAGE_DEBIT_MODES.OFF`.
   *   - Fail-closed gate: if either candidate mode OR configured mode is `MODEL_USAGE_DEBIT_MODES.ON`,
   *     immediately throw `BillingDomainError`. Live debit is strictly blocked in WP8.
   *   - When mode resolves to `SHADOW`, actual charge is deducted from projected wallet balance without DB writes.
   *   - When mode resolves to `OFF`, projected wallet balance remains unchanged.
   * - Charge is computed solely from server-pinned admission tariff and provider-reported tokens
   *   via `calculateMicrocreditCharge`; callback payloads cannot override charge or authority.
   * - Resulting ledger balance and `spendableMicrocredits` / `outstandingMicrocredits` projection
   *   are derived via `projectSignedWalletBalance`.
   *
   * Execution flow:
   * 1. Resolve effective debitMode between input and ConfigService.
   * 2. Reject `MODEL_USAGE_DEBIT_MODES.ON` if either input or config is ON (fail-closed).
   * 3. Verify reported invocationId matches admitted invocationId.
   * 4. Compute `actualChargeMicrocredits` using canonical integer microcredit arithmetic.
   * 5. Flag `exceededAdmittedExposure` if actual charge exceeds `maximumExposureMicrocredits`.
   * 6. Compute signed wallet projection without persisting financial ledger/wallet mutations.
   *
   * Failure cases:
   * - Throws `BillingDomainError` if `debitMode === MODEL_USAGE_DEBIT_MODES.ON` or configured mode is ON.
   * - Throws `BillingDomainError` if invocation/admission identity mismatches.
   *
   * Side effects:
   * - Pure/read-only calculation; writes zero ledger debits or wallet projection updates.
   */
  settleAdmittedUsage(input: {
    debitMode?: ModelUsageDebitMode;
    admission: {
      invocationId: string;
      walletId: string | null;
      maximumExposureMicrocredits: bigint;
      ratesMicrocreditsPerMillion: {
        input: bigint;
        output: bigint;
        reasoningPolicy: TokenBucketPolicy;
        reasoning?: bigint;
      };
    };
    reportedUsage: {
      invocationId: string;
      inputTokens: bigint;
      outputTokens: bigint;
      reasoningTokens?: bigint;
    };
    currentLedgerBalanceMicrocredits: bigint;
  }) {
    // Why: Ensure configured system setting and caller-specified mode are harmonized under a safe,
    // explicit precedence rule where live ON debit is blocked under any circumstance in WP8.
    // How: Extract configuredMode from ConfigService, resolve candidate mode as input.debitMode ?? configuredMode ?? OFF,
    // and fail closed if either candidateMode or configuredMode is ON.
    // Invariants: Live debit (ON) is impossible; SHADOW correctly reflects simulated ledger deduction.
    const configuredDebit =
      this.configService?.get<ModelUsageDebitConfig>("modelUsageDebit");
    const configuredMode = configuredDebit?.mode;
    const mode =
      input.debitMode ?? configuredMode ?? MODEL_USAGE_DEBIT_MODES.OFF;
    if (
      mode === MODEL_USAGE_DEBIT_MODES.ON ||
      configuredMode === MODEL_USAGE_DEBIT_MODES.ON
    ) {
      throw new BillingDomainError(
        "MODEL_USAGE_DEBIT is disabled (OFF) until all WP8 enablement gates are closed",
      );
    }
    if (input.reportedUsage.invocationId !== input.admission.invocationId) {
      throw new BillingDomainError(
        "Usage settlement invocationId does not match server-issued admission",
      );
    }
    const actualChargeMicrocredits = calculateMicrocreditCharge({
      usage: {
        inputTokens: input.reportedUsage.inputTokens,
        outputTokens: input.reportedUsage.outputTokens,
        reasoningTokens: input.reportedUsage.reasoningTokens,
      },
      ratesMicrocreditsPerMillion: input.admission.ratesMicrocreditsPerMillion,
    });
    const exceededAdmittedExposure =
      actualChargeMicrocredits > input.admission.maximumExposureMicrocredits;
    const nextLedgerBalance =
      mode === MODEL_USAGE_DEBIT_MODES.OFF
        ? input.currentLedgerBalanceMicrocredits
        : input.currentLedgerBalanceMicrocredits - actualChargeMicrocredits;

    return {
      debitMode: mode,
      invocationId: input.admission.invocationId,
      walletId: input.admission.walletId,
      actualChargeMicrocredits,
      exceededAdmittedExposure,
      state: exceededAdmittedExposure
        ? ADMISSION_STATES.BILLING_INTEGRITY_REVIEW
        : ADMISSION_STATES.SETTLED,
      projectedWallet: projectSignedWalletBalance(nextLedgerBalance),
    };
  }
}
