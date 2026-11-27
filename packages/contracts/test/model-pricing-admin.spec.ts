import { describe, expect, it } from "@jest/globals";
import { AUDIT_RESOURCE_TYPES } from "../src/audit/index.ts";
import { OUTBOX_AGGREGATE_TYPES } from "../src/outbox/index.ts";
import {
  BILLING_ERROR_CODES,
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_AUDIT_EVENT_TYPES,
  MODEL_PRICING_PREVIEW_SOURCES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  PRICING_ASSIGNMENT_STATUSES,
  TOKEN_BUCKET_POLICIES,
  adminModelPricingOverviewQuerySchema,
  adminModelPricingOverviewResponseSchema,
  createModelTariffDraftSchema,
  nonNegativeMicrocreditIntegerStringSchema,
  normalizeModelPricingScopeKey,
  previewModelPricingResponseSchema,
  previewModelPricingSchema,
  publishModelTariffDraftResponseSchema,
  publishModelTariffDraftSchema,
  supersedeModelTariffAssignmentResponseSchema,
  supersedeModelTariffAssignmentSchema,
  updateModelTariffDraftSchema,
} from "../src/billing/index.ts";

describe("WP8 Phase B2 model pricing admin contracts", () => {
  describe("canonical constants, error codes, audit & outbox types", () => {
    it("exports CUSTOMER_TARIFF_DRAFT_STATUSES in SCREAMING_SNAKE_CASE", () => {
      expect(CUSTOMER_TARIFF_DRAFT_STATUSES).toEqual({
        draft: "DRAFT",
        published: "PUBLISHED",
        abandoned: "ABANDONED",
      });
    });

    it("exports all Phase B2 BILLING_ERROR_CODES alongside existing codes", () => {
      expect(BILLING_ERROR_CODES).toMatchObject({
        validationFailed: "BILLING_VALIDATION_FAILED",
        idempotencyKeyRequired: "BILLING_IDEMPOTENCY_KEY_REQUIRED",
        idempotencyConflict: "BILLING_IDEMPOTENCY_CONFLICT",
        notFound: "BILLING_NOT_FOUND",
        ownershipMismatch: "BILLING_OWNERSHIP_MISMATCH",
        reservationTransition: "BILLING_RESERVATION_TRANSITION_INVALID",
        concurrencyConflict: "BILLING_CONCURRENCY_CONFLICT",
        modelPricingNotFound: "MODEL_PRICING_NOT_FOUND",
        modelPricingOverlapConflict: "MODEL_PRICING_OVERLAP_CONFLICT",
        modelPricingImmutableSnapshot: "MODEL_PRICING_IMMUTABLE_SNAPSHOT",
        modelPricingUnlistedModel: "MODEL_PRICING_UNLISTED_MODEL",
        modelPricingIncompleteRates: "MODEL_PRICING_INCOMPLETE_RATES",
        modelPricingStaleDraft: "MODEL_PRICING_STALE_DRAFT",
        modelPricingInvalidInterval: "MODEL_PRICING_INVALID_INTERVAL",
        modelPricingNoCoverage: "MODEL_PRICING_NO_COVERAGE",
        modelPricingInvalidState: "MODEL_PRICING_INVALID_STATE",
      });
    });

    it("exports MODEL_PRICING_AUDIT_EVENT_TYPES, AUDIT_RESOURCE_TYPES.customerModelTariff, OUTBOX_AGGREGATE_TYPES.customerModelTariff, and MODEL_PRICING_PREVIEW_SOURCES", () => {
      expect(MODEL_PRICING_AUDIT_EVENT_TYPES).toEqual({
        draftCreated: "MODEL_PRICING_DRAFT_CREATED",
        draftUpdated: "MODEL_PRICING_DRAFT_UPDATED",
        published: "MODEL_PRICING_PUBLISHED",
        assignmentSuperseded: "MODEL_PRICING_ASSIGNMENT_SUPERSEDED",
      });
      expect(AUDIT_RESOURCE_TYPES.customerModelTariff).toBe(
        "CUSTOMER_MODEL_TARIFF",
      );
      expect(OUTBOX_AGGREGATE_TYPES.customerModelTariff).toBe(
        "CUSTOMER_MODEL_TARIFF",
      );
      expect(MODEL_PRICING_PREVIEW_SOURCES).toEqual({
        activeAssignment: "ACTIVE_ASSIGNMENT",
        draft: "DRAFT",
        snapshot: "SNAPSHOT",
        inlineRates: "INLINE_RATES",
      });
    });
  });

  describe("normalizeModelPricingScopeKey", () => {
    it("normalizes GLOBAL_DEFAULT, PROVIDER_DEFAULT, and EXACT_MODEL deterministically", () => {
      expect(
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.globalDefault,
          null,
          undefined,
        ),
      ).toBe("GLOBAL_DEFAULT");
      expect(
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.globalDefault,
          "   ",
          "",
        ),
      ).toBe("GLOBAL_DEFAULT");

      expect(
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.providerDefault,
          "  Anthropic  ",
          null,
        ),
      ).toBe("PROVIDER_DEFAULT:anthropic");

      expect(
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.exactModel,
          "  Anthropic ",
          "  Claude-Sonnet-4-6  ",
        ),
      ).toBe("EXACT_MODEL:anthropic:Claude-Sonnet-4-6");
    });

    it("fails closed on invalid scopes, colons in provider, non-strings, or mismatched provider/resolvedModel", () => {
      expect(() =>
        normalizeModelPricingScopeKey(
          "UNKNOWN_SCOPE" as never,
          "anthropic",
          "claude-sonnet-4-6",
        ),
      ).toThrow();

      expect(() =>
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.globalDefault,
          "anthropic",
          null,
        ),
      ).toThrow();
      expect(() =>
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.globalDefault,
          null,
          "claude-sonnet-4-6",
        ),
      ).toThrow();

      expect(() =>
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.providerDefault,
          "  ",
          null,
        ),
      ).toThrow();
      expect(() =>
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.providerDefault,
          "anth:ropic",
          null,
        ),
      ).toThrow();
      expect(() =>
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.providerDefault,
          "anthropic",
          "claude-sonnet-4-6",
        ),
      ).toThrow();

      expect(() =>
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.exactModel,
          "anthropic",
          "   ",
        ),
      ).toThrow();
      expect(() =>
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.exactModel,
          "anth:ropic",
          "claude-sonnet-4-6",
        ),
      ).toThrow();
      expect(() =>
        normalizeModelPricingScopeKey(
          MODEL_PRICING_SCOPES.exactModel,
          123 as unknown as string,
          "claude-sonnet-4-6",
        ),
      ).toThrow();
    });
  });

  describe("strict Zod DTO and read-view validation", () => {
    it("validates createModelTariffDraftSchema and rejects unknown keys, negative rates, invalid cache policies, and missing SEPARATE_RATE rates", () => {
      const valid = createModelTariffDraftSchema.safeParse({
        scope: MODEL_PRICING_SCOPES.exactModel,
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        inputMicrocreditsPerMillion: "3000000",
        outputMicrocreditsPerMillion: "15000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.separateRate,
        cachedInputMicrocreditsPerMillion: "300000",
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.separateRate,
        cacheWrite5mMicrocreditsPerMillion: "3750000",
        cacheWrite1hMicrocreditsPerMillion: "6000000",
        operationalAssumptions: {
          providerPriceSource: "Anthropic list price",
          notes: "Baseline draft",
        },
      });
      expect(valid.success).toBe(true);

      // Unknown key rejected (z.strictObject)
      expect(
        createModelTariffDraftSchema.safeParse({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "1000",
          outputMicrocreditsPerMillion: "2000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          extraForbiddenField: true,
        }).success,
      ).toBe(false);

      // Negative rate rejected
      expect(
        createModelTariffDraftSchema.safeParse({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "-1",
          outputMicrocreditsPerMillion: "2000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        }).success,
      ).toBe(false);

      // INCLUDED_IN_OUTPUT rejected on cache buckets
      expect(
        createModelTariffDraftSchema.safeParse({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "1000",
          outputMicrocreditsPerMillion: "2000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        }).success,
      ).toBe(false);
      expect(
        createModelTariffDraftSchema.safeParse({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "1000",
          outputMicrocreditsPerMillion: "2000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        }).success,
      ).toBe(false);

      // Missing SEPARATE_RATE rates rejected
      expect(
        createModelTariffDraftSchema.safeParse({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "1000",
          outputMicrocreditsPerMillion: "2000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.separateRate,
        }).success,
      ).toBe(false);
      expect(
        createModelTariffDraftSchema.safeParse({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "1000",
          outputMicrocreditsPerMillion: "2000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.separateRate,
        }).success,
      ).toBe(false);
      expect(
        createModelTariffDraftSchema.safeParse({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "1000",
          outputMicrocreditsPerMillion: "2000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.separateRate,
        }).success,
      ).toBe(false);

      // Mismatched provider/model for GLOBAL_DEFAULT rejected
      expect(
        createModelTariffDraftSchema.safeParse({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          provider: "anthropic",
          inputMicrocreditsPerMillion: "1000",
          outputMicrocreditsPerMillion: "2000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        }).success,
      ).toBe(false);
    });

    it("validates updateModelTariffDraftSchema requires expectedVersion and at least one editable field", () => {
      expect(
        updateModelTariffDraftSchema.safeParse({
          expectedVersion: 1,
          inputMicrocreditsPerMillion: "3100000",
        }).success,
      ).toBe(true);

      // Empty patch rejected
      expect(
        updateModelTariffDraftSchema.safeParse({
          expectedVersion: 1,
        }).success,
      ).toBe(false);

      // Unknown field rejected
      expect(
        updateModelTariffDraftSchema.safeParse({
          expectedVersion: 1,
          inputMicrocreditsPerMillion: "3100000",
          unknownField: "nope",
        }).success,
      ).toBe(false);

      // INCLUDED_IN_OUTPUT on cacheWritePolicy rejected
      expect(
        updateModelTariffDraftSchema.safeParse({
          expectedVersion: 1,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        }).success,
      ).toBe(false);
    });

    it("validates previewModelPricingSchema & previewModelPricingResponseSchema", () => {
      expect(
        previewModelPricingSchema.safeParse({
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          effectiveAt: "2026-11-26T00:00:00Z",
          usage: {
            inputTokens: "1000000",
            outputTokens: "500000",
          },
          draftId: "draft-1",
        }).success,
      ).toBe(true);

      // Naive datetime rejected
      expect(
        previewModelPricingSchema.safeParse({
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          effectiveAt: "2026-11-26T00:00:00",
          usage: { inputTokens: "100", outputTokens: "50" },
        }).success,
      ).toBe(false);

      // Multiple tariff sources rejected
      expect(
        previewModelPricingSchema.safeParse({
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          usage: { inputTokens: "100", outputTokens: "50" },
          draftId: "draft-1",
          snapshotId: "snap-1",
        }).success,
      ).toBe(false);

      expect(
        previewModelPricingResponseSchema.safeParse({
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          allowlisted: true,
          resolvedScope: MODEL_PRICING_SCOPES.exactModel,
          normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
          source: MODEL_PRICING_PREVIEW_SOURCES.activeAssignment,
          draftId: null,
          snapshotId: "snap-1",
          assignmentId: "assign-1",
          chargeMicrocredits: "10500000",
          chargeCreditsDecimal: "10.5",
          effectiveRates: {
            inputMicrocreditsPerMillion: "3000000",
            outputMicrocreditsPerMillion: "15000000",
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
            reasoningMicrocreditsPerMillion: null,
            cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
            cachedInputMicrocreditsPerMillion: null,
            cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
            cacheWriteMicrocreditsPerMillion: null,
            cacheWrite5mMicrocreditsPerMillion: null,
            cacheWrite1hMicrocreditsPerMillion: null,
          },
          warnings: [],
          debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
        }).success,
      ).toBe(true);

      // debitMode: "ON" rejected
      expect(
        previewModelPricingResponseSchema.safeParse({
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          allowlisted: true,
          resolvedScope: MODEL_PRICING_SCOPES.exactModel,
          normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
          source: MODEL_PRICING_PREVIEW_SOURCES.activeAssignment,
          draftId: null,
          snapshotId: "snap-1",
          assignmentId: "assign-1",
          chargeMicrocredits: "10500000",
          chargeCreditsDecimal: "10.5",
          effectiveRates: {
            inputMicrocreditsPerMillion: "3000000",
            outputMicrocreditsPerMillion: "15000000",
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
            reasoningMicrocreditsPerMillion: null,
            cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
            cachedInputMicrocreditsPerMillion: null,
            cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
            cacheWriteMicrocreditsPerMillion: null,
            cacheWrite5mMicrocreditsPerMillion: null,
            cacheWrite1hMicrocreditsPerMillion: null,
          },
          warnings: [],
          debitMode: MODEL_USAGE_DEBIT_MODES.ON,
        }).success,
      ).toBe(false);
    });

    it("validates publishModelTariffDraftSchema and rejects naive datetimes and effectiveTo <= effectiveFrom", () => {
      expect(
        publishModelTariffDraftSchema.safeParse({
          idempotencyKey: "pub-123",
          requestFingerprint: "a".repeat(64),
          auditReason: "Approve Anthropic baseline pricing",
          expectedDraftVersion: 1,
          effectiveFrom: "2026-11-26T00:00:00Z",
          effectiveTo: null,
        }).success,
      ).toBe(true);

      // Naive datetime rejected
      expect(
        publishModelTariffDraftSchema.safeParse({
          idempotencyKey: "pub-123",
          requestFingerprint: "a".repeat(64),
          auditReason: "Approve Anthropic baseline pricing",
          expectedDraftVersion: 1,
          effectiveFrom: "2026-11-26T00:00:00",
          effectiveTo: null,
        }).success,
      ).toBe(false);

      // effectiveTo === effectiveFrom rejected
      expect(
        publishModelTariffDraftSchema.safeParse({
          idempotencyKey: "pub-123",
          requestFingerprint: "a".repeat(64),
          auditReason: "Approve",
          expectedDraftVersion: 1,
          effectiveFrom: "2026-11-26T00:00:00Z",
          effectiveTo: "2026-11-26T00:00:00+00:00",
        }).success,
      ).toBe(false);

      // effectiveTo < effectiveFrom rejected
      expect(
        publishModelTariffDraftSchema.safeParse({
          idempotencyKey: "pub-123",
          requestFingerprint: "a".repeat(64),
          auditReason: "Approve",
          expectedDraftVersion: 1,
          effectiveFrom: "2026-11-26T01:00:00Z",
          effectiveTo: "2026-11-26T00:00:00Z",
        }).success,
      ).toBe(false);
    });

    it("validates supersedeModelTariffAssignmentSchema enforces XOR replacementDraftId vs replacementSnapshotId and interval validity", () => {
      expect(
        supersedeModelTariffAssignmentSchema.safeParse({
          idempotencyKey: "sup-123",
          requestFingerprint: "b".repeat(64),
          auditReason: "Supersede with new snapshot",
          effectiveFrom: "2026-12-01T00:00:00Z",
          effectiveTo: null,
          replacementSnapshotId: "snap-2",
        }).success,
      ).toBe(true);

      expect(
        supersedeModelTariffAssignmentSchema.safeParse({
          idempotencyKey: "sup-124",
          requestFingerprint: "c".repeat(64),
          auditReason: "Supersede with draft publish",
          effectiveFrom: "2026-12-01T00:00:00Z",
          replacementDraftId: "draft-2",
          expectedDraftVersion: 2,
        }).success,
      ).toBe(true);

      // Neither replacement provided rejected
      expect(
        supersedeModelTariffAssignmentSchema.safeParse({
          idempotencyKey: "sup-125",
          requestFingerprint: "d".repeat(64),
          auditReason: "Invalid",
          effectiveFrom: "2026-12-01T00:00:00Z",
        }).success,
      ).toBe(false);

      // Both replacements provided rejected
      expect(
        supersedeModelTariffAssignmentSchema.safeParse({
          idempotencyKey: "sup-126",
          requestFingerprint: "e".repeat(64),
          auditReason: "Invalid",
          effectiveFrom: "2026-12-01T00:00:00Z",
          replacementDraftId: "draft-2",
          replacementSnapshotId: "snap-2",
        }).success,
      ).toBe(false);

      // effectiveTo <= effectiveFrom rejected
      expect(
        supersedeModelTariffAssignmentSchema.safeParse({
          idempotencyKey: "sup-127",
          requestFingerprint: "f".repeat(64),
          auditReason: "Invalid interval",
          effectiveFrom: "2026-12-01T00:00:00Z",
          effectiveTo: "2026-11-30T23:59:59Z",
          replacementSnapshotId: "snap-2",
        }).success,
      ).toBe(false);
    });

    it("validates adminModelPricingOverviewQuerySchema and adminModelPricingOverviewResponseSchema including debitMode guard", () => {
      expect(
        adminModelPricingOverviewQuerySchema.safeParse({
          provider: "anthropic",
          scope: MODEL_PRICING_SCOPES.exactModel,
          status: PRICING_ASSIGNMENT_STATUSES.active,
          activeAt: "2026-11-26T00:00:00Z",
        }).success,
      ).toBe(true);

      const validOverview = {
        debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
        dbUtcNow: "2026-11-26T00:00:00.000Z",
        allowlistedModels: [
          {
            role: "default",
            routeKey: "anthropic-primary",
            provider: "anthropic",
            resolvedModel: "claude-sonnet-4-6",
          },
        ],
        coverage: [
          {
            provider: "anthropic",
            resolvedModel: "claude-sonnet-4-6",
            normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
            hasCoverage: true,
            resolvedScope: MODEL_PRICING_SCOPES.exactModel,
            fallbackSource: MODEL_PRICING_SCOPES.exactModel,
            assignmentId: "assign-1",
            snapshotId: "snap-1",
            snapshotVersion: 1,
            effectiveFrom: "2026-11-26T00:00:00.000Z",
            effectiveTo: null,
            rates: {
              inputMicrocreditsPerMillion: "3000000",
              outputMicrocreditsPerMillion: "15000000",
              reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
              reasoningMicrocreditsPerMillion: null,
              cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
              cachedInputMicrocreditsPerMillion: null,
              cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
              cacheWriteMicrocreditsPerMillion: null,
              cacheWrite5mMicrocreditsPerMillion: null,
              cacheWrite1hMicrocreditsPerMillion: null,
            },
          },
        ],
        assignments: [
          {
            id: "assign-1",
            tariffSnapshotId: "snap-1",
            scope: MODEL_PRICING_SCOPES.exactModel,
            normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
            status: PRICING_ASSIGNMENT_STATUSES.active,
            version: 1,
            effectiveFrom: "2026-11-26T00:00:00.000Z",
            effectiveTo: null,
            supersededByAssignmentId: null,
            supersededBy: null,
            supersededAt: null,
            cancelledAt: null,
            auditReason: "Initial publish",
            createdBy: "admin-1",
            createdAt: "2026-11-26T00:00:00.000Z",
          },
        ],
        drafts: [
          {
            id: "draft-1",
            scope: MODEL_PRICING_SCOPES.providerDefault,
            provider: "anthropic",
            resolvedModel: null,
            normalizedScopeKey: "PROVIDER_DEFAULT:anthropic",
            status: CUSTOMER_TARIFF_DRAFT_STATUSES.draft,
            version: 1,
            inputMicrocreditsPerMillion: "3000000",
            outputMicrocreditsPerMillion: "15000000",
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
            createdAt: "2026-11-26T00:00:00.000Z",
            updatedAt: "2026-11-26T00:00:00.000Z",
          },
        ],
        snapshots: [
          {
            id: "snap-1",
            sourceDraftId: "draft-0",
            scope: MODEL_PRICING_SCOPES.exactModel,
            provider: "anthropic",
            resolvedModel: "claude-sonnet-4-6",
            normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
            version: 1,
            accountingUnitVersion: 1,
            inputMicrocreditsPerMillion: "3000000",
            outputMicrocreditsPerMillion: "15000000",
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
            reasoningMicrocreditsPerMillion: null,
            cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
            cachedInputMicrocreditsPerMillion: null,
            cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
            cacheWriteMicrocreditsPerMillion: null,
            cacheWrite5mMicrocreditsPerMillion: null,
            cacheWrite1hMicrocreditsPerMillion: null,
            idempotencyKey: "pub-0",
            requestFingerprint: "a".repeat(64),
            publishedBy: "admin-1",
            auditReason: "Initial publish",
            publishedAt: "2026-11-26T00:00:00.000Z",
            createdAt: "2026-11-26T00:00:00.000Z",
          },
        ],
      };

      expect(
        adminModelPricingOverviewResponseSchema.safeParse(validOverview).success,
      ).toBe(true);

      // debitMode: "ON" rejected
      expect(
        adminModelPricingOverviewResponseSchema.safeParse({
          ...validOverview,
          debitMode: MODEL_USAGE_DEBIT_MODES.ON,
        }).success,
      ).toBe(false);

      // Unknown top-level key rejected
      expect(
        adminModelPricingOverviewResponseSchema.safeParse({
          ...validOverview,
          unknownTopKey: 123,
        }).success,
      ).toBe(false);

      // Publish & supersede response schemas exist and validate cleanly
      expect(
        publishModelTariffDraftResponseSchema.safeParse({
          draft: validOverview.drafts[0],
          snapshot: validOverview.snapshots[0],
          assignment: validOverview.assignments[0],
          auditEventId: "audit-1",
          idempotentReplay: false,
        }).success,
      ).toBe(true);

      expect(
        supersedeModelTariffAssignmentResponseSchema.safeParse({
          supersededAssignment: validOverview.assignments[0],
          replacementAssignment: validOverview.assignments[0],
          replacementSnapshot: validOverview.snapshots[0],
          auditEventId: "audit-2",
          idempotentReplay: false,
        }).success,
      ).toBe(true);
    });

    it("rejects leading-zero rate strings in nonNegativeMicrocreditIntegerStringSchema while accepting canonical '0' and positive integers", () => {
      expect(nonNegativeMicrocreditIntegerStringSchema.safeParse("0").success).toBe(true);
      expect(
        nonNegativeMicrocreditIntegerStringSchema.safeParse("3000000").success,
      ).toBe(true);

      expect(
        nonNegativeMicrocreditIntegerStringSchema.safeParse("00").success,
      ).toBe(false);
      expect(
        nonNegativeMicrocreditIntegerStringSchema.safeParse("01").success,
      ).toBe(false);
      expect(
        nonNegativeMicrocreditIntegerStringSchema.safeParse("0003000000").success,
      ).toBe(false);
      expect(
        nonNegativeMicrocreditIntegerStringSchema.safeParse("-1").success,
      ).toBe(false);
      expect(
        nonNegativeMicrocreditIntegerStringSchema.safeParse("").success,
      ).toBe(false);
    });
  });
});
