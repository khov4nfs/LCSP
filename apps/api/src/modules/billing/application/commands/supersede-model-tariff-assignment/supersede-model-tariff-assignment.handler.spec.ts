import { describe, expect, it, jest } from "@jest/globals";
import {
  MODEL_PRICING_SCOPES,
  PRICING_ASSIGNMENT_STATUSES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import {
  BillingIdempotencyConflictError,
  InvalidBillingInputError,
  ModelPricingInvalidIntervalError,
} from "../../../domain/billing.errors.js";
import {
  MODEL_PRICING_FINGERPRINT_ACTIONS,
  computeModelPricingRequestFingerprint,
} from "../../../domain/model-pricing-fingerprint.js";
import type { ModelPricingRepositoryPort } from "../../../domain/repositories/model-pricing.port.js";
import { SupersedeModelTariffAssignmentCommand } from "./supersede-model-tariff-assignment.command.js";
import { SupersedeModelTariffAssignmentHandler } from "./supersede-model-tariff-assignment.handler.js";

describe("SupersedeModelTariffAssignmentHandler", () => {
  const effectiveFrom = new Date("2026-12-10T00:00:00.000Z");
  const now = new Date("2026-11-26T00:00:00.000Z");
  const fingerprint = computeModelPricingRequestFingerprint({
    action: MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment,
    assignmentId: "assign-1",
    effectiveFrom: effectiveFrom.toISOString(),
    effectiveTo: null,
    replacementSnapshotId: "snap-2",
    replacementDraftId: null,
    auditReason: "Rotate to v2 tariff",
  });

  it("rejects invalid fingerprint before calling repository", async () => {
    const supersedeAssignment = jest.fn();
    const repo = {
      supersedeAssignment,
    } as unknown as ModelPricingRepositoryPort;
    const handler = new SupersedeModelTariffAssignmentHandler(repo);

    await expect(
      handler.execute(
        new SupersedeModelTariffAssignmentCommand({
          assignmentId: "assign-1",
          idempotencyKey: "sup-1",
          requestFingerprint: "deadbeef".repeat(8),
          auditReason: "Rotate to v2 tariff",
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveTo: null,
          replacementSnapshotId: "snap-2",
          actorId: "admin-1",
          correlationId: "corr-sup-1",
        }),
      ),
    ).rejects.toBeInstanceOf(BillingIdempotencyConflictError);

    expect(supersedeAssignment).not.toHaveBeenCalled();
  });

  it("rejects non-XOR replacement targets and inverted intervals", async () => {
    const supersedeAssignment = jest.fn();
    const repo = {
      supersedeAssignment,
    } as unknown as ModelPricingRepositoryPort;
    const handler = new SupersedeModelTariffAssignmentHandler(repo);

    await expect(
      handler.execute(
        new SupersedeModelTariffAssignmentCommand({
          assignmentId: "assign-1",
          idempotencyKey: "sup-2",
          requestFingerprint: fingerprint,
          auditReason: "Rotate to v2 tariff",
          effectiveFrom: "2026-12-10T00:00:00.000Z",
          effectiveTo: "2026-12-10T00:00:00.000Z",
          replacementSnapshotId: "snap-2",
          actorId: "admin-1",
          correlationId: "corr-sup-2",
        }),
      ),
    ).rejects.toBeInstanceOf(ModelPricingInvalidIntervalError);

    await expect(
      handler.execute(
        new SupersedeModelTariffAssignmentCommand({
          assignmentId: "assign-1",
          idempotencyKey: "sup-3",
          requestFingerprint: fingerprint,
          auditReason: "Rotate to v2 tariff",
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveTo: null,
          replacementDraftId: "draft-2",
          replacementSnapshotId: "snap-2",
          actorId: "admin-1",
          correlationId: "corr-sup-3",
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidBillingInputError);

    expect(supersedeAssignment).not.toHaveBeenCalled();
  });

  it("returns mapped superseded assignment, replacement assignment, and immutable snapshot", async () => {
    const supersedeAssignment = jest
      .fn<ModelPricingRepositoryPort["supersedeAssignment"]>()
      .mockResolvedValue({
        supersededAssignment: {
          id: "assign-1",
          tariffSnapshotId: "snap-1",
          scope: MODEL_PRICING_SCOPES.exactModel,
          normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
          effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
          effectiveTo: effectiveFrom,
          supersededByAssignmentId: "assign-2",
          supersededBy: "admin-1",
          supersededAt: now,
          cancelledAt: null,
          supersedeIdempotencyKey: "sup-4",
          supersedeRequestFingerprint: fingerprint,
          version: 2,
          auditReason: "Rotate to v2 tariff",
          createdBy: "admin-1",
          createdAt: now,
        },
        replacementAssignment: {
          id: "assign-2",
          tariffSnapshotId: "snap-2",
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
          auditReason: "Rotate to v2 tariff",
          createdBy: "admin-1",
          createdAt: now,
        },
        replacementSnapshot: {
          id: "snap-2",
          sourceDraftId: "draft-2",
          scope: MODEL_PRICING_SCOPES.exactModel,
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
          version: 2,
          accountingUnitVersion: 1,
          inputMicrocreditsPerMillion: 4_000_000n,
          outputMicrocreditsPerMillion: 20_000_000n,
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          reasoningMicrocreditsPerMillion: null,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cachedInputMicrocreditsPerMillion: null,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cacheWriteMicrocreditsPerMillion: null,
          cacheWrite5mMicrocreditsPerMillion: null,
          cacheWrite1hMicrocreditsPerMillion: null,
          idempotencyKey: "pub-2",
          requestFingerprint: "f".repeat(64),
          publishedBy: "admin-1",
          auditReason: "Approve v2",
          publishedAt: now,
          createdAt: now,
        },
        auditEventId: "audit:sup-4",
        dbUtcNow: now,
        idempotentReplay: false,
      });

    const repo = {
      supersedeAssignment,
    } as unknown as ModelPricingRepositoryPort;
    const handler = new SupersedeModelTariffAssignmentHandler(repo);

    const res = await handler.execute(
      new SupersedeModelTariffAssignmentCommand({
        assignmentId: "assign-1",
        idempotencyKey: "sup-4",
        requestFingerprint: fingerprint,
        auditReason: "Rotate to v2 tariff",
        expectedAssignmentVersion: 1,
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveTo: null,
        replacementSnapshotId: "snap-2",
        actorId: "admin-1",
        correlationId: "corr-sup-4",
      }),
    );

    expect(res.supersededAssignment.status).toBe(
      PRICING_ASSIGNMENT_STATUSES.superseded,
    );
    expect(res.replacementAssignment.status).toBe(
      PRICING_ASSIGNMENT_STATUSES.scheduled,
    );
    expect(res.replacementSnapshot.id).toBe("snap-2");
    expect(res.auditEventId).toBe("audit:sup-4");
  });
});
