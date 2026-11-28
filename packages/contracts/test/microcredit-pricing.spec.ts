import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  CANONICAL_MICROCREDIT_DECIMAL_PATTERN,
  CREDIT_LEDGER_SOURCES,
  MICROCREDITS_PER_CREDIT,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  OUTPUT_EVALUATION_STATES,
  PRICING_ASSIGNMENT_STATUSES,
  PROVIDER_COMPLETION_STATES,
  TOKEN_BUCKET_POLICIES,
  calculateMicrocreditCharge,
  formatMicrocreditsToDecimal,
  microcreditDecimalSchema,
  microcreditIntegerStringSchema,
  parseDecimalToMicrocredits,
  projectSignedWalletBalance,
  resolveEffectivePricingScope,
} from "../src/billing/index.ts";

describe("microcredit pricing and usage settlement contracts", () => {
  describe("microcredit scale and decimal codec (ASM-BUDGET-02)", () => {
    it("exposes exact 1_000_000n microcredits per credit scale", () => {
      expect(MICROCREDITS_PER_CREDIT).toBe(1_000_000n);
      expect(CANONICAL_MICROCREDIT_DECIMAL_PATTERN.test("1.234567")).toBe(true);
    });

    it("formats positive, zero, and negative microcredit amounts canonically", () => {
      expect(formatMicrocreditsToDecimal(0n)).toBe("0");
      expect(formatMicrocreditsToDecimal(-0n)).toBe("0");
      expect(formatMicrocreditsToDecimal(1_234_567n)).toBe("1.234567");
      expect(formatMicrocreditsToDecimal(1_500_000n)).toBe("1.5");
      expect(formatMicrocreditsToDecimal(5_000_000n)).toBe("5");
      expect(formatMicrocreditsToDecimal(-250_000n)).toBe("-0.25");
      expect(formatMicrocreditsToDecimal(-1n)).toBe("-0.000001");
      expect(formatMicrocreditsToDecimal(-5_000_000n)).toBe("-5");
    });

    it("parses canonical decimal strings into exact bigints and round-trips", () => {
      const samples = [
        0n,
        1n,
        -1n,
        250_000n,
        -250_000n,
        1_234_567n,
        -1_234_567n,
        5_000_000n,
        9_999_999_999_999n,
      ];
      for (const sample of samples) {
        const formatted = formatMicrocreditsToDecimal(sample);
        expect(parseDecimalToMicrocredits(formatted)).toBe(sample);
      }
      expect(parseDecimalToMicrocredits("-0")).toBe(0n);
      expect(parseDecimalToMicrocredits("-0.000")).toBe(0n);
    });

    it("rejects non-canonical decimals, excessive precision, scientific notation, and invalid types", () => {
      const invalidInputs = [
        "",
        " 1.5",
        "1.5 ",
        "+1.5",
        ".5",
        "1.",
        "1.2345678",
        "1e6",
        "1E-3",
        "1,000",
        "1_000",
        "NaN",
        "Infinity",
      ];
      for (const invalid of invalidInputs) {
        expect(() => parseDecimalToMicrocredits(invalid)).toThrow(
          /Invalid canonical microcredit decimal string/,
        );
        expect(microcreditDecimalSchema.safeParse(invalid).success).toBe(false);
      }

      expect(() =>
        formatMicrocreditsToDecimal(1.5 as unknown as bigint),
      ).toThrow(TypeError);
      expect(() =>
        parseDecimalToMicrocredits(123 as unknown as string),
      ).toThrow(/Invalid canonical microcredit decimal string/);
      expect(microcreditIntegerStringSchema.safeParse("-250000").success).toBe(
        true,
      );
      expect(microcreditIntegerStringSchema.safeParse("1.5").success).toBe(
        false,
      );
    });
  });

  describe("signed wallet projection (ASM-BUDGET-04)", () => {
    it("projects negative, zero, and positive balances accurately", () => {
      expect(projectSignedWalletBalance(-250_000n)).toEqual({
        ledgerBalanceMicrocredits: "-250000",
        spendableMicrocredits: "0",
        outstandingMicrocredits: "250000",
      });
      expect(projectSignedWalletBalance(0n)).toEqual({
        ledgerBalanceMicrocredits: "0",
        spendableMicrocredits: "0",
        outstandingMicrocredits: "0",
      });
      expect(projectSignedWalletBalance(500_000n)).toEqual({
        ledgerBalanceMicrocredits: "500000",
        spendableMicrocredits: "500000",
        outstandingMicrocredits: "0",
      });
      expect(() =>
        projectSignedWalletBalance("500000" as unknown as bigint),
      ).toThrow(TypeError);
    });
  });

  describe("pricing constants, charge calculation, and scope resolution (ASM-PRICING-01..04)", () => {
    it("exports canonical pricing scopes, assignment statuses, and token bucket policies", () => {
      expect(MODEL_PRICING_SCOPES).toEqual({
        exactModel: "EXACT_MODEL",
        providerDefault: "PROVIDER_DEFAULT",
        globalDefault: "GLOBAL_DEFAULT",
      });
      expect(PRICING_ASSIGNMENT_STATUSES).toEqual({
        scheduled: "SCHEDULED",
        active: "ACTIVE",
        superseded: "SUPERSEDED",
      });
      expect(TOKEN_BUCKET_POLICIES).toEqual({
        separateRate: "SEPARATE_RATE",
        useOutputRate: "USE_OUTPUT_RATE",
        includedInOutput: "INCLUDED_IN_OUTPUT",
        unsupported: "UNSUPPORTED",
      });
    });

    it("computes integer microcredit charge via sum-then-divide across buckets", () => {
      // Exact multiple example
      expect(
        calculateMicrocreditCharge({
          usage: { inputTokens: 1_000_000n, outputTokens: 500_000n },
          ratesMicrocreditsPerMillion: {
            input: 3_000_000n,
            output: 15_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          },
        }),
      ).toBe(10_500_000n);

      // Sum-then-divide preserves sub-microcredit precision across buckets:
      // (1 * 500_000 + 1 * 500_000) / 1_000_000 = 1n (per-bucket division would yield 0n)
      expect(
        calculateMicrocreditCharge({
          usage: { inputTokens: 1n, outputTokens: 1n },
          ratesMicrocreditsPerMillion: {
            input: 500_000n,
            output: 500_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          },
        }),
      ).toBe(1n);

      // Zero tokens yield 0n (no minimum charge floor)
      expect(
        calculateMicrocreditCharge({
          usage: { inputTokens: 0n, outputTokens: 0n },
          ratesMicrocreditsPerMillion: {
            input: 3_000_000n,
            output: 15_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          },
        }),
      ).toBe(0n);
    });

    it("prices the worker cache fixture using rates per million tokens", () => {
      // Why: The Python worker fixture previously treated the weighted numerator as microcredits.
      // How: Price the same disjoint input, cache, and output buckets with the authoritative calculator.
      // Invariant: Rates are microcredits per million tokens and cache reads are excluded from inputTokens.
      expect(
        calculateMicrocreditCharge({
          usage: {
            inputTokens: 200n,
            cachedInputTokens: 800n,
            outputTokens: 500n,
            reasoningTokens: 150n,
          },
          ratesMicrocreditsPerMillion: {
            input: 10_000_000n,
            cachedInput: 2_000_000n,
            output: 30_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          },
        }),
      ).toBe(18_600n);
    });

    it("handles reasoning, cachedInput, and cacheWrite bucket policies and fails closed on errors", () => {
      // SEPARATE_RATE reasoning
      expect(
        calculateMicrocreditCharge({
          usage: {
            inputTokens: 500_000n,
            outputTokens: 500_000n,
            reasoningTokens: 250_000n,
          },
          ratesMicrocreditsPerMillion: {
            input: 2_000_000n,
            output: 4_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.separateRate,
            reasoning: 8_000_000n,
          },
        }),
      ).toBe(5_000_000n);

      // USE_OUTPUT_RATE reasoning
      expect(
        calculateMicrocreditCharge({
          usage: {
            inputTokens: 0n,
            outputTokens: 500_000n,
            reasoningTokens: 500_000n,
          },
          ratesMicrocreditsPerMillion: {
            input: 1_000_000n,
            output: 4_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.useOutputRate,
          },
        }),
      ).toBe(4_000_000n);

      // Split cacheWrite5m + cacheWrite1h with matching aggregate does not double-count
      expect(
        calculateMicrocreditCharge({
          usage: {
            inputTokens: 1_000_000n,
            outputTokens: 0n,
            cachedInputTokens: 1_000_000n,
            cacheWriteTokens: 1_500_000n,
            cacheWrite5mTokens: 1_000_000n,
            cacheWrite1hTokens: 500_000n,
          },
          ratesMicrocreditsPerMillion: {
            input: 3_000_000n,
            output: 15_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
            cachedInput: 300_000n,
            cacheWrite5m: 3_750_000n,
            cacheWrite1h: 6_000_000n,
          },
        }),
      ).toBe(10_050_000n);

      // Fail closed: SEPARATE_RATE without reasoning rate (even at 0 tokens)
      expect(() =>
        calculateMicrocreditCharge({
          usage: { inputTokens: 100n, outputTokens: 100n, reasoningTokens: 0n },
          ratesMicrocreditsPerMillion: {
            input: 1_000_000n,
            output: 2_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.separateRate,
          },
        }),
      ).toThrow(/Missing reasoning rate/);

      // Fail closed: UNSUPPORTED reasoning with >0 tokens
      expect(() =>
        calculateMicrocreditCharge({
          usage: { inputTokens: 100n, outputTokens: 100n, reasoningTokens: 1n },
          ratesMicrocreditsPerMillion: {
            input: 1_000_000n,
            output: 2_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          },
        }),
      ).toThrow(/unsupported/);

      // Fail closed: INCLUDED_IN_OUTPUT when reasoningTokens > outputTokens
      expect(() =>
        calculateMicrocreditCharge({
          usage: {
            inputTokens: 100n,
            outputTokens: 50n,
            reasoningTokens: 51n,
          },
          ratesMicrocreditsPerMillion: {
            input: 1_000_000n,
            output: 2_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          },
        }),
      ).toThrow(/exceeds outputTokens/);

      // Fail closed: inconsistent cacheWrite aggregate vs split
      expect(() =>
        calculateMicrocreditCharge({
          usage: {
            inputTokens: 0n,
            outputTokens: 0n,
            cacheWriteTokens: 100n,
            cacheWrite5mTokens: 60n,
            cacheWrite1hTokens: 50n,
          },
          ratesMicrocreditsPerMillion: {
            input: 1_000_000n,
            output: 1_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
            cacheWrite5m: 1_000_000n,
            cacheWrite1h: 2_000_000n,
          },
        }),
      ).toThrow(/Inconsistent cacheWriteTokens/);

      // Fail closed: negative token or rate
      expect(() =>
        calculateMicrocreditCharge({
          usage: { inputTokens: -1n, outputTokens: 0n },
          ratesMicrocreditsPerMillion: {
            input: 1_000_000n,
            output: 1_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          },
        }),
      ).toThrow(/non-negative bigint/);

      // Fail closed: missing cachedInput rate when cachedInputTokens > 0
      expect(() =>
        calculateMicrocreditCharge({
          usage: { inputTokens: 0n, outputTokens: 0n, cachedInputTokens: 10n },
          ratesMicrocreditsPerMillion: {
            input: 1_000_000n,
            output: 1_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          },
        }),
      ).toThrow(/Missing cachedInput rate/);
    });

    it("resolves pricing scope strictly in EXACT_MODEL -> PROVIDER_DEFAULT -> GLOBAL_DEFAULT order and rejects non-allowlisted models", () => {
      expect(
        resolveEffectivePricingScope({
          resolvedModel: "gemini-2.5-pro",
          provider: "google",
          allowlistedModels: ["gemini-2.5-pro"],
          availableScopes: [
            "GLOBAL_DEFAULT",
            "PROVIDER_DEFAULT",
            "EXACT_MODEL",
          ],
        }),
      ).toEqual({ scope: "EXACT_MODEL" });

      expect(
        resolveEffectivePricingScope({
          resolvedModel: "gemini-2.5-pro",
          provider: "google",
          allowlistedModels: ["gemini-2.5-pro"],
          availableScopes: ["GLOBAL_DEFAULT", "PROVIDER_DEFAULT"],
        }),
      ).toEqual({ scope: "PROVIDER_DEFAULT" });

      expect(
        resolveEffectivePricingScope({
          resolvedModel: "gemini-2.5-pro",
          provider: "google",
          allowlistedModels: ["gemini-2.5-pro"],
          availableScopes: ["GLOBAL_DEFAULT"],
        }),
      ).toEqual({ scope: "GLOBAL_DEFAULT" });

      // Non-allowlisted model must fail closed even when GLOBAL_DEFAULT exists
      expect(() =>
        resolveEffectivePricingScope({
          resolvedModel: "typo-unlisted-model",
          provider: "google",
          allowlistedModels: ["gemini-2.5-pro"],
          availableScopes: ["GLOBAL_DEFAULT"],
        }),
      ).toThrow(/allowlist/);

      // Unknown scope fails closed
      expect(() =>
        resolveEffectivePricingScope({
          resolvedModel: "gemini-2.5-pro",
          provider: "google",
          allowlistedModels: ["gemini-2.5-pro"],
          availableScopes: ["UNKNOWN_SCOPE"],
        }),
      ).toThrow(/Unknown pricing scope/);

      // Empty scopes fail closed
      expect(() =>
        resolveEffectivePricingScope({
          resolvedModel: "gemini-2.5-pro",
          provider: "google",
          allowlistedModels: ["gemini-2.5-pro"],
          availableScopes: [],
        }),
      ).toThrow(/No effective pricing scope/);

      // Untrimmed model or empty provider fails closed
      expect(() =>
        resolveEffectivePricingScope({
          resolvedModel: " gemini-2.5-pro ",
          provider: "google",
          allowlistedModels: [" gemini-2.5-pro "],
          availableScopes: ["GLOBAL_DEFAULT"],
        }),
      ).toThrow(/non-empty trimmed/);
    });
  });

  describe("usage settlement and admission state contracts", () => {
    it("exports canonical SCREAMING_SNAKE_CASE value sets matching domain specs and Python metering", () => {
      expect(MODEL_USAGE_DEBIT_MODES).toEqual({
        OFF: "OFF",
        SHADOW: "SHADOW",
        ON: "ON",
      });

      expect(Object.values(PROVIDER_COMPLETION_STATES)).toEqual([
        "COMPLETED",
        "MAX_TOKENS",
        "TRUNCATED",
        "FAILED",
        "OUTCOME_UNKNOWN",
      ]);

      expect(Object.values(OUTPUT_EVALUATION_STATES)).toEqual([
        "ACCEPTED",
        "SCHEMA_INVALID",
        "DOMAIN_REJECTED",
        "NOT_EVALUATED",
      ]);

      expect(Object.values(CREDIT_LEDGER_SOURCES)).toEqual([
        "BILLING_ORDER_CREDIT",
        "MODEL_USAGE_DEBIT",
        "COMPENSATION",
        "GOODWILL_CREDIT",
      ]);

      expect(Object.values(ADMISSION_FUNDING_PRINCIPALS)).toEqual([
        "CUSTOMER_WALLET",
        "PLATFORM_SPONSORED",
      ]);

      expect(Object.values(ADMISSION_STATES)).toEqual([
        "REQUESTED",
        "ADMITTED",
        "REJECTED",
        "IN_FLIGHT",
        "EXPIRED",
        "REVOKED",
        "DISPATCH_UNKNOWN",
        "OUTCOME_UNKNOWN",
        "CONFIRMED_NO_USAGE",
        "SETTLED",
        "BILLING_INTEGRITY_REVIEW",
        "COMPENSATED",
      ]);
    });
  });
});
