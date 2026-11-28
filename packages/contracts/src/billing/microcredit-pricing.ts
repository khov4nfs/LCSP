import { z } from "zod";

/**
 * Why: WP8 Phase A/A2 replaces floating-point or coarse integer credit units with an exact
 * fixed-point microcredit ledger unit (1 public credit = 1,000,000 microcredits) so fractional
 * token charges and signed wallet balances remain lossless across PostgreSQL BigInt, NestJS,
 * and client boundaries.
 * How: All arithmetic operates strictly on JavaScript `bigint` values and divides by
 * `MICROCREDITS_PER_CREDIT` once after summing all weighted buckets.
 * Invariants: Never introduce floating-point `number` arithmetic or minimum-charge floors.
 */
export const MICROCREDITS_PER_CREDIT = 1_000_000n;

/**
 * Canonical decimal string pattern for microcredit wire values: optional leading minus,
 * base-10 integer digits, and optional fractional part of 1..6 digits (no whitespace, `+`,
 * leading dot, trailing dot, or scientific notation).
 */
export const CANONICAL_MICROCREDIT_DECIMAL_PATTERN = /^-?\d+(?:\.\d{1,6})?$/;

/** Zod wire schema validating canonical decimal credit strings (up to 6 fractional digits). */
export const microcreditDecimalSchema = z
  .string()
  .regex(CANONICAL_MICROCREDIT_DECIMAL_PATTERN);

/** Zod wire schema validating base-10 integer microcredit strings (signed). */
export const microcreditIntegerStringSchema = z.string().regex(/^-?\d+$/);

/**
 * Signed wallet balance projection returned to callers without hiding negative ledger balances.
 * `spendableMicrocredits = max(balance, 0)` and `outstandingMicrocredits = max(-balance, 0)`.
 */
export type SignedWalletBalanceProjection = {
  ledgerBalanceMicrocredits: string;
  spendableMicrocredits: string;
  outstandingMicrocredits: string;
};

/**
 * Tariff scope hierarchy evaluated strictly from most-specific to least-specific for
 * runtime-allowlisted models (`EXACT_MODEL` -> `PROVIDER_DEFAULT` -> `GLOBAL_DEFAULT`).
 * Note: CamelCase keys match the direct-credit model-pricing contract specification (`ASM-PRICING-01`).
 */
export const MODEL_PRICING_SCOPES = {
  exactModel: "EXACT_MODEL",
  providerDefault: "PROVIDER_DEFAULT",
  globalDefault: "GLOBAL_DEFAULT",
} as const;

export type ModelPricingScope =
  (typeof MODEL_PRICING_SCOPES)[keyof typeof MODEL_PRICING_SCOPES];

/**
 * Lifecycle states of a normalized model-pricing assignment interval.
 */
export const PRICING_ASSIGNMENT_STATUSES = {
  scheduled: "SCHEDULED",
  active: "ACTIVE",
  superseded: "SUPERSEDED",
} as const;

export type PricingAssignmentStatus =
  (typeof PRICING_ASSIGNMENT_STATUSES)[keyof typeof PRICING_ASSIGNMENT_STATUSES];

/**
 * Lifecycle states of a mutable `CustomerModelTariffDraft` before/after atomic publication.
 * Why: Aligns contract draft status constants 1:1 with Prisma `CustomerTariffDraftStatus`.
 * How: Defined as an `as const` object with `SCREAMING_SNAKE_CASE` values and derived union type.
 * Invariants: Only `DRAFT` records may be edited or published; `PUBLISHED` and `ABANDONED` are terminal.
 */
export const CUSTOMER_TARIFF_DRAFT_STATUSES = {
  draft: "DRAFT",
  published: "PUBLISHED",
  abandoned: "ABANDONED",
} as const;

export type CustomerTariffDraftStatus =
  (typeof CUSTOMER_TARIFF_DRAFT_STATUSES)[keyof typeof CUSTOMER_TARIFF_DRAFT_STATUSES];

/**
 * Explicit token-bucket billing policies preventing silent zero-rating of secondary token buckets
 * (such as reasoning tokens or cache buckets).
 */
export const TOKEN_BUCKET_POLICIES = {
  separateRate: "SEPARATE_RATE",
  useOutputRate: "USE_OUTPUT_RATE",
  includedInOutput: "INCLUDED_IN_OUTPUT",
  unsupported: "UNSUPPORTED",
} as const;

export type TokenBucketPolicy =
  (typeof TOKEN_BUCKET_POLICIES)[keyof typeof TOKEN_BUCKET_POLICIES];

/** Non-overlapping provider token counts passed to `calculateMicrocreditCharge`. */
export type MicrocreditUsageBuckets = {
  inputTokens: bigint;
  outputTokens: bigint;
  cachedInputTokens?: bigint;
  cacheWriteTokens?: bigint;
  cacheWrite5mTokens?: bigint;
  cacheWrite1hTokens?: bigint;
  reasoningTokens?: bigint;
};

/** Direct-credit tariff rates (in microcredits per 1,000,000 tokens) and bucket policies. */
export type MicrocreditTariffRates = {
  input: bigint;
  output: bigint;
  reasoningPolicy: TokenBucketPolicy | string;
  reasoning?: bigint;
  cachedInputPolicy?: TokenBucketPolicy | string;
  cachedInput?: bigint;
  cacheWritePolicy?: TokenBucketPolicy | string;
  cacheWrite?: bigint;
  cacheWrite5m?: bigint;
  cacheWrite1h?: bigint;
};

/** Input payload for `calculateMicrocreditCharge`. */
export type CalculateMicrocreditChargeInput = {
  usage: MicrocreditUsageBuckets;
  ratesMicrocreditsPerMillion: MicrocreditTariffRates;
};

/** Input payload for `resolveEffectivePricingScope`. */
export type ResolveEffectivePricingScopeInput = {
  resolvedModel: string;
  provider: string;
  allowlistedModels: readonly string[];
  availableScopes: readonly string[];
};

/** Effective pricing scope resolution result. */
export type EffectivePricingScopeResolution = {
  scope: ModelPricingScope;
};

/**
 * Business purpose: Format an exact signed bigint microcredit amount into a canonical base-10 decimal credit string.
 *
 * Business rules:
 * - One public credit equals 1,000,000 microcredits.
 * - Zero always formats as "0" (never "-0"); trailing fractional zeros and unnecessary decimal points are omitted.
 * - All arithmetic uses exact bigint operations without floating-point conversion.
 *
 * Execution flow:
 * 1. Validate that the input is a bigint and short-circuit zero to "0".
 * 2. Capture sign and compute the absolute whole and fractional microcredit components.
 * 3. Format the whole part and trim trailing zeros from the 6-digit fractional component if non-zero.
 *
 * Failure cases:
 * - Throws TypeError when the supplied value is not a bigint.
 *
 * Side effects:
 * - Pure deterministic formatting; no I/O or state mutation.
 */
export function formatMicrocreditsToDecimal(microcredits: bigint): string {
  if (typeof microcredits !== "bigint") {
    throw new TypeError("Microcredits value must be a bigint");
  }
  if (microcredits === 0n) {
    return "0";
  }

  // Negate before division/modulo so values in (-1_000_000n, 0n) preserve the minus sign
  // even when the integer whole-credit component is 0n.
  const negative = microcredits < 0n;
  const abs = negative ? -microcredits : microcredits;
  const whole = abs / MICROCREDITS_PER_CREDIT;
  const remainder = abs % MICROCREDITS_PER_CREDIT;
  const sign = negative ? "-" : "";

  if (remainder === 0n) {
    return `${sign}${whole.toString()}`;
  }

  const fraction = remainder.toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${fraction}`;
}

/**
 * Business purpose: Parse a canonical base-10 decimal credit string into exact bigint microcredits.
 *
 * Business rules:
 * - Accept only canonical base-10 decimal strings with at most 6 fractional digits.
 * - Fail closed on whitespace, exponent notation, leading plus signs, trailing/leading bare dots, or >6 fractional digits.
 * - Preserve exact round-trip equivalence with formatMicrocreditsToDecimal for all signed amounts.
 *
 * Execution flow:
 * 1. Validate that the input is a string matching CANONICAL_MICROCREDIT_DECIMAL_PATTERN.
 * 2. Separate optional negative sign, whole digits, and fractional digits.
 * 3. Pad fractional digits to 6 places and combine with whole credits scaled by 1,000,000n.
 * 4. Normalize signed zero ("-0", "-0.0") to 0n and apply sign.
 *
 * Failure cases:
 * - Throws Error("Invalid canonical microcredit decimal string") when the input is non-string or violates canonical format.
 *
 * Side effects:
 * - Pure deterministic parsing; no I/O or state mutation.
 */
export function parseDecimalToMicrocredits(decimal: string): bigint {
  if (
    typeof decimal !== "string" ||
    !CANONICAL_MICROCREDIT_DECIMAL_PATTERN.test(decimal)
  ) {
    throw new Error("Invalid canonical microcredit decimal string");
  }

  const negative = decimal.startsWith("-");
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [wholePart, fractionalPart = ""] = unsigned.split(".");
  const absMicrocredits =
    BigInt(wholePart!) * MICROCREDITS_PER_CREDIT +
    BigInt(fractionalPart.padEnd(6, "0"));

  if (absMicrocredits === 0n) {
    return 0n;
  }

  return negative ? -absMicrocredits : absMicrocredits;
}

/**
 * Business purpose: Project a signed wallet ledger balance in microcredits into spendable and outstanding amounts.
 *
 * Business rules:
 * - Spendable balance equals max(ledgerBalanceMicrocredits, 0).
 * - Outstanding balance equals max(-ledgerBalanceMicrocredits, 0) so post-call overages remain transparent.
 * - Return exact base-10 integer microcredit strings for safe JSON serialization.
 *
 * Execution flow:
 * 1. Validate that ledgerBalanceMicrocredits is a bigint.
 * 2. Derive non-negative spendable and outstanding bigint projections.
 * 3. Serialize all three microcredit quantities as base-10 integer strings.
 *
 * Failure cases:
 * - Throws TypeError when ledgerBalanceMicrocredits is not a bigint.
 *
 * Side effects:
 * - Pure projection; does not modify wallet or ledger state.
 */
export function projectSignedWalletBalance(
  ledgerBalanceMicrocredits: bigint,
): SignedWalletBalanceProjection {
  if (typeof ledgerBalanceMicrocredits !== "bigint") {
    throw new TypeError("Ledger balance must be a bigint");
  }

  const spendable =
    ledgerBalanceMicrocredits > 0n ? ledgerBalanceMicrocredits : 0n;
  const outstanding =
    ledgerBalanceMicrocredits < 0n ? -ledgerBalanceMicrocredits : 0n;

  return {
    ledgerBalanceMicrocredits: ledgerBalanceMicrocredits.toString(),
    spendableMicrocredits: spendable.toString(),
    outstandingMicrocredits: outstanding.toString(),
  };
}

/**
 * Business purpose: Assert that a token count or microcredit rate field is a non-negative bigint.
 *
 * Business rules:
 * - Reject non-bigint values (including number, string, null) and negative bigints to prevent silent undercharge or float drift.
 *
 * Execution flow:
 * 1. Check runtime type is bigint.
 * 2. Verify value is greater than or equal to 0n.
 * 3. Return the validated bigint.
 *
 * Failure cases:
 * - Throws Error naming the invalid field when type is not bigint or value is negative.
 *
 * Side effects:
 * - Pure validation helper; no external mutation.
 */
function assertNonNegativeBigInt(fieldName: string, value: unknown): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error(`${fieldName} must be a non-negative bigint`);
  }
  return value;
}

/**
 * Business purpose: Validate that a provided token-bucket billing policy belongs to TOKEN_BUCKET_POLICIES.
 *
 * Business rules:
 * - Only canonical SCREAMING_SNAKE_CASE values in TOKEN_BUCKET_POLICIES are permitted.
 *
 * Execution flow:
 * 1. Verify the policy is a string included in Object.values(TOKEN_BUCKET_POLICIES).
 * 2. Return the narrowed TokenBucketPolicy value.
 *
 * Failure cases:
 * - Throws Error when the policy string is missing or unrecognized.
 *
 * Side effects:
 * - Pure validation helper; no external mutation.
 */
function assertValidTokenBucketPolicy(
  fieldName: string,
  policy: unknown,
): TokenBucketPolicy {
  if (
    typeof policy !== "string" ||
    !Object.values(TOKEN_BUCKET_POLICIES).includes(policy as TokenBucketPolicy)
  ) {
    throw new Error(`Invalid ${fieldName}: ${String(policy)}`);
  }
  return policy as TokenBucketPolicy;
}

/**
 * Business purpose: Compute the weighted cache-write numerator (in token-microcredits) without double-counting or silent zeroing.
 *
 * Business rules:
 * - Reject inconsistent aggregate cacheWriteTokens when split 5m/1h buckets are also supplied.
 * - Reject INCLUDED_IN_OUTPUT policy on input-side cache-write buckets.
 * - Fail closed when UNSUPPORTED policy sees non-zero cache-write tokens or when a required rate is missing.
 *
 * Execution flow:
 * 1. Check aggregate vs split cache-write bucket consistency when both are provided.
 * 2. Validate optional cacheWritePolicy and dispatch by policy (UNSUPPORTED, USE_OUTPUT_RATE, or SEPARATE_RATE/explicit).
 * 3. Multiply non-overlapping cache-write buckets by their corresponding per-million rate and return the numerator.
 *
 * Failure cases:
 * - Throws Error on inconsistent buckets, invalid policy, unsupported non-zero usage, or missing required rate.
 *
 * Side effects:
 * - Pure calculation helper; no external mutation.
 */
function resolveCacheWriteNumerator(
  usage: MicrocreditUsageBuckets,
  rates: MicrocreditTariffRates,
): bigint {
  const hasSplitBuckets =
    usage.cacheWrite5mTokens !== undefined ||
    usage.cacheWrite1hTokens !== undefined;
  const splitSum =
    (usage.cacheWrite5mTokens ?? 0n) + (usage.cacheWrite1hTokens ?? 0n);

  if (usage.cacheWriteTokens !== undefined && hasSplitBuckets) {
    if (usage.cacheWriteTokens !== splitSum) {
      throw new Error(
        "Inconsistent cacheWriteTokens: aggregate does not match cacheWrite5mTokens + cacheWrite1hTokens",
      );
    }
  }

  const effectiveTokens = hasSplitBuckets
    ? splitSum
    : (usage.cacheWriteTokens ?? 0n);

  const policy =
    rates.cacheWritePolicy !== undefined
      ? assertValidTokenBucketPolicy("cacheWritePolicy", rates.cacheWritePolicy)
      : undefined;

  if (policy === TOKEN_BUCKET_POLICIES.includedInOutput) {
    throw new Error(
      "INCLUDED_IN_OUTPUT policy is invalid for cacheWriteTokens",
    );
  }

  if (policy === TOKEN_BUCKET_POLICIES.unsupported) {
    if (effectiveTokens > 0n) {
      throw new Error("Cache-write tokens are unsupported by this tariff");
    }
    return 0n;
  }

  if (policy === TOKEN_BUCKET_POLICIES.useOutputRate) {
    return effectiveTokens * rates.output;
  }

  // SEPARATE_RATE (explicit or implicit when rate fields are supplied): fail closed on missing rates.
  if (
    policy === TOKEN_BUCKET_POLICIES.separateRate &&
    rates.cacheWrite === undefined &&
    rates.cacheWrite5m === undefined &&
    rates.cacheWrite1h === undefined
  ) {
    throw new Error("Missing cache-write rate for SEPARATE_RATE policy");
  }

  if (hasSplitBuckets) {
    const write5m = usage.cacheWrite5mTokens ?? 0n;
    const write1h = usage.cacheWrite1hTokens ?? 0n;
    let numerator = 0n;

    if (write5m > 0n) {
      if (rates.cacheWrite5m === undefined) {
        throw new Error("Missing cacheWrite5m rate for non-zero 5m usage");
      }
      numerator += write5m * rates.cacheWrite5m;
    }

    if (write1h > 0n) {
      if (rates.cacheWrite1h === undefined) {
        throw new Error("Missing cacheWrite1h rate for non-zero 1h usage");
      }
      numerator += write1h * rates.cacheWrite1h;
    }

    return numerator;
  }

  const aggregate = usage.cacheWriteTokens ?? 0n;
  if (aggregate > 0n && rates.cacheWrite === undefined) {
    throw new Error("Missing cacheWrite rate for non-zero cache-write usage");
  }

  return rates.cacheWrite !== undefined ? aggregate * rates.cacheWrite : 0n;
}

/**
 * Business purpose: Calculate exact integer microcredit charge from non-overlapping token buckets and per-million tariff rates.
 *
 * Business rules:
 * - Perform pure bigint sum-then-divide by 1,000,000n without per-bucket floating-point rounding or minimum charge floors.
 * - Reject negative token counts or negative rates.
 * - Fail closed on missing required rates, unsupported non-zero token buckets, or reasoningTokens exceeding outputTokens when INCLUDED_IN_OUTPUT.
 *
 * Execution flow:
 * 1. Validate usage buckets and tariff rates are non-negative bigints.
 * 2. Validate reasoningPolicy and compute reasoning numerator without double-counting INCLUDED_IN_OUTPUT tokens.
 * 3. Validate cached-input and cache-write policies and compute their numerators without silent zeroing.
 * 4. Sum input, output, reasoning, cached-input, and cache-write numerators and divide once by MICROCREDITS_PER_CREDIT.
 *
 * Failure cases:
 * - Throws Error when inputs are missing/negative, policies are invalid, required rates are omitted, or buckets are inconsistent.
 *
 * Side effects:
 * - Pure deterministic calculation; does not mutate inputs or access wallets.
 */
export function calculateMicrocreditCharge(
  input: CalculateMicrocreditChargeInput,
): bigint {
  if (!input || typeof input !== "object") {
    throw new Error("calculateMicrocreditCharge input must be an object");
  }

  const { usage, ratesMicrocreditsPerMillion: rates } = input;
  if (!usage || typeof usage !== "object") {
    throw new Error("usage must be an object");
  }
  if (!rates || typeof rates !== "object") {
    throw new Error("ratesMicrocreditsPerMillion must be an object");
  }

  const inputTokens = assertNonNegativeBigInt(
    "usage.inputTokens",
    usage.inputTokens,
  );
  const outputTokens = assertNonNegativeBigInt(
    "usage.outputTokens",
    usage.outputTokens,
  );

  if (usage.cachedInputTokens !== undefined) {
    assertNonNegativeBigInt("usage.cachedInputTokens", usage.cachedInputTokens);
  }
  if (usage.cacheWriteTokens !== undefined) {
    assertNonNegativeBigInt("usage.cacheWriteTokens", usage.cacheWriteTokens);
  }
  if (usage.cacheWrite5mTokens !== undefined) {
    assertNonNegativeBigInt(
      "usage.cacheWrite5mTokens",
      usage.cacheWrite5mTokens,
    );
  }
  if (usage.cacheWrite1hTokens !== undefined) {
    assertNonNegativeBigInt(
      "usage.cacheWrite1hTokens",
      usage.cacheWrite1hTokens,
    );
  }
  if (usage.reasoningTokens !== undefined) {
    assertNonNegativeBigInt("usage.reasoningTokens", usage.reasoningTokens);
  }

  const inputRate = assertNonNegativeBigInt("rates.input", rates.input);
  const outputRate = assertNonNegativeBigInt("rates.output", rates.output);
  if (rates.reasoning !== undefined) {
    assertNonNegativeBigInt("rates.reasoning", rates.reasoning);
  }
  if (rates.cachedInput !== undefined) {
    assertNonNegativeBigInt("rates.cachedInput", rates.cachedInput);
  }
  if (rates.cacheWrite !== undefined) {
    assertNonNegativeBigInt("rates.cacheWrite", rates.cacheWrite);
  }
  if (rates.cacheWrite5m !== undefined) {
    assertNonNegativeBigInt("rates.cacheWrite5m", rates.cacheWrite5m);
  }
  if (rates.cacheWrite1h !== undefined) {
    assertNonNegativeBigInt("rates.cacheWrite1h", rates.cacheWrite1h);
  }

  const reasoningPolicy = assertValidTokenBucketPolicy(
    "reasoningPolicy",
    rates.reasoningPolicy,
  );

  // Reasoning numerator: INCLUDED_IN_OUTPUT is already covered by outputTokens * outputRate.
  let reasoningNumerator = 0n;
  const reasoningTokens = usage.reasoningTokens ?? 0n;
  if (reasoningPolicy === TOKEN_BUCKET_POLICIES.separateRate) {
    if (rates.reasoning === undefined) {
      throw new Error("Missing reasoning rate for SEPARATE_RATE policy");
    }
    reasoningNumerator = reasoningTokens * rates.reasoning;
  } else if (reasoningPolicy === TOKEN_BUCKET_POLICIES.useOutputRate) {
    reasoningNumerator = reasoningTokens * outputRate;
  } else if (reasoningPolicy === TOKEN_BUCKET_POLICIES.includedInOutput) {
    if (
      usage.reasoningTokens !== undefined &&
      usage.reasoningTokens > outputTokens
    ) {
      throw new Error(
        "Inconsistent usage: reasoningTokens exceeds outputTokens under INCLUDED_IN_OUTPUT policy",
      );
    }
  } else if (reasoningPolicy === TOKEN_BUCKET_POLICIES.unsupported) {
    if (reasoningTokens > 0n) {
      throw new Error("Reasoning tokens are unsupported by this tariff");
    }
  }

  // Cached input numerator: never silently zero non-zero cachedInputTokens without an explicit rate/policy.
  const cachedInputPolicy =
    rates.cachedInputPolicy !== undefined
      ? assertValidTokenBucketPolicy(
          "cachedInputPolicy",
          rates.cachedInputPolicy,
        )
      : undefined;
  const cachedInputTokens = usage.cachedInputTokens ?? 0n;
  let cachedInputNumerator = 0n;

  if (cachedInputPolicy === TOKEN_BUCKET_POLICIES.includedInOutput) {
    throw new Error(
      "INCLUDED_IN_OUTPUT policy is invalid for cachedInputTokens",
    );
  } else if (cachedInputPolicy === TOKEN_BUCKET_POLICIES.unsupported) {
    if (cachedInputTokens > 0n) {
      throw new Error("Cached input tokens are unsupported by this tariff");
    }
  } else if (cachedInputPolicy === TOKEN_BUCKET_POLICIES.useOutputRate) {
    cachedInputNumerator = cachedInputTokens * outputRate;
  } else if (cachedInputPolicy === TOKEN_BUCKET_POLICIES.separateRate) {
    if (rates.cachedInput === undefined) {
      throw new Error("Missing cachedInput rate for SEPARATE_RATE policy");
    }
    cachedInputNumerator = cachedInputTokens * rates.cachedInput;
  } else if (cachedInputTokens > 0n) {
    if (rates.cachedInput === undefined) {
      throw new Error(
        "Missing cachedInput rate for non-zero cachedInputTokens",
      );
    }
    cachedInputNumerator = cachedInputTokens * rates.cachedInput;
  }

  const cacheWriteNumerator = resolveCacheWriteNumerator(usage, rates);

  // Sum all weighted buckets before a single BigInt division so sub-microcredit precision
  // is preserved across buckets and never rounded per bucket.
  const totalNumerator =
    inputTokens * inputRate +
    outputTokens * outputRate +
    reasoningNumerator +
    cachedInputNumerator +
    cacheWriteNumerator;

  return totalNumerator / MICROCREDITS_PER_CREDIT;
}

/**
 * Business purpose: Resolve the effective direct-credit pricing scope for a runtime-allowlisted model.
 *
 * Business rules:
 * - Fail closed if resolvedModel is not in allowlistedModels, even when GLOBAL_DEFAULT exists.
 * - Reject empty or untrimmed resolvedModel/provider identifiers and unknown scope values.
 * - Select strictly in precedence order: EXACT_MODEL -> PROVIDER_DEFAULT -> GLOBAL_DEFAULT.
 *
 * Execution flow:
 * 1. Validate resolvedModel and provider are non-empty trimmed strings.
 * 2. Verify resolvedModel is present in allowlistedModels.
 * 3. Validate all entries in availableScopes against MODEL_PRICING_SCOPES.
 * 4. Return the highest-precedence matching scope or throw if none is available.
 *
 * Failure cases:
 * - Throws Error if model/provider is invalid, model is not allowlisted, an unknown scope is supplied, or no scope matches.
 *
 * Side effects:
 * - Pure deterministic resolution; no database queries or side effects.
 */
export function resolveEffectivePricingScope(
  input: ResolveEffectivePricingScopeInput,
): EffectivePricingScopeResolution {
  if (!input || typeof input !== "object") {
    throw new Error("resolveEffectivePricingScope input must be an object");
  }

  const { resolvedModel, provider, allowlistedModels, availableScopes } = input;
  if (
    typeof resolvedModel !== "string" ||
    resolvedModel.length === 0 ||
    resolvedModel.trim() !== resolvedModel
  ) {
    throw new Error("resolvedModel must be a non-empty trimmed string");
  }
  if (
    typeof provider !== "string" ||
    provider.length === 0 ||
    provider.trim() !== provider
  ) {
    throw new Error("provider must be a non-empty trimmed string");
  }
  if (!Array.isArray(allowlistedModels)) {
    throw new Error("allowlistedModels must be an array");
  }
  if (!allowlistedModels.includes(resolvedModel)) {
    throw new Error(
      `Resolved model "${resolvedModel}" is not in runtime allowlist`,
    );
  }
  if (!Array.isArray(availableScopes)) {
    throw new Error("availableScopes must be an array");
  }

  const validScopes = new Set<string>(Object.values(MODEL_PRICING_SCOPES));
  for (const scope of availableScopes) {
    if (typeof scope !== "string" || !validScopes.has(scope)) {
      throw new Error(`Unknown pricing scope: ${String(scope)}`);
    }
  }

  const precedence: readonly ModelPricingScope[] = [
    MODEL_PRICING_SCOPES.exactModel,
    MODEL_PRICING_SCOPES.providerDefault,
    MODEL_PRICING_SCOPES.globalDefault,
  ];

  for (const candidate of precedence) {
    if (availableScopes.includes(candidate)) {
      return { scope: candidate };
    }
  }

  throw new Error(
    `No effective pricing scope available for allowlisted model "${resolvedModel}"`,
  );
}

/**
 * Business purpose: Compute the canonical normalized scope key used by tariff drafts, immutable snapshots, assignments, and PostgreSQL overlap constraints.
 *
 * Business rules:
 * - Only scopes in MODEL_PRICING_SCOPES (`GLOBAL_DEFAULT`, `PROVIDER_DEFAULT`, `EXACT_MODEL`) are accepted.
 * - `GLOBAL_DEFAULT` requires both `provider` and `resolvedModel` to be null/undefined/blank and returns `"GLOBAL_DEFAULT"`.
 * - `PROVIDER_DEFAULT` requires a non-empty trimmed `provider` without `":"` and empty `resolvedModel`, lowercasing `provider`.
 * - `EXACT_MODEL` requires non-empty trimmed `provider` (without `":"`) and non-empty trimmed `resolvedModel`, lowercasing `provider` while preserving `resolvedModel` case.
 *
 * Execution flow:
 * 1. Verify `scope` belongs to `MODEL_PRICING_SCOPES` and that supplied `provider` / `resolvedModel` are strings or nullish.
 * 2. Trim `provider` and `resolvedModel`, treating whitespace-only strings as empty.
 * 3. Enforce per-scope cardinality and delimiter invariants, then return the canonical normalized key.
 *
 * Failure cases:
 * - Throws Error if `scope` is unknown, if `provider` or `resolvedModel` is a non-string non-nullish value, if `provider` contains `":"`, or if `provider`/`resolvedModel` presence violates the scope rule.
 *
 * Side effects:
 * - None: pure deterministic normalization matching PostgreSQL `scope_identity_check` and `btree_gist` `EXCLUDE` partitioning.
 */
export function normalizeModelPricingScopeKey(
  scope: ModelPricingScope,
  provider?: string | null,
  resolvedModel?: string | null,
): string {
  // Why: Both PostgreSQL `CustomerModelTariff*_scope_identity_check` and `CustomerModelTariffAssignment_no_overlap`
  // partition tariff authority by `normalizedScopeKey`; any divergence between API, Web, and DB would allow
  // duplicate or conflicting tariffs for the same model/provider.
  // How: Validate scope membership, reject non-string inputs, trim whitespace, lowercase provider, preserve
  // resolvedModel casing, and forbid `:` inside provider so delimiter splitting is unambiguous.
  // Invariants: Output strictly matches `<SCOPE>` or `<SCOPE>:<lowercase_provider>[:<case_preserved_model>]`.
  const validScopes = new Set<string>(Object.values(MODEL_PRICING_SCOPES));
  if (typeof scope !== "string" || !validScopes.has(scope)) {
    throw new Error(`Unknown pricing scope: ${String(scope)}`);
  }

  if (
    provider !== undefined &&
    provider !== null &&
    typeof provider !== "string"
  ) {
    throw new Error("provider must be a string, null, or undefined");
  }
  if (
    resolvedModel !== undefined &&
    resolvedModel !== null &&
    typeof resolvedModel !== "string"
  ) {
    throw new Error("resolvedModel must be a string, null, or undefined");
  }

  const trimmedProvider = provider?.trim() ?? "";
  const trimmedModel = resolvedModel?.trim() ?? "";

  if (scope === MODEL_PRICING_SCOPES.globalDefault) {
    if (trimmedProvider.length > 0 || trimmedModel.length > 0) {
      throw new Error(
        "GLOBAL_DEFAULT scope must not specify provider or resolvedModel",
      );
    }
    return MODEL_PRICING_SCOPES.globalDefault;
  }

  if (trimmedProvider.length === 0) {
    throw new Error(`${scope} scope requires a non-empty provider`);
  }
  if (trimmedProvider.includes(":")) {
    throw new Error("provider must not contain ':' delimiter");
  }

  const normalizedProvider = trimmedProvider.toLowerCase();

  if (scope === MODEL_PRICING_SCOPES.providerDefault) {
    if (trimmedModel.length > 0) {
      throw new Error(
        "PROVIDER_DEFAULT scope must not specify resolvedModel",
      );
    }
    return `${MODEL_PRICING_SCOPES.providerDefault}:${normalizedProvider}`;
  }

  if (trimmedModel.length === 0) {
    throw new Error("EXACT_MODEL scope requires a non-empty resolvedModel");
  }

  return `${MODEL_PRICING_SCOPES.exactModel}:${normalizedProvider}:${trimmedModel}`;
}
