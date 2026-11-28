import { describe, expect, it, jest } from "@jest/globals";
import {
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_SCOPES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import { ModelPricingNotFoundError } from "../../../domain/billing.errors.js";
import type { ModelPricingRepositoryPort } from "../../../domain/repositories/model-pricing.port.js";
import { GetModelTariffDraftQuery } from "./get-model-tariff-draft.query.js";
import { GetModelTariffDraftHandler } from "./get-model-tariff-draft.handler.js";

describe("GetModelTariffDraftHandler", () => {
  it("returns mapped draft view or throws ModelPricingNotFoundError", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    const findDraftById = jest
      .fn<ModelPricingRepositoryPort["findDraftById"]>()
      .mockResolvedValueOnce({
        id: "draft-1",
        scope: MODEL_PRICING_SCOPES.globalDefault,
        provider: null,
        resolvedModel: null,
        normalizedScopeKey: "GLOBAL_DEFAULT",
        status: CUSTOMER_TARIFF_DRAFT_STATUSES.draft,
        version: 1,
        inputMicrocreditsPerMillion: 1_000_000n,
        outputMicrocreditsPerMillion: 2_000_000n,
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
      })
      .mockResolvedValueOnce(null);

    const repo = { findDraftById } as unknown as ModelPricingRepositoryPort;
    const handler = new GetModelTariffDraftHandler(repo);

    const view = await handler.execute(new GetModelTariffDraftQuery("draft-1"));
    expect(view.id).toBe("draft-1");
    expect(view.inputMicrocreditsPerMillion).toBe("1000000");

    await expect(
      handler.execute(new GetModelTariffDraftQuery("missing-draft")),
    ).rejects.toBeInstanceOf(ModelPricingNotFoundError);
  });
});
