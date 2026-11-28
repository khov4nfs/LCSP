import { describe, expect, it, jest } from "@jest/globals";
import {
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_SCOPES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "../../shared/runtime-model-allowlist.service.js";
import { ModelPricingUnlistedModelError } from "../../../domain/billing.errors.js";
import type {
  ModelPricingRepositoryPort,
  ModelTariffDraftRecord,
} from "../../../domain/repositories/model-pricing.port.js";
import { CreateModelTariffDraftCommand } from "./create-model-tariff-draft.command.js";
import { CreateModelTariffDraftHandler } from "./create-model-tariff-draft.handler.js";

function createTestAllowlist() {
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

describe("CreateModelTariffDraftHandler", () => {
  it("normalizes scope key, validates allowlist and rates, and persists a DRAFT", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    const createdRecord: ModelTariffDraftRecord = {
      id: "draft-1",
      scope: MODEL_PRICING_SCOPES.exactModel,
      provider: "anthropic",
      resolvedModel: "claude-sonnet-4-6",
      normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
      status: CUSTOMER_TARIFF_DRAFT_STATUSES.draft,
      version: 1,
      inputMicrocreditsPerMillion: 3_000_000n,
      outputMicrocreditsPerMillion: 15_000_000n,
      reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      reasoningMicrocreditsPerMillion: null,
      cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
      cachedInputMicrocreditsPerMillion: null,
      cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      cacheWriteMicrocreditsPerMillion: null,
      cacheWrite5mMicrocreditsPerMillion: null,
      cacheWrite1hMicrocreditsPerMillion: null,
      operationalAssumptions: null,
      publishedSnapshotId: null,
      createdBy: "admin-1",
      updatedBy: "admin-1",
      createdAt: now,
      updatedAt: now,
    };

    const createDraft = jest.fn(() => Promise.resolve(createdRecord));
    const repo = { createDraft } as unknown as ModelPricingRepositoryPort;
    const allowlist = createTestAllowlist();
    const calculator = new ModelPricingCalculatorService(allowlist);
    const handler = new CreateModelTariffDraftHandler(
      repo,
      allowlist,
      calculator,
    );

    const view = await handler.execute(
      new CreateModelTariffDraftCommand({
        scope: MODEL_PRICING_SCOPES.exactModel,
        provider: "ANTHROPIC",
        resolvedModel: "claude-sonnet-4-6",
        inputMicrocreditsPerMillion: "3000000",
        outputMicrocreditsPerMillion: "15000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        actorId: "admin-1",
        correlationId: "corr-create-1",
      }),
    );

    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(view.id).toBe("draft-1");
    expect(view.status).toBe(CUSTOMER_TARIFF_DRAFT_STATUSES.draft);
    expect(view.normalizedScopeKey).toBe(
      "EXACT_MODEL:anthropic:claude-sonnet-4-6",
    );
    expect(view.inputMicrocreditsPerMillion).toBe("3000000");
  });

  it("rejects EXACT_MODEL draft creation when model is not in runtime allowlist", async () => {
    const createDraft = jest.fn();
    const repo = { createDraft } as unknown as ModelPricingRepositoryPort;
    const allowlist = createTestAllowlist();
    const calculator = new ModelPricingCalculatorService(allowlist);
    const handler = new CreateModelTariffDraftHandler(
      repo,
      allowlist,
      calculator,
    );

    await expect(
      handler.execute(
        new CreateModelTariffDraftCommand({
          scope: MODEL_PRICING_SCOPES.exactModel,
          provider: "anthropic",
          resolvedModel: "unlisted-model-v99",
          inputMicrocreditsPerMillion: "3000000",
          outputMicrocreditsPerMillion: "15000000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
          actorId: "admin-1",
          correlationId: "corr-create-2",
        }),
      ),
    ).rejects.toBeInstanceOf(ModelPricingUnlistedModelError);

    expect(createDraft).not.toHaveBeenCalled();
  });
});
