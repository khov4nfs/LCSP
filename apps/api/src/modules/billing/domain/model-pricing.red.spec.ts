import { describe, expect, it } from "@jest/globals";
import * as billingContracts from "@lcsp/contracts/billing";

describe("ASM-PRICING-01..04: Direct-Credit Model Pricing RED Contracts", () => {
  it("ASM-PRICING-01: contracts define pricing scope, assignment statuses, and token bucket policies", () => {
    const contracts = billingContracts as Record<string, unknown>;

    const scopes = contracts.MODEL_PRICING_SCOPES as
      Record<string, string> | undefined;
    expect(scopes).toBeDefined();
    expect(scopes?.exactModel).toBe("EXACT_MODEL");
    expect(scopes?.providerDefault).toBe("PROVIDER_DEFAULT");
    expect(scopes?.globalDefault).toBe("GLOBAL_DEFAULT");

    const assignmentStatuses = contracts.PRICING_ASSIGNMENT_STATUSES as
      Record<string, string> | undefined;
    expect(assignmentStatuses).toBeDefined();
    expect(assignmentStatuses?.scheduled).toBe("SCHEDULED");
    expect(assignmentStatuses?.active).toBe("ACTIVE");
    expect(assignmentStatuses?.superseded).toBe("SUPERSEDED");

    const bucketPolicies = contracts.TOKEN_BUCKET_POLICIES as
      Record<string, string> | undefined;
    expect(bucketPolicies).toBeDefined();
    expect(bucketPolicies?.separateRate).toBe("SEPARATE_RATE");
    expect(bucketPolicies?.useOutputRate).toBe("USE_OUTPUT_RATE");
    expect(bucketPolicies?.includedInOutput).toBe("INCLUDED_IN_OUTPUT");
    expect(bucketPolicies?.unsupported).toBe("UNSUPPORTED");
  });

  it("ASM-PRICING-02 & ASM-PRICING-03: canonical microcredit calculator computes integer charge and fails closed on missing rate bucket", () => {
    const contracts = billingContracts as Record<string, unknown>;
    const calculateMicrocreditCharge = contracts.calculateMicrocreditCharge as
      | ((input: {
          usage: {
            inputTokens: bigint;
            outputTokens: bigint;
            reasoningTokens?: bigint;
          };
          ratesMicrocreditsPerMillion: {
            input: bigint;
            output: bigint;
            reasoningPolicy: string;
            reasoning?: bigint;
          };
        }) => bigint)
      | undefined;

    expect(typeof calculateMicrocreditCharge).toBe("function");

    const charge = calculateMicrocreditCharge!({
      usage: { inputTokens: 1_000_000n, outputTokens: 500_000n },
      ratesMicrocreditsPerMillion: {
        input: 3_000_000n,
        output: 15_000_000n,
        reasoningPolicy: "INCLUDED_IN_OUTPUT",
      },
    });
    expect(charge).toBe(10_500_000n);

    // Missing rate for SEPARATE_RATE reasoning must fail closed, never zero
    expect(() =>
      calculateMicrocreditCharge!({
        usage: {
          inputTokens: 100n,
          outputTokens: 100n,
          reasoningTokens: 50n,
        },
        ratesMicrocreditsPerMillion: {
          input: 1_000_000n,
          output: 2_000_000n,
          reasoningPolicy: "SEPARATE_RATE",
        },
      }),
    ).toThrow();
  });

  it("ASM-PRICING-02 & ASM-PRICING-04: pricing resolution selects EXACT_MODEL -> PROVIDER_DEFAULT -> GLOBAL_DEFAULT and rejects non-allowlisted models", () => {
    const contracts = billingContracts as Record<string, unknown>;
    const resolveEffectivePricingScope =
      contracts.resolveEffectivePricingScope as
        | ((input: {
            resolvedModel: string;
            provider: string;
            allowlistedModels: readonly string[];
            availableScopes: readonly string[];
          }) => { scope: string })
        | undefined;

    expect(typeof resolveEffectivePricingScope).toBe("function");

    expect(
      resolveEffectivePricingScope!({
        resolvedModel: "gemini-2.5-pro",
        provider: "google",
        allowlistedModels: ["gemini-2.5-pro"],
        availableScopes: ["GLOBAL_DEFAULT", "PROVIDER_DEFAULT", "EXACT_MODEL"],
      }).scope,
    ).toBe("EXACT_MODEL");

    // Non-allowlisted model must reject even when GLOBAL_DEFAULT exists
    expect(() =>
      resolveEffectivePricingScope!({
        resolvedModel: "typo-unlisted-model",
        provider: "google",
        allowlistedModels: ["gemini-2.5-pro"],
        availableScopes: ["GLOBAL_DEFAULT"],
      }),
    ).toThrow();
  });
});
