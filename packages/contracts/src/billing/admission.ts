import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  BILLING_ROLLOUT_MODES,
  MODEL_USAGE_DEBIT_MODES,
  type AdmissionFundingPrincipal,
  type AdmissionState,
  type BillingRolloutMode,
  type ModelUsageDebitMode,
} from "./usage-settlement.ts";

/**
 * Concurrency guard: pilot limits each wallet to 1 in-flight billable model call (AD-07, ADR-028).
 * This limits concurrent model invocations in flight, NOT the number of open assessments.
 */
export const PILOT_MAX_IN_FLIGHT_INVOCATIONS_PER_WALLET = 1;

/**
 * Default admission capability time-to-live before transitioning to EXPIRED if not consumed.
 */
export const DEFAULT_ADMISSION_TTL_SECONDS = 300;

/**
 * Canonical Zod schema for worker admission requests.
 */
export const billableInvocationAdmissionRequestSchema = z.object({
  admissionRequestId: z.string().trim().min(1).max(200),
  logicalOperationId: z.string().trim().min(1).max(200),
  attemptOrdinal: z.number().int().min(1),
  runId: z.string().trim().min(1).max(200),
  assessmentId: z.string().trim().min(1).max(200).optional(),
  preparationRunId: z.string().trim().min(1).max(200).optional(),
  executionLeaseToken: z.string().trim().min(1).max(500).optional(),
  agentRole: z.string().trim().min(1).max(100),
  operationType: z.string().trim().min(1).max(100),
  requestedProvider: z.string().trim().min(1).max(100),
  requestedModel: z.string().trim().min(1).max(200),
  inputTokensUpperBound: z.number().int().nonnegative().optional(),
  outputTokensUpperBound: z.number().int().positive().optional(),
});

export type BillableInvocationAdmissionRequest = z.infer<
  typeof billableInvocationAdmissionRequestSchema
>;

/**
 * Canonical Zod schema for server admission responses.
 */
export const billableInvocationAdmissionResponseSchema = z.object({
  admissionId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  admissionRequestId: z.string().trim().min(1).max(200),
  fundingPrincipal: z.nativeEnum(ADMISSION_FUNDING_PRINCIPALS),
  state: z.nativeEnum(ADMISSION_STATES),
  rolloutMode: z.nativeEnum(BILLING_ROLLOUT_MODES),
  debitMode: z.nativeEnum(MODEL_USAGE_DEBIT_MODES),
  resolvedProvider: z.string().trim().min(1).max(100),
  resolvedModel: z.string().trim().min(1).max(200),
  tariffSnapshotId: z.string().trim().min(1).max(200).nullable(),
  tariffAssignmentId: z.string().trim().min(1).max(200).nullable(),
  sponsorshipPolicySnapshotId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable()
    .optional(),
  appliedMaxOutputTokens: z.number().int().positive(),
  maximumExposureMicrocredits: z.string().regex(/^\d+$/),
  capabilityToken: z.string().trim().min(32).max(128),
  admittedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type BillableInvocationAdmissionResponse = z.infer<
  typeof billableInvocationAdmissionResponseSchema
>;

/**
 * Canonical Zod schema for CAS consumption before worker physical provider dispatch.
 */
export const billableInvocationAdmissionConsumeSchema = z.object({
  admissionId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  capabilityToken: z.string().trim().min(32).max(128),
});

export type BillableInvocationAdmissionConsume = z.infer<
  typeof billableInvocationAdmissionConsumeSchema
>;

/**
 * Canonical Zod schema for worker-issued in-flight lease heartbeat / extension requests.
 */
export const billableInvocationHeartbeatRequestSchema = z.object({
  admissionId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  capabilityToken: z.string().trim().min(32).max(128),
  extensionSeconds: z.number().int().positive().max(3600).optional(),
});

export type BillableInvocationHeartbeatRequest = z.infer<
  typeof billableInvocationHeartbeatRequestSchema
>;

/**
 * Business purpose: Calculate a canonical, secret-free SHA-256 fingerprint of an admission request for idempotency.
 * Business rules:
 * - Normalized fields: lowercase provider/model, trimmed strings, stable key ordering.
 * - Invariant to non-semantic formatting or caller property order.
 * Execution flow:
 * 1. Normalize and extract canonical properties.
 * 2. Format as sorted, compact JSON without whitespace.
 * 3. Compute and return SHA-256 hex digest.
 * Failure cases:
 * - Throws Error if required fields (admissionRequestId, runId, logicalOperationId) are missing.
 * Side effects:
 * - Pure computation; no external I/O.
 */
export function computeAdmissionRequestFingerprint(
  input: BillableInvocationAdmissionRequest,
): string {
  const normalized = {
    admissionRequestId: input.admissionRequestId.trim(),
    agentRole: input.agentRole.trim(),
    assessmentId: input.assessmentId?.trim() ?? null,
    attemptOrdinal: input.attemptOrdinal,
    executionLeaseToken: input.executionLeaseToken?.trim() ?? null,
    inputTokensUpperBound: input.inputTokensUpperBound ?? null,
    logicalOperationId: input.logicalOperationId.trim(),
    operationType: input.operationType.trim(),
    outputTokensUpperBound: input.outputTokensUpperBound ?? null,
    preparationRunId: input.preparationRunId?.trim() ?? null,
    requestedModel: input.requestedModel.trim(),
    requestedProvider: input.requestedProvider.trim().toLowerCase(),
    runId: input.runId.trim(),
  };

  const canonicalJson = JSON.stringify(
    normalized,
    Object.keys(normalized).sort(),
  );
  return createHash("sha256").update(canonicalJson).digest("hex");
}

/**
 * Business purpose: Derive a high-entropy, deterministic capability secret for worker admission and recovery.
 * Business rules:
 * - Uses HMAC-SHA256 with server master secret over admissionRequestId, requestFingerprint, and invocationId.
 * - Enables identical recovery upon lost-response retries without storing plaintext secret in the database.
 * Execution flow:
 * 1. Validate non-empty inputs.
 * 2. Hash payload with HMAC-SHA256 using server master key.
 * 3. Return 64-character hexadecimal capability secret string.
 * Failure cases:
 * - Throws Error if serverSecret or any input identifier is empty or whitespace.
 * Side effects:
 * - Pure cryptographic HMAC calculation; no side effects.
 */
export function deriveAdmissionCapabilitySecret(
  serverSecret: string,
  admissionRequestId: string,
  requestFingerprint: string,
  invocationId: string,
): string {
  if (!serverSecret || !serverSecret.trim()) {
    throw new Error("Server master secret must not be empty");
  }
  if (!admissionRequestId?.trim() || !requestFingerprint?.trim() || !invocationId?.trim()) {
    throw new Error("Capability derivation requires non-empty requestId, fingerprint, and invocationId");
  }

  const payload = `${admissionRequestId.trim()}:${requestFingerprint.trim()}:${invocationId.trim()}`;
  return createHmac("sha256", serverSecret.trim()).update(payload).digest("hex");
}

/**
 * Business purpose: Compute the SHA-256 digest of a capability secret for persistence and CAS matching.
 * Business rules:
 * - Only the 64-character hex digest is stored in PostgreSQL (`BillableInvocationAdmission.capabilityDigest`).
 * - Raw capability secrets are never stored at rest in the database.
 * Execution flow:
 * 1. Hash the capability secret string with SHA-256.
 * 2. Return 64-character hexadecimal digest string.
 * Failure cases:
 * - Throws Error if capabilitySecret is empty or whitespace.
 * Side effects:
 * - Pure cryptographic hash calculation; no side effects.
 */
export function deriveAdmissionCapabilityDigest(capabilitySecret: string): string {
  if (!capabilitySecret || !capabilitySecret.trim()) {
    throw new Error("Capability secret must not be empty");
  }
  return createHash("sha256").update(capabilitySecret.trim()).digest("hex");
}
