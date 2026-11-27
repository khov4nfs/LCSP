import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MODEL_PRICING_SCOPES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import {
  ModelPricingIncompleteRatesError,
  ModelPricingNoCoverageError,
  ModelPricingUnlistedModelError,
} from "../../domain/billing.errors.js";
import type { BillingTransactionPort } from "../../domain/repositories/billing-transaction.port.js";
import { BillingUsageKernel } from "./billing-usage.kernel.js";
import { ModelPricingCalculatorService } from "./model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "./runtime-model-allowlist.service.js";

function createServiceWithAllowlist(
  entries = [
    {
      routeId: "anthropic-primary",
      provider: "anthropic",
      protocol: "anthropic",
      model: "claude-sonnet-4-6",
    },
    {
      routeId: "google-primary",
      provider: "google",
      protocol: "google_genai",
      model: "gemini-2.5-pro",
    },
  ],
) {
  const allowlist = new RuntimeModelAllowlistService(undefined, { entries });
  return new ModelPricingCalculatorService(allowlist);
}

describe("ModelPricingCalculatorService", () => {
  it("enforces runtime allowlist gating before scope resolution even when GLOBAL_DEFAULT exists", () => {
    const calculator = createServiceWithAllowlist();

    expect(() =>
      calculator.resolveEffectiveTariff({
        provider: "anthropic",
        resolvedModel: "unlisted-model-v9",
        candidates: [
          {
            scope: MODEL_PRICING_SCOPES.globalDefault,
            normalizedScopeKey: "GLOBAL_DEFAULT",
            snapshotId: "snap-global",
            assignmentId: "assign-global",
            version: 1,
            ratesMicrocreditsPerMillion: {
              input: 1_000_000n,
              output: 2_000_000n,
              reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
            },
          },
        ],
      }),
    ).toThrow(ModelPricingUnlistedModelError);
  });

  it("resolves precedence strictly EXACT_MODEL -> PROVIDER_DEFAULT -> GLOBAL_DEFAULT and ignores other providers", () => {
    const calculator = createServiceWithAllowlist();

    const globalCandidate = {
      scope: MODEL_PRICING_SCOPES.globalDefault,
      normalizedScopeKey: "GLOBAL_DEFAULT",
      snapshotId: "snap-global",
      assignmentId: "assign-global",
      version: 1,
      ratesMicrocreditsPerMillion: {
        input: 5_000_000n,
        output: 20_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      },
    };
    const otherProviderCandidate = {
      scope: MODEL_PRICING_SCOPES.providerDefault,
      normalizedScopeKey: "PROVIDER_DEFAULT:google",
      snapshotId: "snap-google-default",
      assignmentId: "assign-google-default",
      version: 1,
      ratesMicrocreditsPerMillion: {
        input: 4_000_000n,
        output: 18_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      },
    };
    const anthropicProviderCandidate = {
      scope: MODEL_PRICING_SCOPES.providerDefault,
      normalizedScopeKey: "PROVIDER_DEFAULT:anthropic",
      snapshotId: "snap-anthropic-default",
      assignmentId: "assign-anthropic-default",
      version: 2,
      ratesMicrocreditsPerMillion: {
        input: 3_500_000n,
        output: 16_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      },
    };
    const exactCandidate = {
      scope: MODEL_PRICING_SCOPES.exactModel,
      normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
      snapshotId: "snap-exact",
      assignmentId: "assign-exact",
      version: 3,
      ratesMicrocreditsPerMillion: {
        input: 3_000_000n,
        output: 15_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      },
    };

    expect(
      calculator.resolveEffectiveTariff({
        provider: "ANTHROPIC",
        resolvedModel: "claude-sonnet-4-6",
        candidates: [
          globalCandidate,
          otherProviderCandidate,
          anthropicProviderCandidate,
          exactCandidate,
        ],
      }).snapshotId,
    ).toBe("snap-exact");

    expect(
      calculator.resolveEffectiveTariff({
        provider: "ANTHROPIC",
        resolvedModel: "claude-sonnet-4-6",
        candidates: [
          globalCandidate,
          otherProviderCandidate,
          anthropicProviderCandidate,
        ],
      }).snapshotId,
    ).toBe("snap-anthropic-default");

    // Must NOT match PROVIDER_DEFAULT:google for anthropic; falls back to GLOBAL_DEFAULT
    expect(
      calculator.resolveEffectiveTariff({
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        candidates: [globalCandidate, otherProviderCandidate],
      }).snapshotId,
    ).toBe("snap-global");

    // No matching scope fails closed
    expect(() =>
      calculator.resolveEffectiveTariff({
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        candidates: [otherProviderCandidate],
      }),
    ).toThrow(ModelPricingNoCoverageError);
  });

  it("fails closed on incomplete rates or unsupported non-zero buckets and never defaults missing rates to 0n", () => {
    const calculator = createServiceWithAllowlist();

    expect(() =>
      calculator.assertCompleteTariffRates({
        input: 1_000_000n,
        output: 2_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.separateRate,
      }),
    ).toThrow(ModelPricingIncompleteRatesError);

    expect(() =>
      calculator.assertCompleteTariffRates({
        input: 1_000_000n,
        output: 2_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      }),
    ).toThrow(ModelPricingIncompleteRatesError);

    expect(() =>
      calculator.calculateCharge({
        usage: { inputTokens: 100n, outputTokens: 100n, reasoningTokens: 10n },
        ratesMicrocreditsPerMillion: {
          input: 1_000_000n,
          output: 2_000_000n,
          reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        },
      }),
    ).toThrow(ModelPricingIncompleteRatesError);
  });

  it("maintains exact BigInt microcredit parity with BillingUsageKernel across sum-then-divide and zero-token inputs", () => {
    const calculator = createServiceWithAllowlist();
    const kernel = new BillingUsageKernel(
      {} as unknown as BillingTransactionPort,
    );

    const rates = {
      input: 500_000n,
      output: 500_000n,
      reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
    };

    const admission = kernel.issueModelUsageAdmission({
      invocationId: "inv-parity-1",
      walletId: "wallet-1",
      spendableMicrocredits: 1_000_000n,
      inFlightCount: 0,
      resolvedModel: "claude-sonnet-4-6",
      provider: "anthropic",
      allowlistedModels: ["claude-sonnet-4-6"],
      availableScopes: [MODEL_PRICING_SCOPES.exactModel],
      pricingSnapshotId: "snap-exact",
      maxInputTokens: 1n,
      maxOutputTokens: 1n,
      ratesMicrocreditsPerMillion: rates,
    });

    const preview = calculator.previewCharge({
      provider: "anthropic",
      resolvedModel: "claude-sonnet-4-6",
      usage: { inputTokens: 1n, outputTokens: 1n },
      candidates: [
        {
          scope: MODEL_PRICING_SCOPES.exactModel,
          normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
          snapshotId: "snap-exact",
          assignmentId: "assign-exact",
          version: 1,
          ratesMicrocreditsPerMillion: rates,
        },
      ],
    });

    // Sub-microcredit sum-then-divide: (1*500_000 + 1*500_000)/1_000_000 = 1n
    expect(admission.maximumExposureMicrocredits).toBe(1n);
    expect(preview.chargeMicrocredits).toBe(1n);
    expect(preview.chargeCreditsDecimal).toBe("0.000001");
    expect(preview.resolvedScope).toBe(MODEL_PRICING_SCOPES.exactModel);

    // Zero tokens yield 0n (no minimum floor)
    const zeroResult = calculator.calculateCharge({
      usage: { inputTokens: 0n, outputTokens: 0n },
      ratesMicrocreditsPerMillion: rates,
    });
    expect(zeroResult.chargeMicrocredits).toBe(0n);
    expect(zeroResult.chargeCreditsDecimal).toBe("0");
  });

  it("never imports or synthesizes 1.8x customer-pricing or official-reference-pricing defaults", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/modules/billing/application/shared/model-pricing-calculator.service.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/customer-pricing/);
    expect(source).not.toMatch(/official-reference-pricing/);
    expect(source).not.toMatch(/quoteCustomerUsage/);
    expect(source).not.toMatch(/estimateOfficialReferenceCost/);
    expect(source).not.toMatch(/1\.8/);
  });
});
