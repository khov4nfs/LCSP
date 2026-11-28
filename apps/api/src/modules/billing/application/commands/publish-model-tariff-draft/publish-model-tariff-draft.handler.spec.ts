import { describe, expect, it, jest } from "@jest/globals";
import {
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_SCOPES,
  PRICING_ASSIGNMENT_STATUSES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import {
  BillingIdempotencyConflictError,
  ModelPricingInvalidIntervalError,
  ModelPricingOverlapConflictError,
  ModelPricingStaleDraftError,
} from "../../../domain/billing.errors.js";
import {
  MODEL_PRICING_FINGERPRINT_ACTIONS,
  computeModelPricingRequestFingerprint,
} from "../../../domain/model-pricing-fingerprint.js";
import type { ModelPricingRepositoryPort } from "../../../domain/repositories/model-pricing.port.js";
import { PublishModelTariffDraftCommand } from "./publish-model-tariff-draft.command.js";
import { PublishModelTariffDraftHandler } from "./publish-model-tariff-draft.handler.js";

describe("PublishModelTariffDraftHandler", () => {
  const effectiveFrom = new Date("2026-12-01T00:00:00.000Z");
  const now = new Date("2026-11-26T00:00:00.000Z");
  const fingerprint = computeModelPricingRequestFingerprint({
    action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
    draftId: "draft-1",
    expectedDraftVersion: 1,
    scope: MODEL_PRICING_SCOPES.exactModel,
    provider: "anthropic",
    resolvedModel: "claude-sonnet-4-6",
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: null,
    auditReason: "Approve Claude tariff",
    rates: {
      inputMicrocreditsPerMillion: "3000000",
      outputMicrocreditsPerMillion: "15000000",
      reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
      cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
    },
  });

  it("publishes atomically and handles exact idempotent replay cleanly", async () => {
    const publishDraft = jest
      .fn<ModelPricingRepositoryPort["publishDraft"]>()
      .mockResolvedValue({
        draft: {
          id: "draft-1",
          scope: MODEL_PRICING_SCOPES.exactModel,
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
          status: CUSTOMER_TARIFF_DRAFT_STATUSES.published,
          version: 2,
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
          publishedSnapshotId: "snap-1",
          createdBy: "admin-1",
          updatedBy: "admin-1",
          createdAt: now,
          updatedAt: now,
        },
        snapshot: {
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
          idempotencyKey: "pub-key-1",
          requestFingerprint: fingerprint,
          publishedBy: "admin-1",
          auditReason: "Approve Claude tariff",
          publishedAt: now,
          createdAt: now,
        },
        assignment: {
          id: "assign-1",
          tariffSnapshotId: "snap-1",
          scope: MODEL_PRICING_SCOPES.exactModel,
          normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
          effectiveFrom,
          effectiveTo: null,
          supersededByAssignmentId: null,
          supersededBy: null,
          supersededAt: null,
          cancelledAt: null,
          supersedeIdempotencyKey: null,
          supersedeRequestFingerprint: null,
          version: 1,
          auditReason: "Approve Claude tariff",
          createdBy: "admin-1",
          createdAt: now,
        },
        auditEventId: "audit:pub-1",
        dbUtcNow: now,
        idempotentReplay: true,
      });

    const repo = { publishDraft } as unknown as ModelPricingRepositoryPort;
    const handler = new PublishModelTariffDraftHandler(repo);

    const response = await handler.execute(
      new PublishModelTariffDraftCommand({
        draftId: "draft-1",
        idempotencyKey: "pub-key-1",
        requestFingerprint: fingerprint,
        auditReason: "Approve Claude tariff",
        expectedDraftVersion: 1,
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveTo: null,
        actorId: "admin-1",
        correlationId: "corr-pub-1",
      }),
    );

    expect(response.idempotentReplay).toBe(true);
    expect(response.auditEventId).toBe("audit:pub-1");
    expect(response.snapshot.id).toBe("snap-1");
    expect(response.assignment.status).toBe(
      PRICING_ASSIGNMENT_STATUSES.scheduled,
    );
  });

  it("rejects invalid effectiveTo <= effectiveFrom before touching repository", async () => {
    const publishDraft = jest.fn();
    const repo = { publishDraft } as unknown as ModelPricingRepositoryPort;
    const handler = new PublishModelTariffDraftHandler(repo);

    await expect(
      handler.execute(
        new PublishModelTariffDraftCommand({
          draftId: "draft-1",
          idempotencyKey: "pub-key-2",
          requestFingerprint: fingerprint,
          auditReason: "Invalid interval",
          expectedDraftVersion: 1,
          effectiveFrom: "2026-12-02T00:00:00.000Z",
          effectiveTo: "2026-12-01T00:00:00.000Z",
          actorId: "admin-1",
          correlationId: "corr-pub-2",
        }),
      ),
    ).rejects.toBeInstanceOf(ModelPricingInvalidIntervalError);

    expect(publishDraft).not.toHaveBeenCalled();
  });

  it("propagates overlap, stale draft, and idempotency conflicts", async () => {
    const publishDraft = jest
      .fn<ModelPricingRepositoryPort["publishDraft"]>()
      .mockRejectedValueOnce(new ModelPricingOverlapConflictError("overlap"))
      .mockRejectedValueOnce(new ModelPricingStaleDraftError("stale"))
      .mockRejectedValueOnce(
        new BillingIdempotencyConflictError("fingerprint mismatch"),
      );
    const repo = { publishDraft } as unknown as ModelPricingRepositoryPort;
    const handler = new PublishModelTariffDraftHandler(repo);

    const cmd = new PublishModelTariffDraftCommand({
      draftId: "draft-1",
      idempotencyKey: "pub-key-3",
      requestFingerprint: fingerprint,
      auditReason: "Approve Claude tariff",
      expectedDraftVersion: 1,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: null,
      actorId: "admin-1",
      correlationId: "corr-pub-3",
    });

    await expect(handler.execute(cmd)).rejects.toBeInstanceOf(
      ModelPricingOverlapConflictError,
    );
    await expect(handler.execute(cmd)).rejects.toBeInstanceOf(
      ModelPricingStaleDraftError,
    );
    await expect(handler.execute(cmd)).rejects.toBeInstanceOf(
      BillingIdempotencyConflictError,
    );
  });
});
