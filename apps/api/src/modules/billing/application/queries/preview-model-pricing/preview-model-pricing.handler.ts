import { Inject, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  MODEL_PRICING_PREVIEW_SOURCES,
  MODEL_PRICING_SCOPES,
  TOKEN_BUCKET_POLICIES,
  normalizeModelPricingScopeKey,
  type MicrocreditTariffRates,
  type MicrocreditUsageBuckets,
  type ModelPricingScope,
  type ModelTariffRateScheduleView,
  type PreviewModelPricingResponse,
} from "@lcsp/contracts/billing";
import type { AppConfig } from "../../../../../config/config.types.js";
import {
  InvalidBillingInputError,
  ModelPricingInvalidIntervalError,
  ModelPricingNotFoundError,
} from "../../../domain/billing.errors.js";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
} from "../../../domain/repositories/model-pricing.port.js";
import {
  readSafeModelUsageDebitMode,
  toMicrocreditTariffRates,
  toModelTariffRateScheduleView,
} from "../../mappers/model-pricing-view.mapper.js";
import { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "../../shared/runtime-model-allowlist.service.js";
import { PreviewModelPricingQuery } from "./preview-model-pricing.query.js";

/**
 * Business purpose: Convert validated preview usage token string counts into `bigint` `MicrocreditUsageBuckets` for exact integer pricing math.
 *
 * Business rules:
 * - Preserves `undefined` for optional token buckets so omitted buckets do not trigger unsupported-bucket rejections unnecessarily.
 *
 * Execution flow:
 * 1. Parse required `inputTokens` and `outputTokens` and optional secondary token counts into `bigint`.
 *
 * Failure cases:
 * - Throws `SyntaxError` if called with non-integer strings outside Zod validation.
 *
 * Side effects:
 * - None: pure conversion helper.
 */
/**
 * Business purpose: Convert wire usage token strings into native bigint MicrocreditUsageBuckets for calculations.
 *
 * Business rules:
 * - inputTokens and outputTokens are required and parsed to BigInt.
 * - Secondary token counts (cached input, cache write, reasoning) are parsed if present.
 *
 * Execution flow:
 * 1. Convert inputTokens and outputTokens to BigInt.
 * 2. Convert optional secondary token fields if defined.
 * 3. Return MicrocreditUsageBuckets object.
 *
 * Failure cases:
 * - Throws SyntaxError if token strings contain non-integer characters.
 *
 * Side effects:
 * - Pure data projection.
 */
// Rationale ("Why"): Converts wire string token counts into BigInt bucket values for exact integer math.
// Mechanism ("How"): Maps each token field to BigInt if defined.
// Invariants & Constraints: Token quantities must be non-negative integers.
function toUsageBuckets(
  usage: PreviewModelPricingQuery["input"]["usage"],
): MicrocreditUsageBuckets {
  return {
    inputTokens: BigInt(usage.inputTokens),
    outputTokens: BigInt(usage.outputTokens),
    cachedInputTokens:
      usage.cachedInputTokens !== undefined
        ? BigInt(usage.cachedInputTokens)
        : undefined,
    cacheWriteTokens:
      usage.cacheWriteTokens !== undefined
        ? BigInt(usage.cacheWriteTokens)
        : undefined,
    cacheWrite5mTokens:
      usage.cacheWrite5mTokens !== undefined
        ? BigInt(usage.cacheWrite5mTokens)
        : undefined,
    cacheWrite1hTokens:
      usage.cacheWrite1hTokens !== undefined
        ? BigInt(usage.cacheWrite1hTokens)
        : undefined,
    reasoningTokens:
      usage.reasoningTokens !== undefined
        ? BigInt(usage.reasoningTokens)
        : undefined,
  };
}

/**
 * Business purpose: Verify that an explicitly targeted draft or snapshot scope applies to the requested `(provider, resolvedModel)` pair.
 *
 * Business rules:
 * - `EXACT_MODEL` tariffs require exact normalized `(provider, resolvedModel)` match.
 * - `PROVIDER_DEFAULT` tariffs require matching normalized `provider`.
 * - `GLOBAL_DEFAULT` tariffs apply to any allowlisted `(provider, resolvedModel)`.
 *
 * Execution flow:
 * 1. Compare `tariffScope`, `tariffProvider`, and `tariffModel` against `requestProvider` and `requestModel`.
 *
 * Failure cases:
 * - Throws `InvalidBillingInputError` when the target tariff scope does not cover the requested model.
 *
 * Side effects:
 * - None: pure guard helper.
 */
/**
 * Business purpose: Verify that an explicitly targeted tariff matches the requested provider and model scope.
 *
 * Business rules:
 * - If tariff scope is EXACT_MODEL, provider and model must match requested provider and model.
 * - If tariff scope is PROVIDER_DEFAULT, provider must match requested provider.
 * - Incompatible scopes are rejected with InvalidBillingInputError.
 *
 * Execution flow:
 * 1. Check EXACT_MODEL scope matches provider and model.
 * 2. Check PROVIDER_DEFAULT scope matches provider.
 * 3. Return void if compatible.
 *
 * Failure cases:
 * - Throws InvalidBillingInputError if tariff does not apply to requested provider/model.
 *
 * Side effects:
 * - Pure validation assertion; no side effects.
 */
// Rationale ("Why"): Prevents previewing charges using an explicitly targeted draft/snapshot belonging to a different model or provider.
// Mechanism ("How"): Validates exact provider and model equality based on tariff scope.
// Invariants & Constraints: Fail closed on scope mismatches.
function assertCompatibleTariffScope(
  tariffScope: ModelPricingScope,
  tariffProvider: string | null,
  tariffModel: string | null,
  requestProvider: string,
  requestModel: string,
): void {
  if (
    tariffScope === MODEL_PRICING_SCOPES.exactModel &&
    (tariffProvider?.toLowerCase() !== requestProvider ||
      tariffModel !== requestModel)
  ) {
    throw new InvalidBillingInputError(
      `Target EXACT_MODEL tariff (${String(tariffProvider)}:${String(tariffModel)}) does not match requested (${requestProvider}:${requestModel})`,
    );
  }
  if (
    tariffScope === MODEL_PRICING_SCOPES.providerDefault &&
    tariffProvider?.toLowerCase() !== requestProvider
  ) {
    throw new InvalidBillingInputError(
      `Target PROVIDER_DEFAULT tariff (${String(tariffProvider)}) does not match requested provider '${requestProvider}'`,
    );
  }
}

/**
 * Business purpose: Convert `MicrocreditTariffRates` (`bigint`) into a serializable `ModelTariffRateScheduleView` DTO payload.
 *
 * Business rules:
 * - Converts every `bigint` microcredit value to base-10 string and defaults omitted secondary bucket policies to `TOKEN_BUCKET_POLICIES.unsupported`.
 *
 * Execution flow:
 * 1. Format required and optional rate values to strings or `null`.
 *
 * Failure cases:
 * - None: pure projection helper.
 *
 * Side effects:
 * - None: pure function.
 */
/**
 * Business purpose: Convert internal domain MicrocreditTariffRates into wire ModelTariffRateScheduleView.
 *
 * Business rules:
 * - Rates are converted from BigInt to decimal string representations.
 * - Nullable secondary rates are converted or mapped to null.
 *
 * Execution flow:
 * 1. Map input and output BigInt rates to string.
 * 2. Map reasoning, cached input, and cache write policies and rates.
 * 3. Return ModelTariffRateScheduleView.
 *
 * Failure cases:
 * - Pure projection; does not fail for valid MicrocreditTariffRates.
 *
 * Side effects:
 * - Pure data transformation.
 */
// Rationale ("Why"): Maps internal BigInt rates to contract-compliant string representations for preview responses.
// Mechanism ("How"): Converts BigInt values to decimal string format and maps policy enums.
// Invariants & Constraints: BigInt precision preserved without floating-point loss.
function toScheduleViewFromMicrocreditRates(
  rates: MicrocreditTariffRates,
): ModelTariffRateScheduleView {
  return {
    inputMicrocreditsPerMillion: rates.input.toString(),
    outputMicrocreditsPerMillion: rates.output.toString(),
    reasoningPolicy:
      rates.reasoningPolicy as ModelTariffRateScheduleView["reasoningPolicy"],
    reasoningMicrocreditsPerMillion:
      rates.reasoning !== undefined ? rates.reasoning.toString() : null,
    cachedInputPolicy:
      (rates.cachedInputPolicy as ModelTariffRateScheduleView["cachedInputPolicy"]) ??
      TOKEN_BUCKET_POLICIES.unsupported,
    cachedInputMicrocreditsPerMillion:
      rates.cachedInput !== undefined ? rates.cachedInput.toString() : null,
    cacheWritePolicy:
      (rates.cacheWritePolicy as ModelTariffRateScheduleView["cacheWritePolicy"]) ??
      TOKEN_BUCKET_POLICIES.unsupported,
    cacheWriteMicrocreditsPerMillion:
      rates.cacheWrite !== undefined ? rates.cacheWrite.toString() : null,
    cacheWrite5mMicrocreditsPerMillion:
      rates.cacheWrite5m !== undefined ? rates.cacheWrite5m.toString() : null,
    cacheWrite1hMicrocreditsPerMillion:
      rates.cacheWrite1h !== undefined ? rates.cacheWrite1h.toString() : null,
  };
}

@QueryHandler(PreviewModelPricingQuery)
export class PreviewModelPricingHandler implements IQueryHandler<PreviewModelPricingQuery> {
  constructor(
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly repo: ModelPricingRepositoryPort,
    private readonly allowlistService: RuntimeModelAllowlistService,
    private readonly calculatorService: ModelPricingCalculatorService,
    @Optional()
    private readonly configService?: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Business purpose: Compute a deterministic integer microcredit pricing preview using the exact same allowlist, scope precedence, and calculator as usage settlement.
   *
   * Business rules:
   * - Enforces `RuntimeModelAllowlistService.assertAllowlisted(provider, resolvedModel)` first across every preview mode.
   * - Resolves active assignments via `EXACT_MODEL` -> `PROVIDER_DEFAULT` -> `GLOBAL_DEFAULT` when no explicit `draftId`, `snapshotId`, or inline `rates` is supplied.
   * - Fails closed on unlisted models, missing coverage, incomplete rates, or `MODEL_USAGE_DEBIT=ON`.
   * - Never synthesizes `1.8x` or reference-pricing defaults.
   *
   * Execution flow:
   * 1. Verify `debitMode` posture (`OFF` | `SHADOW`) and assert `(provider, resolvedModel)` is allowlisted.
   * 2. Resolve rates from `draftId`, `snapshotId`, inline `rates`, or active assignments at `effectiveAt ?? dbUtcNow`.
   * 3. Compute exact BigInt charge via `ModelPricingCalculatorService` and return `PreviewModelPricingResponse`.
   *
   * Failure cases:
   * - Throws `BillingDomainError`, `ModelPricingUnlistedModelError`, `ModelPricingNoCoverageError`, `ModelPricingNotFoundError`, `ModelPricingIncompleteRatesError`, `ModelPricingInvalidIntervalError`, or `InvalidBillingInputError`.
   *
   * Side effects:
   * - None: read-only preview calculation with zero wallet or ledger mutations.
   */
  async execute(
    query: PreviewModelPricingQuery,
  ): Promise<PreviewModelPricingResponse> {
    // Why: Admin pricing previews must match production `BillingUsageKernel` microcredit math down to the last microcredit
    // without touching customer wallets or falling back to reference pricing.
    // How: Gates `(provider, resolvedModel)` via allowlist, resolves the requested tariff source, and delegates to `ModelPricingCalculatorService`.
    // Invariants: Pure BigInt integer math; fails closed on unlisted models or missing coverage.
    const debitMode = readSafeModelUsageDebitMode(this.configService);
    const { input } = query;

    const allowlistedEntry = this.allowlistService.assertAllowlisted(
      input.provider,
      input.resolvedModel,
    );
    const normalizedProvider = allowlistedEntry.provider.toLowerCase();
    const resolvedModel = allowlistedEntry.model;
    const usage = toUsageBuckets(input.usage);

    const sourceCount =
      Number(input.draftId !== undefined) +
      Number(input.snapshotId !== undefined) +
      Number(input.rates !== undefined);
    if (sourceCount > 1) {
      throw new InvalidBillingInputError(
        "Provide at most one of draftId, snapshotId, or rates",
      );
    }

    if (input.draftId !== undefined) {
      const draft = await this.repo.findDraftById(input.draftId);
      if (!draft) {
        throw new ModelPricingNotFoundError(
          `Model tariff draft '${input.draftId}' was not found`,
        );
      }
      assertCompatibleTariffScope(
        draft.scope,
        draft.provider,
        draft.resolvedModel,
        normalizedProvider,
        resolvedModel,
      );
      const charge = this.calculatorService.calculateCharge({
        usage,
        ratesMicrocreditsPerMillion: toMicrocreditTariffRates(draft),
      });
      const warnings = ["PREVIEW_USING_UNPUBLISHED_DRAFT"];
      if (draft.scope !== MODEL_PRICING_SCOPES.exactModel) {
        warnings.push(`FALLBACK_SCOPE_${draft.scope}`);
      }
      return {
        provider: normalizedProvider,
        resolvedModel,
        allowlisted: true,
        resolvedScope: draft.scope,
        normalizedScopeKey: draft.normalizedScopeKey,
        source: MODEL_PRICING_PREVIEW_SOURCES.draft,
        draftId: draft.id,
        snapshotId: draft.publishedSnapshotId,
        assignmentId: null,
        chargeMicrocredits: charge.chargeMicrocredits.toString(),
        chargeCreditsDecimal: charge.chargeCreditsDecimal,
        effectiveRates: toModelTariffRateScheduleView(draft),
        warnings,
        debitMode,
      };
    }

    if (input.snapshotId !== undefined) {
      const snapshot = await this.repo.findSnapshotById(input.snapshotId);
      if (!snapshot) {
        throw new ModelPricingNotFoundError(
          `Model tariff snapshot '${input.snapshotId}' was not found`,
        );
      }
      assertCompatibleTariffScope(
        snapshot.scope,
        snapshot.provider,
        snapshot.resolvedModel,
        normalizedProvider,
        resolvedModel,
      );
      const charge = this.calculatorService.calculateCharge({
        usage,
        ratesMicrocreditsPerMillion: toMicrocreditTariffRates(snapshot),
      });
      const warnings =
        snapshot.scope !== MODEL_PRICING_SCOPES.exactModel
          ? [`FALLBACK_SCOPE_${snapshot.scope}`]
          : [];
      return {
        provider: normalizedProvider,
        resolvedModel,
        allowlisted: true,
        resolvedScope: snapshot.scope,
        normalizedScopeKey: snapshot.normalizedScopeKey,
        source: MODEL_PRICING_PREVIEW_SOURCES.snapshot,
        draftId: snapshot.sourceDraftId,
        snapshotId: snapshot.id,
        assignmentId: null,
        chargeMicrocredits: charge.chargeMicrocredits.toString(),
        chargeCreditsDecimal: charge.chargeCreditsDecimal,
        effectiveRates: toModelTariffRateScheduleView(snapshot),
        warnings,
        debitMode,
      };
    }

    if (input.rates !== undefined) {
      const inlineRates: MicrocreditTariffRates = {
        input: BigInt(input.rates.inputMicrocreditsPerMillion),
        output: BigInt(input.rates.outputMicrocreditsPerMillion),
        reasoningPolicy: input.rates.reasoningPolicy,
        reasoning:
          input.rates.reasoningMicrocreditsPerMillion !== null &&
          input.rates.reasoningMicrocreditsPerMillion !== undefined
            ? BigInt(input.rates.reasoningMicrocreditsPerMillion)
            : undefined,
        cachedInputPolicy: input.rates.cachedInputPolicy,
        cachedInput:
          input.rates.cachedInputMicrocreditsPerMillion !== null &&
          input.rates.cachedInputMicrocreditsPerMillion !== undefined
            ? BigInt(input.rates.cachedInputMicrocreditsPerMillion)
            : undefined,
        cacheWritePolicy: input.rates.cacheWritePolicy,
        cacheWrite:
          input.rates.cacheWriteMicrocreditsPerMillion !== null &&
          input.rates.cacheWriteMicrocreditsPerMillion !== undefined
            ? BigInt(input.rates.cacheWriteMicrocreditsPerMillion)
            : undefined,
        cacheWrite5m:
          input.rates.cacheWrite5mMicrocreditsPerMillion !== null &&
          input.rates.cacheWrite5mMicrocreditsPerMillion !== undefined
            ? BigInt(input.rates.cacheWrite5mMicrocreditsPerMillion)
            : undefined,
        cacheWrite1h:
          input.rates.cacheWrite1hMicrocreditsPerMillion !== null &&
          input.rates.cacheWrite1hMicrocreditsPerMillion !== undefined
            ? BigInt(input.rates.cacheWrite1hMicrocreditsPerMillion)
            : undefined,
      };
      const charge = this.calculatorService.calculateCharge({
        usage,
        ratesMicrocreditsPerMillion: inlineRates,
      });
      return {
        provider: normalizedProvider,
        resolvedModel,
        allowlisted: true,
        resolvedScope: MODEL_PRICING_SCOPES.exactModel,
        normalizedScopeKey: normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.exactModel,
          normalizedProvider,
          resolvedModel,
        ),
        source: MODEL_PRICING_PREVIEW_SOURCES.inlineRates,
        draftId: null,
        snapshotId: null,
        assignmentId: null,
        chargeMicrocredits: charge.chargeMicrocredits.toString(),
        chargeCreditsDecimal: charge.chargeCreditsDecimal,
        effectiveRates: toScheduleViewFromMicrocreditRates(inlineRates),
        warnings: ["PREVIEW_USING_INLINE_RATES"],
        debitMode,
      };
    }

    let effectiveAt: Date;
    if (input.effectiveAt !== undefined) {
      effectiveAt = new Date(input.effectiveAt);
      if (!Number.isFinite(effectiveAt.getTime())) {
        throw new ModelPricingInvalidIntervalError(
          "Invalid effectiveAt UTC timestamp",
        );
      }
    } else {
      effectiveAt = await this.repo.getDbUtcNow();
    }

    const candidates = await this.repo.listActiveAssignmentsAt(effectiveAt);
    const preview = this.calculatorService.previewCharge({
      provider: normalizedProvider,
      resolvedModel,
      usage,
      candidates,
    });

    const warnings =
      preview.resolvedScope !== MODEL_PRICING_SCOPES.exactModel
        ? [`FALLBACK_SCOPE_${preview.resolvedScope}`]
        : [];

    return {
      provider: normalizedProvider,
      resolvedModel,
      allowlisted: true,
      resolvedScope: preview.resolvedScope,
      normalizedScopeKey: preview.normalizedScopeKey,
      source: MODEL_PRICING_PREVIEW_SOURCES.activeAssignment,
      draftId: null,
      snapshotId: preview.snapshotId,
      assignmentId: preview.assignmentId,
      chargeMicrocredits: preview.chargeMicrocredits.toString(),
      chargeCreditsDecimal: preview.chargeCreditsDecimal,
      effectiveRates: toScheduleViewFromMicrocreditRates(
        preview.ratesMicrocreditsPerMillion,
      ),
      warnings,
      debitMode,
    };
  }
}
