import {
  REFERENCE_COST_BASIS,
  REFERENCE_COST_CURRENCY,
  REFERENCE_PRICE_SCOPE,
  REFERENCE_COST_STATUSES,
  USAGE_TOKEN_FIELDS,
  type ReferenceCostSnapshot,
  type UsageTokenField,
} from "./usage-analytics.ts";

export type ReferenceUsage = Partial<
  Record<UsageTokenField, bigint | string | null>
>;
type Rates = {
  input: string;
  cached: string;
  output: string;
  write5m?: string;
  write1h?: string;
  write30m?: string;
  write12h?: string;
};
export type OfficialReferencePrice = {
  version: string;
  developer: string;
  model: string;
  providers: readonly string[];
  aliases: readonly string[];
  currency: typeof REFERENCE_COST_CURRENCY;
  sourceUrl: string;
  evidenceSha256: string;
  effectiveDate: string | null;
  recordedAt: string;
  verifiedAt: string;
  applicableFrom: string;
  reasoningTreatment: string;
  rates: Rates;
  longContextRates?: Rates;
  aliasEvidence?: { sourceUrl: string; sha256: string };
  additionalCategories?: Readonly<Record<string, string>>;
};
const CAPTURE = "2026-10-22T14:58:04.000Z";
const sources = {
  ANTHROPIC: [
    "https://platform.claude.com/docs/en/about-claude/pricing",
    "9ccc8bef1e83c33ceaf8fa768490d5f876a41b94b8e822c4a81c7ed8085829d0",
  ],
  GOOGLE: [
    "https://ai.google.dev/gemini-api/docs/pricing?hl=en",
    "c075712e0ac851a9845b09989dcf6de29a647004e64b013fd083bff768bf8cff",
  ],
  INCEPTION: [
    "https://docs.inceptionlabs.ai/get-started/models.md",
    "6f3d6e8bad6809b2e70a44b48704e4936af12d6f48238881272c9996c6758ad3",
  ],
  OPENAI: [
    "https://developers.openai.com/api/docs/pricing.md",
    "129d6019819379a6f30edc0811d4631ddb085dcd4b3b1d0012a945cd1af1bfbf",
  ],
} as const;
/**
 * Business purpose: Build one versioned official-reference price entry with captured source provenance.
 *
 * Business rules:
 * - Use the developer's captured source URL/hash and standard reference currency/output-reasoning treatment; explicit extra metadata may override defaults.
 *
 * Execution flow:
 * 1. Combine developer/model/provider aliases, capture metadata and category rates.
 * 2. Apply the supplied entry-specific overrides and return the registry entry.
 *
 * Failure cases:
 * - Invalid developer registry lookup propagates; this constructor does not verify current provider account charges.
 *
 * Side effects:
 * - Pure registry construction; no billing, model request or external price fetch.
 */
function price(
  developer: keyof typeof sources,
  model: string,
  providers: string[],
  rates: Rates,
  aliases: string[] = [],
  extra: Partial<OfficialReferencePrice> = {},
): OfficialReferencePrice {
  return {
    version: `${developer.toLowerCase()}:${model}:standard:2026-10-22`,
    developer,
    model,
    providers,
    aliases,
    currency: REFERENCE_COST_CURRENCY,
    sourceUrl: sources[developer][0],
    evidenceSha256: sources[developer][1],
    effectiveDate: null,
    recordedAt: CAPTURE,
    verifiedAt: CAPTURE,
    applicableFrom: CAPTURE,
    reasoningTreatment: "INCLUDED_IN_OUTPUT",
    rates,
    ...extra,
  };
}
/** Immutable capture versions. Append a new version on price changes; never edit a stored invocation snapshot. */
export const OFFICIAL_REFERENCE_PRICES: readonly OfficialReferencePrice[] = [
  price("ANTHROPIC", "claude-sonnet-5", ["ANTHROPIC", "MIRAIAPI"], {
    input: "2",
    cached: "0.20",
    output: "10",
    write5m: "2.50",
    write1h: "4",
  }),
  price(
    "ANTHROPIC",
    "claude-sonnet-4-6",
    ["ANTHROPIC", "APX"],
    { input: "3", cached: "0.30", output: "15", write5m: "3.75", write1h: "6" },
    ["claude-sonnet-4-6-free"],
    {
      aliasEvidence: {
        sourceUrl: "https://apmix.ai/models/claude-sonnet-4-6-free",
        sha256:
          "4e063c634a755d99444b875f2d823cee1dbb5e389467af43696662126682721f",
      },
    },
  ),
  price(
    "GOOGLE",
    "gemini-3.5-flash-lite",
    ["GOOGLE_GENAI"],
    { input: "0.30", cached: "0.03", output: "2.50" },
    [],
    { additionalCategories: { cacheStorageUsdPerMillionTokenHour: "1" } },
  ),
  price("INCEPTION", "mercury-2.5", ["INCEPTION"], {
    input: "0.20",
    cached: "0.02",
    output: "0.75",
  }),
  price(
    "INCEPTION",
    "mercury-3",
    ["INCEPTION"],
    { input: "0.10", cached: "0.01", output: "0.35" },
    [],
    {
      version: "inception:mercury-3:launch:2026-10-29",
      sourceUrl: "https://www.inceptionlabs.ai/models",
      evidenceSha256:
        "4376daa672a532eb1ed4617e8989b54250fb572f5feae4bafdd7f1e7fc7638f6",
      // Observed launch promotion; do not infer its start/end or retroactively price older calls.
      recordedAt: "2026-10-29T06:03:04.588Z",
      verifiedAt: "2026-10-29T06:03:04.588Z",
      applicableFrom: "2026-10-29T06:03:04.588Z",
    },
  ),
  price(
    "OPENAI",
    "gpt-6-astra",
    ["OPENAI"],
    {
      input: "10",
      cached: "1",
      output: "50",
      write30m: "12.50",
      write12h: "25",
    },
    [],
    {
      longContextRates: {
        input: "20",
        cached: "2",
        output: "75",
        write30m: "25",
        write12h: "50",
      },
    },
  ),
  price(
    "OPENAI",
    "gpt-6.1-sol",
    ["OPENAI"],
    {
      input: "2",
      cached: "0.10",
      output: "10",
      write30m: "2.50",
      write12h: "5",
    },
    [],
    {
      longContextRates: {
        input: "4",
        cached: "0.20",
        output: "15",
        write30m: "5",
        write12h: "10",
      },
    },
  ),
  price(
    "OPENAI",
    "gpt-6-luna",
    ["OPENAI"],
    {
      input: "0.10",
      cached: "0.01",
      output: "0.50",
      write30m: "0.125",
      write12h: "0.25",
    },
    [],
    {
      longContextRates: {
        input: "0.20",
        cached: "0.02",
        output: "0.75",
        write30m: "0.25",
        write12h: "0.50",
      },
    },
  ),
  price("OPENAI", "gpt-4o", ["OPENAI"], {
    input: "2.50",
    cached: "1.25",
    output: "10",
  }),
  price("OPENAI", "gpt-4o-mini", ["OPENAI"], {
    input: "0.15",
    cached: "0.075",
    output: "0.60",
  }),
];

/** Exact decimal USD; one attodollar is 10^-18 USD. No binary floating-point accumulation. */
/**
 * Business purpose: Display a nonnegative reference-cost total in USD without floating-point loss.
 *
 * Business rules:
 * - The caller supplies integer attodollars; retain eighteen decimal places of precision and trim only trailing fractional zeroes.
 *
 * Execution flow:
 * 1. Split the padded integer into whole USD and fractional attodollars.
 * 2. Return the exact decimal representation without unnecessary fractional zeroes.
 *
 * Failure cases:
 * - Negative/untyped values are outside this formatter's caller contract; it performs no tariff or usage validation.
 *
 * Side effects:
 * - Pure decimal formatting; no financial settlement.
 */
export function attodollarsToUsd(value: bigint): string {
  const digits = value.toString().padStart(19, "0");
  let fractionEnd = digits.length;
  while (fractionEnd > digits.length - 18 && digits[fractionEnd - 1] === "0")
    fractionEnd--;
  const whole = digits.slice(0, -18),
    fraction = digits.slice(-18, fractionEnd);
  return fraction ? `${whole}.${fraction}` : whole;
}
/**
 * Business purpose: Convert a decimal USD-per-million reference rate into exact integer attodollars per token.
 *
 * Business rules:
 * - Accept nonnegative decimal strings with at most twelve fractional digits; avoid binary floating-point arithmetic.
 *
 * Execution flow:
 * 1. Validate the rate precision.
 * 2. Pad its decimal fraction and return the exact integer per-token rate.
 *
 * Failure cases:
 * - Malformed or excessive-precision rates throw Invalid reference price precision rather than round silently.
 *
 * Side effects:
 * - Pure tariff-unit conversion; no usage or ledger mutation.
 */
function ratePerToken(ratePerMillion: string): bigint {
  if (!/^\d+(\.\d{1,12})?$/.test(ratePerMillion))
    throw new Error("Invalid reference price precision");
  const [whole, fraction = ""] = ratePerMillion.split(".");
  return BigInt(whole! + fraction.padEnd(12, "0"));
}
/**
 * Business purpose: Produce a qualified official-reference usage estimate with source provenance and explicit missing categories.
 *
 * Business rules:
 * - Choose the latest eligible captured price for provider/model/alias and occurrence time; reference estimates are not actual provider invoices.
 * - Require consistent usage buckets and any applicable context tier; reasoning is already included in output and is not charged a second time.
 *
 * Execution flow:
 * 1. Resolve the eligible registry entry and validate available counts.
 * 2. Select context-tier rates and accumulate only known priced categories.
 * 3. Return UNPRICED, UNKNOWN, PARTIAL or COMPLETE with provenance and an estimate only for COMPLETE.
 *
 * Failure cases:
 * - Invalid numeric counts/rate precision throw; missing prices, context tier or inconsistent/absent buckets retain qualified status and missing categories instead of fabricated full cost.
 *
 * Side effects:
 * - Pure reference calculation; no admission, charge collection or durable settlement.
 */
export function estimateOfficialReferenceCost(
  provider: string,
  model: string,
  occurredAt: Date,
  usage: ReferenceUsage,
  registry = OFFICIAL_REFERENCE_PRICES,
): ReferenceCostSnapshot {
  const entry = registry
    .filter(
      (x) =>
        x.providers.includes(provider.toUpperCase()) &&
        (x.model === model || x.aliases.includes(model)) &&
        Date.parse(x.applicableFrom) <= occurredAt.getTime(),
    )
    .sort((a, b) => b.applicableFrom.localeCompare(a.applicableFrom))[0];
  const base = {
    basis: REFERENCE_COST_BASIS,
    currency: REFERENCE_COST_CURRENCY,
    scope: REFERENCE_PRICE_SCOPE,
    priceVersionId: entry?.version ?? null,
    developer: entry?.developer ?? null,
    canonicalModel: entry?.model ?? null,
    sourceUrl: entry?.sourceUrl ?? null,
    evidenceSha256: entry?.evidenceSha256 ?? null,
  } as const;
  /**
   * Business purpose: Read a provider-reported token bucket without turning absent usage into zero.
   *
   * Business rules:
   * - Null/undefined means unknown; supplied counts must contain only decimal digits before conversion to bigint.
   *
   * Execution flow:
   * 1. Inspect the requested usage field.
   * 2. Return null when absent or validate and convert its exact count.
   *
   * Failure cases:
   * - Malformed, negative or nondigit counts throw Invalid provider token count.
   *
   * Side effects:
   * - Pure usage projection; no aggregation or persistence.
   */
  const count = (field: UsageTokenField) => {
    const value = usage[field];
    if (value === null || value === undefined) return null;
    if (!/^\d+$/.test(String(value)))
      throw new Error("Invalid provider token count");
    return BigInt(value);
  };
  const allMissing = USAGE_TOKEN_FIELDS.every(
    (k) => usage[k] === null || usage[k] === undefined,
  );
  let rates: Rates | undefined = entry?.rates;
  const missing: string[] = [];
  if (entry?.longContextRates) {
    const context = count("inputTokensIncludingCache");
    if (context === null) {
      rates = undefined;
      missing.push("CONTEXT_TIER");
    } else if (context > 272000n) rates = entry.longContextRates;
  }
  let cost = 0n;
  /**
   * Business purpose: Accumulate one known reference-cost category while retaining incomplete-pricing diagnostics.
   *
   * Business rules:
   * - Missing counts are unknown; nonzero usage needs a rate, while measured zero requires no rate.
   *
   * Execution flow:
   * 1. Read the category count.
   * 2. Record missing usage/rate or add its exact token-count times per-token price.
   *
   * Failure cases:
   * - Invalid count or rate precision propagates; incomplete categories do not become a complete estimate.
   *
   * Side effects:
   * - Updates only the enclosing calculation's cost and missing-category buffers.
   */
  const add = (field: UsageTokenField, rate: string | undefined) => {
    const n = count(field);
    if (n === null) missing.push(field);
    else if (n !== 0n && rate === undefined) missing.push(field);
    else if (rate !== undefined) cost += n * ratePerToken(rate);
  };
  if (
    count("reasoningTokens") !== null &&
    count("outputTokens") !== null &&
    count("reasoningTokens")! > count("outputTokens")!
  )
    missing.push("INCONSISTENT_REASONING_BUCKET");
  if (
    count("inputTokensIncludingCache") !== null &&
    ["inputTokens", "cachedInputTokens", "cacheWriteTokens"].every(
      (k) => usage[k as UsageTokenField] != null,
    ) &&
    count("inputTokens")! +
      count("cachedInputTokens")! +
      count("cacheWriteTokens")! !==
      count("inputTokensIncludingCache")
  )
    missing.push("INCONSISTENT_INPUT_BUCKETS");
  if (rates) {
    add("inputTokens", rates.input);
    add("cachedInputTokens", rates.cached);
    add("outputTokens", rates.output);
    const writes = count("cacheWriteTokens");
    if (writes === 0n) {
      /* A measured zero needs no TTL selection. */
    } else if (
      writes === null &&
      !rates.write5m &&
      !rates.write1h &&
      !rates.write30m &&
      !rates.write12h
    ) {
      /* No token cache-write price category for this model. */
    } else if (
      writes !== null &&
      count("cacheWrite5mTokens") !== null &&
      count("cacheWrite1hTokens") !== null &&
      count("cacheWrite5mTokens")! + count("cacheWrite1hTokens")! === writes
    ) {
      add("cacheWrite5mTokens", rates.write5m);
      add("cacheWrite1hTokens", rates.write1h);
    } else missing.push("cacheWriteTokens");
  }
  const status =
    !entry || !rates
      ? REFERENCE_COST_STATUSES.UNPRICED
      : allMissing
        ? REFERENCE_COST_STATUSES.UNKNOWN
        : missing.length
          ? REFERENCE_COST_STATUSES.PARTIAL
          : REFERENCE_COST_STATUSES.COMPLETE;
  const knownCostUsd = attodollarsToUsd(cost);
  return {
    ...base,
    status,
    knownCostAttodollars: cost.toString(),
    knownCostUsd,
    estimatedCostUsd:
      status === REFERENCE_COST_STATUSES.COMPLETE ? knownCostUsd : null,
    missingCategories: entry ? missing : ["MODEL_PRICE"],
    ratesPerMillion: rates
      ? {
          input: rates.input,
          cached: rates.cached,
          output: rates.output,
          cacheWrite5m: rates.write5m ?? null,
          cacheWrite1h: rates.write1h ?? null,
          cacheWrite30m: rates.write30m ?? null,
          cacheWrite12h: rates.write12h ?? null,
        }
      : null,
  };
}
