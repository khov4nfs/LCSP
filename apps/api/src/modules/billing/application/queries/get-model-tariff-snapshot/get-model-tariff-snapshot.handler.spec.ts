import { describe, expect, it, jest } from "@jest/globals";
import {
  MODEL_PRICING_SCOPES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import { ModelPricingNotFoundError } from "../../../domain/billing.errors.js";
import type { ModelPricingRepositoryPort } from "../../../domain/repositories/model-pricing.port.js";
import { GetModelTariffSnapshotQuery } from "./get-model-tariff-snapshot.query.js";
import { GetModelTariffSnapshotHandler } from "./get-model-tariff-snapshot.handler.js";

describe("GetModelTariffSnapshotHandler", () => {
  it("returns mapped immutable snapshot view or throws ModelPricingNotFoundError", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    const findSnapshotById = jest
      .fn<ModelPricingRepositoryPort["findSnapshotById"]>()
      .mockResolvedValueOnce({
        id: "snap-1",
        sourceDraftId: "draft-1",
        scope: MODEL_PRICING_SCOPES.exactModel,
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
        version: 1,
        accountingUnitVersion: 1,
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
        idempotencyKey: "pub-1",
        requestFingerprint: "a".repeat(64),
        publishedBy: "admin-1",
        auditReason: "Initial publish",
        publishedAt: now,
        createdAt: now,
      })
      .mockResolvedValueOnce(null);

    const repo = { findSnapshotById } as unknown as ModelPricingRepositoryPort;
    const handler = new GetModelTariffSnapshotHandler(repo);

    const view = await handler.execute(
      new GetModelTariffSnapshotQuery("snap-1"),
    );
    expect(view.id).toBe("snap-1");
    expect(view.version).toBe(1);
    expect(view.outputMicrocreditsPerMillion).toBe("15000000");

    await expect(
      handler.execute(new GetModelTariffSnapshotQuery("missing-snap")),
    ).rejects.toBeInstanceOf(ModelPricingNotFoundError);
  });
});
