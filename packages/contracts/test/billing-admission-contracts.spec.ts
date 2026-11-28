import { describe, expect, it } from "@jest/globals";
import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  BILLING_ERROR_CODES,
  BILLING_ROLLOUT_MODES,
  DEFAULT_ADMISSION_TTL_SECONDS,
  MODEL_USAGE_DEBIT_MODES,
  PILOT_MAX_IN_FLIGHT_INVOCATIONS_PER_WALLET,
  billableInvocationAdmissionConsumeSchema,
  billableInvocationAdmissionRequestSchema,
  billableInvocationAdmissionResponseSchema,
  computeAdmissionRequestFingerprint,
  deriveAdmissionCapabilityDigest,
  deriveAdmissionCapabilitySecret,
} from "../src/billing/index.ts";

describe("WP8 Phase B Billing Admission Contracts", () => {
  it("enforces pilot concurrency slot limit of 1 in-flight invocation per wallet (AD-07, ADR-028)", () => {
    expect(PILOT_MAX_IN_FLIGHT_INVOCATIONS_PER_WALLET).toBe(1);
    expect(DEFAULT_ADMISSION_TTL_SECONDS).toBe(300);
  });

  it("strictly decouples server rollout mode from debit feature gate mode", () => {
    expect(BILLING_ROLLOUT_MODES).toEqual({
      TELEMETRY_ONLY: "TELEMETRY_ONLY",
      SHADOW_PRICING: "SHADOW_PRICING",
      ADMISSION_REQUIRED: "ADMISSION_REQUIRED",
      SHADOW_SETTLEMENT: "SHADOW_SETTLEMENT",
      DEBIT_ENABLED: "DEBIT_ENABLED",
    });

    expect(MODEL_USAGE_DEBIT_MODES).toEqual({
      OFF: "OFF",
      SHADOW: "SHADOW",
      ON: "ON",
    });

    // Invariant: ADMISSION_REQUIRED is a rollout mode, NOT a debit mode
    expect("ADMISSION_REQUIRED" in MODEL_USAGE_DEBIT_MODES).toBe(false);
    expect("ADMISSION_REQUIRED" in BILLING_ROLLOUT_MODES).toBe(true);
  });

  it("defines canonical error codes for admission control and per-wallet slot limit", () => {
    expect(BILLING_ERROR_CODES.paymentRequired).toBe("BILLING_PAYMENT_REQUIRED");
    expect(BILLING_ERROR_CODES.walletConcurrencyLimitExceeded).toBe(
      "BILLING_WALLET_CONCURRENCY_LIMIT_EXCEEDED",
    );
    expect(BILLING_ERROR_CODES.admissionNotFound).toBe("BILLING_ADMISSION_NOT_FOUND");
    expect(BILLING_ERROR_CODES.admissionExpired).toBe("BILLING_ADMISSION_EXPIRED");
    expect(BILLING_ERROR_CODES.admissionInvalidState).toBe(
      "BILLING_ADMISSION_INVALID_STATE",
    );
    expect(BILLING_ERROR_CODES.admissionCapabilityMismatch).toBe(
      "BILLING_ADMISSION_CAPABILITY_MISMATCH",
    );
    expect(BILLING_ERROR_CODES.admissionContextMismatch).toBe(
      "BILLING_ADMISSION_CONTEXT_MISMATCH",
    );
  });

  it("validates valid and invalid admission request schemas", () => {
    const valid = {
      admissionRequestId: "req-12345",
      logicalOperationId: "op-67890",
      attemptOrdinal: 1,
      runId: "run-abcde",
      assessmentId: "asm-11111",
      executionLeaseToken: "lease-token-xyz",
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-3-5-sonnet",
      inputTokensUpperBound: 100000,
      outputTokensUpperBound: 4096,
    };

    const parsed = billableInvocationAdmissionRequestSchema.parse(valid);
    expect(parsed.admissionRequestId).toBe("req-12345");
    expect(parsed.attemptOrdinal).toBe(1);

    // Rejects non-positive attempt ordinal
    expect(() =>
      billableInvocationAdmissionRequestSchema.parse({
        ...valid,
        attemptOrdinal: 0,
      }),
    ).toThrow();

    // Rejects missing runId
    expect(() =>
      billableInvocationAdmissionRequestSchema.parse({
        ...valid,
        runId: "",
      }),
    ).toThrow();
  });

  it("produces deterministic canonical fingerprints invariant to key order, whitespace, and provider casing", () => {
    const req1 = {
      admissionRequestId: "req-1",
      logicalOperationId: "op-1",
      attemptOrdinal: 1,
      runId: "run-1",
      assessmentId: "asm-1",
      executionLeaseToken: "lease-1",
      agentRole: "root",
      operationType: "INFERENCE",
      requestedProvider: "OpenAI",
      requestedModel: "gpt-4o",
      inputTokensUpperBound: 50000,
      outputTokensUpperBound: 2048,
    };

    const req2 = {
      // Reordered keys, trailing whitespace, lowercase provider
      outputTokensUpperBound: 2048,
      inputTokensUpperBound: 50000,
      requestedModel: "gpt-4o",
      requestedProvider: "openai   ",
      operationType: "INFERENCE",
      agentRole: "root",
      executionLeaseToken: "lease-1",
      assessmentId: "asm-1",
      runId: "run-1",
      attemptOrdinal: 1,
      logicalOperationId: "op-1",
      admissionRequestId: "req-1",
    };

    const fp1 = computeAdmissionRequestFingerprint(req1);
    const fp2 = computeAdmissionRequestFingerprint(req2);

    expect(fp1).toHaveLength(64);
    expect(fp1).toBe(fp2);

    // Modified property changes fingerprint
    const fp3 = computeAdmissionRequestFingerprint({
      ...req1,
      attemptOrdinal: 2,
    });
    expect(fp3).not.toBe(fp1);
  });

  it("derives deterministic HMAC capability secret and verifiable SHA-256 digest", () => {
    const serverSecret = "super-secret-cluster-master-key-32b";
    const reqId = "req-uuid-111";
    const fp = "a".repeat(64);
    const invId = "inv-uuid-222";

    const capSecret1 = deriveAdmissionCapabilitySecret(
      serverSecret,
      reqId,
      fp,
      invId,
    );
    const capSecret2 = deriveAdmissionCapabilitySecret(
      serverSecret,
      reqId,
      fp,
      invId,
    );

    expect(capSecret1).toHaveLength(64);
    expect(capSecret1).toBe(capSecret2);

    const digest1 = deriveAdmissionCapabilityDigest(capSecret1);
    const digest2 = deriveAdmissionCapabilityDigest(capSecret2);
    expect(digest1).toHaveLength(64);
    expect(digest1).toBe(digest2);

    // Rejects empty inputs
    expect(() =>
      deriveAdmissionCapabilitySecret("", reqId, fp, invId),
    ).toThrow();
    expect(() => deriveAdmissionCapabilityDigest("")).toThrow();
  });

  it("validates admission response and CAS consume schemas", () => {
    const responsePayload = {
      admissionId: "adm-123",
      invocationId: "inv-456",
      admissionRequestId: "req-789",
      fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
      state: ADMISSION_STATES.ADMITTED,
      rolloutMode: BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED,
      debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
      resolvedProvider: "anthropic",
      resolvedModel: "claude-3-5-sonnet",
      tariffSnapshotId: "snp-abc",
      tariffAssignmentId: "asg-def",
      appliedMaxOutputTokens: 4096,
      maximumExposureMicrocredits: "8192000",
      capabilityToken: "b".repeat(64),
      admittedAt: "2026-11-26T12:00:00.000Z",
      expiresAt: "2026-11-26T12:05:00.000Z",
    };

    const parsedResp =
      billableInvocationAdmissionResponseSchema.parse(responsePayload);
    expect(parsedResp.maximumExposureMicrocredits).toBe("8192000");
    expect(parsedResp.rolloutMode).toBe("ADMISSION_REQUIRED");
    expect(parsedResp.debitMode).toBe("OFF");

    const consumePayload = {
      admissionId: "adm-123",
      invocationId: "inv-456",
      capabilityToken: "b".repeat(64),
    };

    const parsedConsume =
      billableInvocationAdmissionConsumeSchema.parse(consumePayload);
    expect(parsedConsume.admissionId).toBe("adm-123");
  });
});
