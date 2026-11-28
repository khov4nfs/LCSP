import { describe, expect, it, jest } from "@jest/globals";
import type { ConfigService } from "@nestjs/config";
import {
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  PRICING_ASSIGNMENT_STATUSES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import type { AppConfig } from "../../../../../config/config.types.js";
import { BillingDomainError } from "../../../domain/billing.errors.js";
import type { ModelPricingRepositoryPort } from "../../../domain/repositories/model-pricing.port.js";
import { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "../../shared/runtime-model-allowlist.service.js";
import { GetModelPricingOverviewQuery } from "./get-model-pricing-overview.query.js";
import { GetModelPricingOverviewHandler } from "./get-model-pricing-overview.handler.js";

describe("GetModelPricingOverviewHandler", () => {
  const dbUtcNow = new Date("2026-11-26T12:00:00.000Z");

  function makeAllowlist() {
    return new RuntimeModelAllowlistService(undefined, {
      routesYaml: `
version: 1
routes:
  anthropic-primary:
    provider: anthropic
    model: claude-sonnet-4-6
  openai-primary:
    provider: openai
    model: gpt-5
roles:
  default: anthropic-primary
  claim-author: openai-primary
fallbacks: {}
`,
    });
  }

  function makeConfig(mode: string): ConfigService<AppConfig, true> {
    return {
      get: jest.fn(() => ({ mode })),
    } as unknown as ConfigService<AppConfig, true>;
  }

  it("orders coverage by EXACT_MODEL -> PROVIDER_DEFAULT -> GLOBAL_DEFAULT and exposes debitMode=OFF", async () => {
    const allowlist = makeAllowlist();
    const calculator = new ModelPricingCalculatorService(allowlist);

    const listOverviewData = jest
      .fn<ModelPricingRepositoryPort["listOverviewData"]>()
      .mockResolvedValue({
        dbUtcNow,
        drafts: [],
        snapshots: [
          {
            id: "snap-global",
            sourceDraftId: null,
            scope: MODEL_PRICING_SCOPES.globalDefault,
            provider: null,
            resolvedModel: null,
            normalizedScopeKey: "GLOBAL_DEFAULT",
            version: 1,
            accountingUnitVersion: 1,
            inputMicrocreditsPerMillion: 5_000_000n,
            outputMicrocreditsPerMillion: 20_000_000n,
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
            reasoningMicrocreditsPerMillion: null,
            cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
            cachedInputMicrocreditsPerMillion: null,
            cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
            cacheWriteMicrocreditsPerMillion: null,
            cacheWrite5mMicrocreditsPerMillion: null,
            cacheWrite1hMicrocreditsPerMillion: null,
            idempotencyKey: "k-global",
            requestFingerprint: "a".repeat(64),
            publishedBy: "admin-1",
            auditReason: "Global fallback",
            publishedAt: dbUtcNow,
            createdAt: dbUtcNow,
          },
          {
            id: "snap-exact-anthropic",
            sourceDraftId: null,
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
            idempotencyKey: "k-exact",
            requestFingerprint: "b".repeat(64),
            publishedBy: "admin-1",
            auditReason: "Exact Anthropic",
            publishedAt: dbUtcNow,
            createdAt: dbUtcNow,
          },
        ],
        assignments: [
          {
            id: "assign-global",
            tariffSnapshotId: "snap-global",
            scope: MODEL_PRICING_SCOPES.globalDefault,
            normalizedScopeKey: "GLOBAL_DEFAULT",
            effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
            effectiveTo: null,
            supersededByAssignmentId: null,
            supersededBy: null,
            supersededAt: null,
            cancelledAt: null,
            supersedeIdempotencyKey: null,
            supersedeRequestFingerprint: null,
            version: 1,
            auditReason: "Global fallback",
            createdBy: "admin-1",
            createdAt: dbUtcNow,
          },
          {
            id: "assign-exact-anthropic",
            tariffSnapshotId: "snap-exact-anthropic",
            scope: MODEL_PRICING_SCOPES.exactModel,
            normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
            effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
            effectiveTo: null,
            supersededByAssignmentId: null,
            supersededBy: null,
            supersededAt: null,
            cancelledAt: null,
            supersedeIdempotencyKey: null,
            supersedeRequestFingerprint: null,
            version: 1,
            auditReason: "Exact Anthropic",
            createdBy: "admin-1",
            createdAt: dbUtcNow,
          },
          {
            id: "assign-scheduled",
            tariffSnapshotId: "snap-exact-anthropic",
            scope: MODEL_PRICING_SCOPES.exactModel,
            normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
            effectiveFrom: new Date("2026-12-01T00:00:00.000Z"),
            effectiveTo: null,
            supersededByAssignmentId: null,
            supersededBy: null,
            supersededAt: null,
            cancelledAt: null,
            supersedeIdempotencyKey: null,
            supersedeRequestFingerprint: null,
            version: 1,
            auditReason: "Future Anthropic",
            createdBy: "admin-1",
            createdAt: dbUtcNow,
          },
        ],
      });

    const repo = { listOverviewData } as unknown as ModelPricingRepositoryPort;
    const handler = new GetModelPricingOverviewHandler(
      repo,
      allowlist,
      calculator,
      makeConfig(MODEL_USAGE_DEBIT_MODES.OFF),
    );

    const overview = await handler.execute(
      new GetModelPricingOverviewQuery({}),
    );

    expect(overview.debitMode).toBe(MODEL_USAGE_DEBIT_MODES.OFF);
    expect(overview.coverage).toHaveLength(2);
    expect(overview.coverage[0]?.resolvedScope).toBe(
      MODEL_PRICING_SCOPES.exactModel,
    );
    expect(overview.coverage[0]?.resolvedModel).toBe("claude-sonnet-4-6");
    expect(overview.coverage[1]?.resolvedScope).toBe(
      MODEL_PRICING_SCOPES.globalDefault,
    );
    expect(overview.coverage[1]?.resolvedModel).toBe("gpt-5");
    expect(
      overview.assignments.find((a) => a.id === "assign-scheduled")?.status,
    ).toBe(PRICING_ASSIGNMENT_STATUSES.scheduled);
  });

  it("surfaces hasCoverage=false when no active assignment covers an allowlisted model and fails closed when MODEL_USAGE_DEBIT=ON", async () => {
    const allowlist = makeAllowlist();
    const calculator = new ModelPricingCalculatorService(allowlist);
    const listOverviewData = jest
      .fn<ModelPricingRepositoryPort["listOverviewData"]>()
      .mockResolvedValue({
        dbUtcNow,
        drafts: [],
        snapshots: [],
        assignments: [],
      });
    const repo = { listOverviewData } as unknown as ModelPricingRepositoryPort;

    const handlerOff = new GetModelPricingOverviewHandler(
      repo,
      allowlist,
      calculator,
      makeConfig(MODEL_USAGE_DEBIT_MODES.OFF),
    );
    const overview = await handlerOff.execute(
      new GetModelPricingOverviewQuery({}),
    );
    expect(overview.coverage.every((row) => row.hasCoverage === false)).toBe(
      true,
    );

    const handlerOn = new GetModelPricingOverviewHandler(
      repo,
      allowlist,
      calculator,
      makeConfig(MODEL_USAGE_DEBIT_MODES.ON),
    );
    await expect(
      handlerOn.execute(new GetModelPricingOverviewQuery({})),
    ).rejects.toBeInstanceOf(BillingDomainError);
  });
});
