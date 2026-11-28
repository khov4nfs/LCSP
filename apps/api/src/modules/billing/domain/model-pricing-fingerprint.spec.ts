import { describe, expect, it } from "@jest/globals";
import {
  MODEL_PRICING_SCOPES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";
import {
  MODEL_PRICING_FINGERPRINT_ACTIONS,
  computeModelPricingRequestFingerprint,
} from "./model-pricing-fingerprint.js";

describe("computeModelPricingRequestFingerprint", () => {
  const basePublishPayload = {
    action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
    draftId: "draft-1",
    expectedDraftVersion: 2,
    scope: MODEL_PRICING_SCOPES.exactModel,
    provider: "anthropic",
    resolvedModel: "claude-sonnet-4-6",
    effectiveFrom: "2026-12-01T00:00:00Z",
    effectiveTo: null,
    auditReason: "Approve Anthropic tariff",
    rates: {
      inputMicrocreditsPerMillion: "3000000",
      outputMicrocreditsPerMillion: "15000000",
      reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      reasoningMicrocreditsPerMillion: null,
      cachedInputPolicy: TOKEN_BUCKET_POLICIES.separateRate,
      cachedInputMicrocreditsPerMillion: "300000",
      cacheWritePolicy: TOKEN_BUCKET_POLICIES.separateRate,
      cacheWriteMicrocreditsPerMillion: null,
      cacheWrite5mMicrocreditsPerMillion: "3750000",
      cacheWrite1hMicrocreditsPerMillion: "6000000",
    },
  };

  it("produces an identical 64-char SHA-256 hex digest invariant to key order, undefined properties, provider casing, and UTC ISO formatting", () => {
    const digestA = computeModelPricingRequestFingerprint(basePublishPayload);
    expect(digestA).toMatch(/^[0-9a-f]{64}$/);

    const digestB = computeModelPricingRequestFingerprint({
      rates: {
        cacheWrite1hMicrocreditsPerMillion: "6000000",
        cacheWrite5mMicrocreditsPerMillion: "3750000",
        cacheWriteMicrocreditsPerMillion: undefined,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.separateRate,
        cachedInputMicrocreditsPerMillion: "300000",
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.separateRate,
        reasoningMicrocreditsPerMillion: undefined,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        outputMicrocreditsPerMillion: "15000000",
        inputMicrocreditsPerMillion: "3000000",
      },
      auditReason: "  Approve Anthropic tariff  ",
      effectiveTo: undefined,
      effectiveFrom: "2026-12-01T07:00:00+07:00",
      resolvedModel: "  claude-sonnet-4-6 ",
      provider: "  ANTHROPIC ",
      scope: MODEL_PRICING_SCOPES.exactModel,
      expectedDraftVersion: 2,
      draftId: " draft-1 ",
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
    });

    expect(digestB).toBe(digestA);
  });

  it("produces a distinct digest whenever any publish or supersede field changes", () => {
    const baseDigest =
      computeModelPricingRequestFingerprint(basePublishPayload);

    expect(
      computeModelPricingRequestFingerprint({
        ...basePublishPayload,
        rates: {
          ...basePublishPayload.rates,
          inputMicrocreditsPerMillion: "3000001",
        },
      }),
    ).not.toBe(baseDigest);

    expect(
      computeModelPricingRequestFingerprint({
        ...basePublishPayload,
        effectiveTo: "2027-01-01T00:00:00Z",
      }),
    ).not.toBe(baseDigest);

    expect(
      computeModelPricingRequestFingerprint({
        ...basePublishPayload,
        expectedDraftVersion: 3,
      }),
    ).not.toBe(baseDigest);

    expect(
      computeModelPricingRequestFingerprint({
        ...basePublishPayload,
        auditReason: "Different reason",
      }),
    ).not.toBe(baseDigest);

    const supersedeA = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment,
      assignmentId: "assign-1",
      effectiveFrom: "2026-12-15T00:00:00Z",
      effectiveTo: null,
      replacementDraftId: "draft-2",
      replacementSnapshotId: null,
      auditReason: "Rotate pricing",
    });
    const supersedeB = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment,
      assignmentId: "assign-1",
      effectiveFrom: "2026-12-15T00:00:00+00:00",
      effectiveTo: undefined,
      replacementDraftId: undefined,
      replacementSnapshotId: "snap-2",
      auditReason: "Rotate pricing",
    });

    expect(supersedeA).toMatch(/^[0-9a-f]{64}$/);
    expect(supersedeB).toMatch(/^[0-9a-f]{64}$/);
    expect(supersedeA).not.toBe(supersedeB);
    expect(supersedeA).not.toBe(baseDigest);
  });

  it("canonicalizes leading-zero numeric rate strings identically to canonical strings and bigint rates", () => {
    const canonicalDigest =
      computeModelPricingRequestFingerprint(basePublishPayload);

    const leadingZeroDigest = computeModelPricingRequestFingerprint({
      ...basePublishPayload,
      rates: {
        ...basePublishPayload.rates,
        inputMicrocreditsPerMillion: "0003000000",
        outputMicrocreditsPerMillion: "0015000000",
        cachedInputMicrocreditsPerMillion: "00300000",
        cacheWrite5mMicrocreditsPerMillion: "03750000",
        cacheWrite1hMicrocreditsPerMillion: "0006000000",
      },
    });

    const bigintDigest = computeModelPricingRequestFingerprint({
      ...basePublishPayload,
      rates: {
        ...basePublishPayload.rates,
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        cachedInputMicrocreditsPerMillion: 300_000n,
        cacheWrite5mMicrocreditsPerMillion: 3_750_000n,
        cacheWrite1hMicrocreditsPerMillion: 6_000_000n,
      },
    });

    expect(leadingZeroDigest).toBe(canonicalDigest);
    expect(bigintDigest).toBe(canonicalDigest);

    const zeroStringDigest = computeModelPricingRequestFingerprint({
      ...basePublishPayload,
      rates: {
        ...basePublishPayload.rates,
        cachedInputMicrocreditsPerMillion: "0",
      },
    });
    const zeroLeadingDigest = computeModelPricingRequestFingerprint({
      ...basePublishPayload,
      rates: {
        ...basePublishPayload.rates,
        cachedInputMicrocreditsPerMillion: "00",
      },
    });
    const zeroBigintDigest = computeModelPricingRequestFingerprint({
      ...basePublishPayload,
      rates: {
        ...basePublishPayload.rates,
        cachedInputMicrocreditsPerMillion: 0n,
      },
    });

    expect(zeroLeadingDigest).toBe(zeroStringDigest);
    expect(zeroBigintDigest).toBe(zeroStringDigest);
  });
});
