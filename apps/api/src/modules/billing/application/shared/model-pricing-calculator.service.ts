import { Injectable } from "@nestjs/common";
import {
  MODEL_PRICING_SCOPES,
  TOKEN_BUCKET_POLICIES,
  calculateMicrocreditCharge,
  formatMicrocreditsToDecimal,
  normalizeModelPricingScopeKey,
  resolveEffectivePricingScope,
  type CalculateMicrocreditChargeInput,
  type MicrocreditTariffRates,
  type MicrocreditUsageBuckets,
  type ModelPricingScope,
} from "@lcsp/contracts/billing";
import {
  InvalidBillingInputError,
  ModelPricingIncompleteRatesError,
  ModelPricingNoCoverageError,
} from "../../domain/billing.errors.js";
import { RuntimeModelAllowlistService } from "./runtime-model-allowlist.service.js";

export type TariffCandidate = {
  scope: ModelPricingScope;
  normalizedScopeKey: string;
  snapshotId: string;
  assignmentId: string;
  version: number;
  ratesMicrocreditsPerMillion: MicrocreditTariffRates;
};

export type ResolveEffectiveTariffInput = {
  provider: string;
  resolvedModel: string;
  candidates: readonly TariffCandidate[];
};

export type MicrocreditChargeResult = {
  chargeMicrocredits: bigint;
  chargeCreditsDecimal: string;
};

export type PreviewChargeInput = {
  provider: string;
  resolvedModel: string;
  usage: MicrocreditUsageBuckets;
  candidates: readonly TariffCandidate[];
};

export type PreviewChargeResult = {
  resolvedScope: ModelPricingScope;
  normalizedScopeKey: string;
  snapshotId: string;
  assignmentId: string;
  version: number;
  ratesMicrocreditsPerMillion: MicrocreditTariffRates;
  chargeMicrocredits: bigint;
  chargeCreditsDecimal: string;
};

const VALID_BUCKET_POLICIES = new Set<string>(
  Object.values(TOKEN_BUCKET_POLICIES),
);

@Injectable()
export class ModelPricingCalculatorService {
  constructor(
    private readonly allowlistService: RuntimeModelAllowlistService,
  ) {}

  /**
   * Business purpose: Validate that a direct-credit tariff rate schedule is complete, non-negative, and free of forbidden bucket policies.
   *
   * Business rules:
   * - `input` and `output` rates must be non-negative `bigint` microcredit values.
   * - Optional secondary rates (`reasoning`, `cachedInput`, `cacheWrite`, `cacheWrite5m`, `cacheWrite1h`) when defined must be non-negative `bigint`s.
   * - `cachedInputPolicy` and `cacheWritePolicy` must never be `INCLUDED_IN_OUTPUT`.
   * - `SEPARATE_RATE` policies must specify their required non-null rate(s); missing rates never default to `0n`.
   *
   * Execution flow:
   * 1. Verify `input` and `output` are non-negative `bigint`s and every defined optional rate is a non-negative `bigint`.
   * 2. Verify `reasoningPolicy`, `cachedInputPolicy`, and `cacheWritePolicy` are valid `TOKEN_BUCKET_POLICIES` without `INCLUDED_IN_OUTPUT` on cache buckets.
   * 3. Enforce required rate presence whenever any bucket policy is `SEPARATE_RATE`.
   *
   * Failure cases:
   * - Throws `ModelPricingIncompleteRatesError` (`MODEL_PRICING_INCOMPLETE_RATES`) if any rate or policy invariant is violated.
   *
   * Side effects:
   * - None: pure validation check; performs no database writes or mutations.
   */
  assertCompleteTariffRates(rates: MicrocreditTariffRates): void {
    // Why: Prevents drafts, snapshots, or previews with missing secondary-bucket rates from silently pricing tokens as `0n`.
    // How: Checks bigint non-negativity across all rate fields, validates policy enum membership, and requires rates for `SEPARATE_RATE`.
    // Invariants: Matches `calculateMicrocreditCharge` rate expectations strictly using `bigint` arithmetic only.
    if (!rates || typeof rates !== "object") {
      throw new ModelPricingIncompleteRatesError(
        "Tariff rates object is required",
      );
    }

    if (typeof rates.input !== "bigint" || rates.input < 0n) {
      throw new ModelPricingIncompleteRatesError(
        "rates.input must be a non-negative bigint",
      );
    }
    if (typeof rates.output !== "bigint" || rates.output < 0n) {
      throw new ModelPricingIncompleteRatesError(
        "rates.output must be a non-negative bigint",
      );
    }

    const optionalRateFields: Array<[string, unknown]> = [
      ["reasoning", rates.reasoning],
      ["cachedInput", rates.cachedInput],
      ["cacheWrite", rates.cacheWrite],
      ["cacheWrite5m", rates.cacheWrite5m],
      ["cacheWrite1h", rates.cacheWrite1h],
    ];
    for (const [fieldName, value] of optionalRateFields) {
      if (value !== undefined && (typeof value !== "bigint" || value < 0n)) {
        throw new ModelPricingIncompleteRatesError(
          `rates.${fieldName} must be a non-negative bigint when provided`,
        );
      }
    }

    if (
      typeof rates.reasoningPolicy !== "string" ||
      !VALID_BUCKET_POLICIES.has(rates.reasoningPolicy)
    ) {
      throw new ModelPricingIncompleteRatesError(
        `Invalid reasoningPolicy: ${String(rates.reasoningPolicy)}`,
      );
    }
    if (
      rates.reasoningPolicy === TOKEN_BUCKET_POLICIES.separateRate &&
      rates.reasoning === undefined
    ) {
      throw new ModelPricingIncompleteRatesError(
        "Missing reasoning rate for SEPARATE_RATE policy",
      );
    }

    this.assertOptionalCachePolicy(
      "cachedInputPolicy",
      rates.cachedInputPolicy,
      rates.cachedInput !== undefined,
    );
    this.assertOptionalCachePolicy(
      "cacheWritePolicy",
      rates.cacheWritePolicy,
      rates.cacheWrite !== undefined ||
        rates.cacheWrite5m !== undefined ||
        rates.cacheWrite1h !== undefined,
    );
  }

  /**
   * Business purpose: Resolve the highest-precedence effective tariff for a runtime-allowlisted `(provider, resolvedModel)`.
   *
   * Business rules:
   * - Enforces runtime allowlist gating via `RuntimeModelAllowlistService` BEFORE checking scope precedence (even if `GLOBAL_DEFAULT` exists).
   * - Computes canonical scope keys via `normalizeModelPricingScopeKey` so `PROVIDER_DEFAULT` matches only the target provider.
   * - Delegates strict precedence (`EXACT_MODEL` -> `PROVIDER_DEFAULT` -> `GLOBAL_DEFAULT`) to `@lcsp/contracts/billing` `resolveEffectivePricingScope`.
   *
   * Execution flow:
   * 1. Assert `(provider, resolvedModel)` is allowlisted via `allowlistService.assertAllowlisted`.
   * 2. Compute canonical `exactKey`, `providerKey`, and `globalKey` and filter `candidates` strictly to matching normalized keys.
   * 3. Invoke `resolveEffectivePricingScope` with provider-scoped allowlisted models and available scopes.
   * 4. Validate the selected candidate's rate completeness and return it.
   *
   * Failure cases:
   * - Throws `ModelPricingUnlistedModelError` if `(provider, resolvedModel)` is unlisted, untrimmed, or mismatched.
   * - Throws `ModelPricingNoCoverageError` if no matching tariff candidate exists.
   * - Throws `ModelPricingIncompleteRatesError` if the matched candidate's rates fail completeness validation.
   *
   * Side effects:
   * - None: pure/read-only resolution over supplied candidates and cached allowlist.
   */
  resolveEffectiveTariff(input: ResolveEffectiveTariffInput): TariffCandidate {
    // Why: Both live usage settlement and Admin preview must resolve the exact same tariff candidate under identical
    // allowlist and precedence rules, never falling back to synthetic markup multipliers or mismatched providers.
    // How: Gates `(provider, resolvedModel)` first, indexes candidates by canonical normalizedScopeKey, and delegates
    // precedence selection to `@lcsp/contracts/billing` `resolveEffectivePricingScope`.
    // Invariants: Never resolves a tariff for an unlisted model or another provider's `PROVIDER_DEFAULT`.
    this.allowlistService.assertAllowlisted(
      input.provider,
      input.resolvedModel,
    );

    const exactKey = normalizeModelPricingScopeKey(
      MODEL_PRICING_SCOPES.exactModel,
      input.provider,
      input.resolvedModel,
    );
    const providerKey = normalizeModelPricingScopeKey(
      MODEL_PRICING_SCOPES.providerDefault,
      input.provider,
      null,
    );
    const globalKey = normalizeModelPricingScopeKey(
      MODEL_PRICING_SCOPES.globalDefault,
      null,
      null,
    );

    const expectedKeyByScope: Readonly<Record<ModelPricingScope, string>> = {
      [MODEL_PRICING_SCOPES.exactModel]: exactKey,
      [MODEL_PRICING_SCOPES.providerDefault]: providerKey,
      [MODEL_PRICING_SCOPES.globalDefault]: globalKey,
    };

    const matchedByScope = new Map<ModelPricingScope, TariffCandidate>();
    for (const candidate of input.candidates) {
      const expectedKey = expectedKeyByScope[candidate.scope];
      if (expectedKey && candidate.normalizedScopeKey === expectedKey) {
        if (!matchedByScope.has(candidate.scope)) {
          matchedByScope.set(candidate.scope, candidate);
        }
      }
    }

    const availableScopes = Array.from(matchedByScope.keys());
    if (availableScopes.length === 0) {
      throw new ModelPricingNoCoverageError(
        `No active tariff coverage found for allowlisted model '${input.resolvedModel}' (${input.provider.toLowerCase()})`,
      );
    }

    const normalizedProvider = input.provider.trim().toLowerCase();
    const resolved = resolveEffectivePricingScope({
      resolvedModel: input.resolvedModel,
      provider: normalizedProvider,
      allowlistedModels:
        this.allowlistService.listAllowlistedModels(normalizedProvider),
      availableScopes,
    });

    const selected = matchedByScope.get(resolved.scope);
    if (!selected) {
      throw new ModelPricingNoCoverageError(
        `Resolved scope '${resolved.scope}' missing from candidate set`,
      );
    }

    this.assertCompleteTariffRates(selected.ratesMicrocreditsPerMillion);
    return selected;
  }

  /**
   * Business purpose: Compute exact integer microcredit charge and canonical decimal string using the shared contracts calculator.
   *
   * Business rules:
   * - Uses solely `calculateMicrocreditCharge` and `formatMicrocreditsToDecimal` from `@lcsp/contracts/billing` (zero floats, zero markup synthesis).
   * - Fails closed when required rates are missing or a non-zero bucket is `UNSUPPORTED`.
   *
   * Execution flow:
   * 1. Validate tariff rate completeness via `assertCompleteTariffRates`.
   * 2. Call `calculateMicrocreditCharge` to compute exact sum-then-divide integer microcredits.
   * 3. Format the result via `formatMicrocreditsToDecimal` and return both representations.
   *
   * Failure cases:
   * - Throws `ModelPricingIncompleteRatesError` when tariff rates/policies reject the usage buckets.
   * - Throws `InvalidBillingInputError` when token usage buckets are negative or inconsistent.
   *
   * Side effects:
   * - None: pure deterministic BigInt calculation.
   */
  calculateCharge(
    input: CalculateMicrocreditChargeInput,
  ): MicrocreditChargeResult {
    // Why: Guarantees Admin preview and usage settlement compute identical microcredits down to the last microcredit.
    // How: Validates tariff rates, delegates strictly to `calculateMicrocreditCharge`, and maps contract errors to typed Billing errors.
    // Invariants: Never substitutes `0n` for missing rates and never uses floating-point arithmetic.
    this.assertCompleteTariffRates(input.ratesMicrocreditsPerMillion);

    let chargeMicrocredits: bigint;
    try {
      chargeMicrocredits = calculateMicrocreditCharge(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("usage.") ||
        message.includes("exceeds outputTokens") ||
        message.includes("Inconsistent cacheWriteTokens")
      ) {
        throw new InvalidBillingInputError(message);
      }
      throw new ModelPricingIncompleteRatesError(message);
    }

    return {
      chargeMicrocredits,
      chargeCreditsDecimal: formatMicrocreditsToDecimal(chargeMicrocredits),
    };
  }

  /**
   * Business purpose: Resolve the effective tariff for an allowlisted model and compute a deterministic preview charge.
   *
   * Business rules:
   * - Enforces allowlist gating, scope precedence, rate completeness, and exact BigInt math in one unified flow.
   *
   * Execution flow:
   * 1. Resolve the effective tariff candidate via `resolveEffectiveTariff`.
   * 2. Compute exact integer microcredit charge via `calculateCharge`.
   * 3. Return resolved scope metadata alongside microcredit and decimal charge outputs.
   *
   * Failure cases:
   * - Throws `ModelPricingUnlistedModelError`, `ModelPricingNoCoverageError`, `ModelPricingIncompleteRatesError`, or `InvalidBillingInputError`.
   *
   * Side effects:
   * - None: pure/read-only preview calculation with zero wallet or database mutations.
   */
  previewCharge(input: PreviewChargeInput): PreviewChargeResult {
    // Why: Admin pricing preview must exercise the exact same allowlist, scope resolution, and integer calculator as settlement.
    // How: Chains `resolveEffectiveTariff` directly into `calculateCharge` and packages the resolved attribution fields.
    // Invariants: Zero wallet mutations, zero `MODEL_USAGE_DEBIT` side effects, and zero reference-pricing fallback.
    const selected = this.resolveEffectiveTariff({
      provider: input.provider,
      resolvedModel: input.resolvedModel,
      candidates: input.candidates,
    });

    const charge = this.calculateCharge({
      usage: input.usage,
      ratesMicrocreditsPerMillion: selected.ratesMicrocreditsPerMillion,
    });

    return {
      resolvedScope: selected.scope,
      normalizedScopeKey: selected.normalizedScopeKey,
      snapshotId: selected.snapshotId,
      assignmentId: selected.assignmentId,
      version: selected.version,
      ratesMicrocreditsPerMillion: selected.ratesMicrocreditsPerMillion,
      chargeMicrocredits: charge.chargeMicrocredits,
      chargeCreditsDecimal: charge.chargeCreditsDecimal,
    };
  }

  /**
   * Business purpose: Validate an optional input-side cache policy (`cachedInputPolicy` or `cacheWritePolicy`).
   *
   * Business rules:
   * - Rejects unknown policy strings and forbids `INCLUDED_IN_OUTPUT` on input/cache-write buckets.
   * - Requires at least one rate to be supplied when `SEPARATE_RATE` is selected.
   *
   * Execution flow:
   * 1. Skip validation if the optional policy is `undefined`.
   * 2. Verify membership in `TOKEN_BUCKET_POLICIES` and reject `INCLUDED_IN_OUTPUT`.
   * 3. Require `hasRate` to be true when the policy is `SEPARATE_RATE`.
   *
   * Failure cases:
   * - Throws `ModelPricingIncompleteRatesError` on invalid policy, forbidden `INCLUDED_IN_OUTPUT`, or missing separate rate.
   *
   * Side effects:
   * - None: pure validation helper.
   */
  private assertOptionalCachePolicy(
    fieldName: string,
    policy: string | undefined,
    hasRate: boolean,
  ): void {
    // Why: Input-side cache buckets cannot be included in output rates and must never silently zero-rate under `SEPARATE_RATE`.
    // How: Checks policy membership, rejects `INCLUDED_IN_OUTPUT`, and requires a non-null rate when `SEPARATE_RATE`.
    // Invariants: Keeps rate validation 1:1 aligned with `calculateMicrocreditCharge`.
    if (policy === undefined) {
      return;
    }
    if (typeof policy !== "string" || !VALID_BUCKET_POLICIES.has(policy)) {
      throw new ModelPricingIncompleteRatesError(
        `Invalid ${fieldName}: ${String(policy)}`,
      );
    }
    if (policy === TOKEN_BUCKET_POLICIES.includedInOutput) {
      throw new ModelPricingIncompleteRatesError(
        `INCLUDED_IN_OUTPUT policy is invalid for ${fieldName}`,
      );
    }
    if (policy === TOKEN_BUCKET_POLICIES.separateRate && !hasRate) {
      throw new ModelPricingIncompleteRatesError(
        `Missing rate for ${fieldName} SEPARATE_RATE policy`,
      );
    }
  }
}
