import { describe, expect, it, jest } from "@jest/globals";
import {
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_SCOPES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "../../shared/runtime-model-allowlist.service.js";
import {
  ModelPricingImmutableSnapshotError,
  ModelPricingStaleDraftError,
} from "../../../domain/billing.errors.js";
import type {
  ModelPricingRepositoryPort,
  ModelTariffDraftRecord,
} from "../../../domain/repositories/model-pricing.port.js";
import { UpdateModelTariffDraftCommand } from "./update-model-tariff-draft.command.js";
import { UpdateModelTariffDraftHandler } from "./update-model-tariff-draft.handler.js";

function createDraftRecord(
  overrides: Partial<ModelTariffDraftRecord> = {},
): ModelTariffDraftRecord {
  const now = new Date("2026-11-26T00:00:00.000Z");
  return {
    id: "draft-1",
    scope: MODEL_PRICING_SCOPES.exactModel,
    provider: "anthropic",
    resolvedModel: "claude-sonnet-4-6",
    normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
    status: CUSTOMER_TARIFF_DRAFT_STATUSES.draft,
    version: 2,
    inputMicrocreditsPerMillion: 3_500_000n,
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
    ...overrides,
  };
}

describe("UpdateModelTariffDraftHandler", () => {
  it("delegates optimistic version update and returns mapped draft view", async () => {
    const updated = createDraftRecord({ version: 2 });
    const updateDraft = jest.fn(() => Promise.resolve(updated));
    const repo = { updateDraft } as unknown as ModelPricingRepositoryPort;
    const allowlist = new RuntimeModelAllowlistService(undefined, {
      entries: [
        {
          routeId: "anthropic-primary",
          provider: "anthropic",
          protocol: "anthropic",
          model: "claude-sonnet-4-6",
        },
      ],
    });
    const calculator = new ModelPricingCalculatorService(allowlist);
    const handler = new UpdateModelTariffDraftHandler(
      repo,
      allowlist,
      calculator,
    );

    const result = await handler.execute(
      new UpdateModelTariffDraftCommand({
        draftId: "draft-1",
        expectedVersion: 1,
        inputMicrocreditsPerMillion: "3500000",
        actorId: "admin-1",
        correlationId: "corr-update-1",
      }),
    );

    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(result.version).toBe(2);
    expect(result.inputMicrocreditsPerMillion).toBe("3500000");
  });

  it("propagates stale draft version and published immutability conflicts", async () => {
    const updateDraft = jest
      .fn<ModelPricingRepositoryPort["updateDraft"]>()
      .mockRejectedValueOnce(new ModelPricingStaleDraftError("stale version"))
      .mockRejectedValueOnce(
        new ModelPricingImmutableSnapshotError("already published"),
      );
    const repo = { updateDraft } as unknown as ModelPricingRepositoryPort;
    const allowlist = new RuntimeModelAllowlistService(undefined, {
      entries: [],
    });
    const calculator = new ModelPricingCalculatorService(allowlist);
    const handler = new UpdateModelTariffDraftHandler(
      repo,
      allowlist,
      calculator,
    );

    await expect(
      handler.execute(
        new UpdateModelTariffDraftCommand({
          draftId: "draft-1",
          expectedVersion: 1,
          inputMicrocreditsPerMillion: "3500000",
          actorId: "admin-1",
          correlationId: "corr-update-2",
        }),
      ),
    ).rejects.toBeInstanceOf(ModelPricingStaleDraftError);

    await expect(
      handler.execute(
        new UpdateModelTariffDraftCommand({
          draftId: "draft-1",
          expectedVersion: 1,
          inputMicrocreditsPerMillion: "3500000",
          actorId: "admin-1",
          correlationId: "corr-update-3",
        }),
      ),
    ).rejects.toBeInstanceOf(ModelPricingImmutableSnapshotError);
  });
});
