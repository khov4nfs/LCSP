import { describe, expect, it, jest } from "@jest/globals";
import type { ConfigService } from "@nestjs/config";
import {
  MODEL_PRICING_PREVIEW_SOURCES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  TOKEN_BUCKET_POLICIES,
  calculateMicrocreditCharge,
} from "@lcsp/contracts/billing";
import type { AppConfig } from "../../../../../config/config.types.js";
import {
  BillingDomainError,
  ModelPricingNoCoverageError,
  ModelPricingUnlistedModelError,
} from "../../../domain/billing.errors.js";
import type { ModelPricingRepositoryPort } from "../../../domain/repositories/model-pricing.port.js";
import { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "../../shared/runtime-model-allowlist.service.js";
import { PreviewModelPricingQuery } from "./preview-model-pricing.query.js";
import { PreviewModelPricingHandler } from "./preview-model-pricing.handler.js";

describe("PreviewModelPricingHandler", () => {
  const now = new Date("2026-11-26T12:00:00.000Z");

  function makeAllowlist() {
    return new RuntimeModelAllowlistService(undefined, {
      entries: [
        {
          routeId: "anthropic-primary",
          provider: "anthropic",
          protocol: "anthropic",
          model: "claude-sonnet-4-6",
        },
      ],
    });
  }

  function makeConfig(mode: string): ConfigService<AppConfig, true> {
    return {
      get: jest.fn(() => ({ mode })),
    } as unknown as ConfigService<AppConfig, true>;
  }

  it("matches calculateMicrocreditCharge integer math and resolves EXACT_MODEL -> PROVIDER_DEFAULT -> GLOBAL_DEFAULT", async () => {
    const allowlist = makeAllowlist();
    const calculator = new ModelPricingCalculatorService(allowlist);
    const listActiveAssignmentsAt = jest
      .fn<ModelPricingRepositoryPort["listActiveAssignmentsAt"]>()
      .mockResolvedValue([
        {
          assignmentId: "assign-global",
          snapshotId: "snap-global",
          scope: MODEL_PRICING_SCOPES.globalDefault,
          normalizedScopeKey: "GLOBAL_DEFAULT",
          version: 1,
          ratesMicrocreditsPerMillion: {
            input: 5_000_000n,
            output: 20_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          },
        },
        {
          assignmentId: "assign-provider",
          snapshotId: "snap-provider",
          scope: MODEL_PRICING_SCOPES.providerDefault,
          normalizedScopeKey: "PROVIDER_DEFAULT:anthropic",
          version: 2,
          ratesMicrocreditsPerMillion: {
            input: 3_000_000n,
            output: 15_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          },
        },
      ]);

    const repo = {
      getDbUtcNow: jest.fn(() => Promise.resolve(now)),
      listActiveAssignmentsAt,
    } as unknown as ModelPricingRepositoryPort;

    const handler = new PreviewModelPricingHandler(
      repo,
      allowlist,
      calculator,
      makeConfig(MODEL_USAGE_DEBIT_MODES.OFF),
    );

    const preview = await handler.execute(
      new PreviewModelPricingQuery({
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        usage: {
          inputTokens: "12345",
          outputTokens: "6789",
        },
      }),
    );

    const expectedMicrocredits = calculateMicrocreditCharge({
      usage: { inputTokens: 12_345n, outputTokens: 6_789n },
      ratesMicrocreditsPerMillion: {
        input: 3_000_000n,
        output: 15_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      },
    });

    expect(preview.source).toBe(MODEL_PRICING_PREVIEW_SOURCES.activeAssignment);
    expect(preview.resolvedScope).toBe(MODEL_PRICING_SCOPES.providerDefault);
    expect(preview.snapshotId).toBe("snap-provider");
    expect(preview.chargeMicrocredits).toBe(expectedMicrocredits.toString());
    expect(preview.debitMode).toBe(MODEL_USAGE_DEBIT_MODES.OFF);
  });

  it("fails closed for unlisted models, missing coverage, and MODEL_USAGE_DEBIT=ON", async () => {
    const allowlist = makeAllowlist();
    const calculator = new ModelPricingCalculatorService(allowlist);
    const repo = {
      getDbUtcNow: jest.fn(() => Promise.resolve(now)),
      listActiveAssignmentsAt: jest.fn(() => Promise.resolve([])),
    } as unknown as ModelPricingRepositoryPort;

    const handler = new PreviewModelPricingHandler(
      repo,
      allowlist,
      calculator,
      makeConfig(MODEL_USAGE_DEBIT_MODES.OFF),
    );

    await expect(
      handler.execute(
        new PreviewModelPricingQuery({
          provider: "anthropic",
          resolvedModel: "unlisted-model",
          usage: { inputTokens: "100", outputTokens: "50" },
        }),
      ),
    ).rejects.toBeInstanceOf(ModelPricingUnlistedModelError);

    await expect(
      handler.execute(
        new PreviewModelPricingQuery({
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          usage: { inputTokens: "100", outputTokens: "50" },
        }),
      ),
    ).rejects.toBeInstanceOf(ModelPricingNoCoverageError);

    const handlerOn = new PreviewModelPricingHandler(
      repo,
      allowlist,
      calculator,
      makeConfig(MODEL_USAGE_DEBIT_MODES.ON),
    );
    await expect(
      handlerOn.execute(
        new PreviewModelPricingQuery({
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          usage: { inputTokens: "100", outputTokens: "50" },
        }),
      ),
    ).rejects.toBeInstanceOf(BillingDomainError);
  });
});
