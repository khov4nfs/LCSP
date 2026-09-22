import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { ModelPricingSnapshot } from "@prisma/client";

const CUSTOMER_CURRENCY = "VND";
const PRICE_PATTERN = /^\d+(\.\d{1,8})?$/;
const WHOLE_NUMBER_PATTERN = /^\d+$/;

const REQUIRED_TEXT_KEYS = [
  "provider",
  "model",
  "effectiveAt",
  "inputPricePerMillion",
  "outputPricePerMillion",
  "providerCurrency",
  "customerCurrency",
  "markupBps",
] as const;

const OPTIONAL_PRICE_KEYS = [
  "cachedInputPricePerMillion",
  "cacheWritePricePerMillion",
  "reasoningPricePerMillion",
] as const;

type OptionalPriceKey = (typeof OPTIONAL_PRICE_KEYS)[number];

type PricingInput = {
  provider: string;
  model: string;
  version: number;
  effectiveAt: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  providerCurrency: string;
  customerCurrency: string;
  markupBps: string;
  fxRateVndNumerator?: string;
  fxRateVndDenominator?: string;
} & Partial<Record<OptionalPriceKey, string>>;

/**
 * Validates and normalizes the configured pricing snapshots.
 *
 * Every rule enforced here is a rule the billing domain would otherwise only
 * discover when credits are reserved or usage is settled, so an unusable
 * snapshot fails during provisioning instead of failing a customer run.
 *
 * @param value - Parsed `LCSP_MODEL_PRICING_SNAPSHOTS` configuration.
 * @returns Validated snapshots with canonical provider casing.
 */
function pricingInputs(value: unknown): PricingInput[] {
  if (!Array.isArray(value))
    throw new Error("Pricing configuration must be an array");
  return value.map((item) => {
    if (typeof item !== "object" || item === null)
      throw new Error("Invalid model pricing configuration");
    const candidate = item as Record<string, unknown>;
    if (
      !REQUIRED_TEXT_KEYS.every((key) => typeof candidate[key] === "string") ||
      typeof candidate.version !== "number" ||
      !Number.isSafeInteger(candidate.version) ||
      candidate.version < 1
    )
      throw new Error("Invalid model pricing configuration");
    const pricing = candidate as PricingInput;
    const provider = pricing.provider.trim().toUpperCase();
    const model = pricing.model.trim();
    if (!provider || !model)
      throw new Error("Pricing provider and model are required");
    if (Number.isNaN(new Date(pricing.effectiveAt).getTime()))
      throw new Error(
        `Pricing ${provider}/${model} has an invalid effectiveAt`,
      );
    for (const key of [
      "inputPricePerMillion",
      "outputPricePerMillion",
      ...OPTIONAL_PRICE_KEYS,
    ] as const) {
      const price = pricing[key];
      if (price === undefined) continue;
      if (typeof price !== "string" || !PRICE_PATTERN.test(price.trim()))
        throw new Error(`Pricing ${provider}/${model} has an invalid ${key}`);
    }
    if (!WHOLE_NUMBER_PATTERN.test(pricing.markupBps.trim()))
      throw new Error(`Pricing ${provider}/${model} has an invalid markupBps`);
    // Wallet settlement charges in VND, so a snapshot that cannot be converted
    // is unusable no matter how well formed its provider prices are.
    if (pricing.customerCurrency.trim().toUpperCase() !== CUSTOMER_CURRENCY)
      throw new Error(
        `Pricing ${provider}/${model} must settle in ${CUSTOMER_CURRENCY}`,
      );
    const foreignProvider =
      pricing.providerCurrency.trim().toUpperCase() !== CUSTOMER_CURRENCY;
    const hasNumerator = pricing.fxRateVndNumerator !== undefined;
    const hasDenominator = pricing.fxRateVndDenominator !== undefined;
    if (foreignProvider && !(hasNumerator && hasDenominator))
      throw new Error(
        `Pricing ${provider}/${model} requires a provider-to-${CUSTOMER_CURRENCY} FX rate`,
      );
    if (hasNumerator !== hasDenominator)
      throw new Error(`Pricing ${provider}/${model} has a partial FX rate`);
    for (const key of ["fxRateVndNumerator", "fxRateVndDenominator"] as const) {
      const rate = pricing[key];
      if (rate === undefined) continue;
      if (
        typeof rate !== "string" ||
        !WHOLE_NUMBER_PATTERN.test(rate.trim()) ||
        BigInt(rate.trim()) <= 0n
      )
        throw new Error(`Pricing ${provider}/${model} has an invalid ${key}`);
    }
    return {
      ...pricing,
      provider,
      model,
      providerCurrency: pricing.providerCurrency.trim().toUpperCase(),
      customerCurrency: CUSTOMER_CURRENCY,
    };
  });
}

/**
 * Builds the persistence payload for one validated pricing snapshot.
 *
 * @param pricing - Validated snapshot configuration.
 * @returns Prisma create data for the snapshot row.
 */
function snapshotData(pricing: PricingInput) {
  return {
    provider: pricing.provider,
    model: pricing.model,
    version: pricing.version,
    effectiveAt: new Date(pricing.effectiveAt),
    inputPricePerMillion: pricing.inputPricePerMillion.trim(),
    cachedInputPricePerMillion:
      pricing.cachedInputPricePerMillion?.trim() ?? null,
    cacheWritePricePerMillion:
      pricing.cacheWritePricePerMillion?.trim() ?? null,
    outputPricePerMillion: pricing.outputPricePerMillion.trim(),
    reasoningPricePerMillion: pricing.reasoningPricePerMillion?.trim() ?? null,
    providerCurrency: pricing.providerCurrency,
    customerCurrency: pricing.customerCurrency,
    markupBps: BigInt(pricing.markupBps.trim()),
    fxRateVndNumerator:
      pricing.fxRateVndNumerator === undefined
        ? null
        : BigInt(pricing.fxRateVndNumerator.trim()),
    fxRateVndDenominator:
      pricing.fxRateVndDenominator === undefined
        ? null
        : BigInt(pricing.fxRateVndDenominator.trim()),
  };
}

/**
 * Reports whether a stored snapshot already carries the configured values.
 *
 * Snapshot rows are append-only, so a divergent row can only be replaced by a
 * new version and is reported instead of being rewritten.
 *
 * @param existing - Snapshot row already present in the database.
 * @param expected - Snapshot payload built from configuration.
 * @returns True when the stored row matches the configured snapshot.
 */
function matchesExisting(
  existing: ModelPricingSnapshot,
  expected: ReturnType<typeof snapshotData>,
): boolean {
  // Postgres returns the stored decimal without the configured trailing zeros,
  // so scale differences must not read as a changed price.
  const decimal = (value: { toString(): string } | string | null) => {
    if (value === null) return null;
    const text = value.toString();
    return text.includes(".")
      ? text.replace(/0+$/, "").replace(/\.$/, "")
      : text;
  };
  const scalar = (value: string | bigint | null) =>
    value === null ? null : value.toString();
  return (
    decimal(existing.inputPricePerMillion) ===
      decimal(expected.inputPricePerMillion) &&
    decimal(existing.cachedInputPricePerMillion) ===
      decimal(expected.cachedInputPricePerMillion) &&
    decimal(existing.cacheWritePricePerMillion) ===
      decimal(expected.cacheWritePricePerMillion) &&
    decimal(existing.outputPricePerMillion) ===
      decimal(expected.outputPricePerMillion) &&
    decimal(existing.reasoningPricePerMillion) ===
      decimal(expected.reasoningPricePerMillion) &&
    scalar(existing.providerCurrency) === scalar(expected.providerCurrency) &&
    scalar(existing.customerCurrency) === scalar(expected.customerCurrency) &&
    scalar(existing.markupBps) === scalar(expected.markupBps) &&
    scalar(existing.fxRateVndNumerator) ===
      scalar(expected.fxRateVndNumerator) &&
    scalar(existing.fxRateVndDenominator) ===
      scalar(expected.fxRateVndDenominator) &&
    existing.effectiveAt.getTime() === expected.effectiveAt.getTime()
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const configured = process.env.LCSP_MODEL_PRICING_SNAPSHOTS;
  if (!connectionString || !configured)
    throw new Error(
      "DATABASE_URL and LCSP_MODEL_PRICING_SNAPSHOTS are required",
    );
  const snapshots = pricingInputs(JSON.parse(configured));
  const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });
  try {
    for (const pricing of snapshots) {
      const data = snapshotData(pricing);
      const existing = await prisma.modelPricingSnapshot.findUnique({
        where: {
          provider_model_version: {
            provider: pricing.provider,
            model: pricing.model,
            version: pricing.version,
          },
        },
      });
      if (existing) {
        if (!matchesExisting(existing, data))
          throw new Error(
            `Model pricing ${pricing.provider}/${pricing.model} v${pricing.version} is immutable`,
          );
        continue;
      }
      await prisma.modelPricingSnapshot.create({ data });
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
