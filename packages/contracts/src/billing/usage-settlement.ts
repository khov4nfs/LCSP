/**
 * Why: WP8 Phase A/A2 introduces direct-credit usage admission, completion/evaluation separation,
 * and a production feature gate (`MODEL_USAGE_DEBIT_MODES`) that starts at `OFF` so schema and
 * accounting boundaries can ship safely before live debit activation.
 * How: Every closed domain value set uses `as const` objects with `SCREAMING_SNAKE_CASE` values
 * and derived union types (no TypeScript `enum` or direct string-literal unions).
 * Invariants: `PROVIDER_COMPLETION_STATES` and `OUTPUT_EVALUATION_STATES` must remain 100%
 * identical to `deepagents/middleware/usage_metering.py`, and `ADMISSION_STATES` must match
 * `docs/specs/domain-state-machines.md`.
 */

/**
 * Operational rollout mode for model-usage microcredit debiting.
 * Defaults to `OFF` in WP8 Phase A/A2 until Phase B+ rollout gates are enabled.
 */
export const MODEL_USAGE_DEBIT_MODES = {
  OFF: "OFF",
  SHADOW: "SHADOW",
  ON: "ON",
} as const;

export type ModelUsageDebitMode =
  (typeof MODEL_USAGE_DEBIT_MODES)[keyof typeof MODEL_USAGE_DEBIT_MODES];

/**
 * Server-authoritative monotonic rollout mode (ADR-028 lines 208-214).
 * Strictly decoupled from financial debit mode (`MODEL_USAGE_DEBIT_MODES`).
 * Progression: TELEMETRY_ONLY → SHADOW_PRICING → ADMISSION_REQUIRED → SHADOW_SETTLEMENT → DEBIT_ENABLED.
 */
export const BILLING_ROLLOUT_MODES = {
  TELEMETRY_ONLY: "TELEMETRY_ONLY",
  SHADOW_PRICING: "SHADOW_PRICING",
  ADMISSION_REQUIRED: "ADMISSION_REQUIRED",
  SHADOW_SETTLEMENT: "SHADOW_SETTLEMENT",
  DEBIT_ENABLED: "DEBIT_ENABLED",
} as const;

export type BillingRolloutMode =
  (typeof BILLING_ROLLOUT_MODES)[keyof typeof BILLING_ROLLOUT_MODES];

/**
 * Canonical provider-level completion states, kept separate from downstream output quality
 * evaluation (`OUTPUT_EVALUATION_STATES`). Mirrors `deepagents/middleware/usage_metering.py`.
 */
export const PROVIDER_COMPLETION_STATES = {
  COMPLETED: "COMPLETED",
  MAX_TOKENS: "MAX_TOKENS",
  TRUNCATED: "TRUNCATED",
  FAILED: "FAILED",
  OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
} as const;

export type ProviderCompletionState =
  (typeof PROVIDER_COMPLETION_STATES)[keyof typeof PROVIDER_COMPLETION_STATES];

/**
 * Canonical downstream output-evaluation states, independent of provider completion status.
 * Mirrors `deepagents/middleware/usage_metering.py`.
 */
export const OUTPUT_EVALUATION_STATES = {
  ACCEPTED: "ACCEPTED",
  SCHEMA_INVALID: "SCHEMA_INVALID",
  DOMAIN_REJECTED: "DOMAIN_REJECTED",
  NOT_EVALUATED: "NOT_EVALUATED",
} as const;

export type OutputEvaluationState =
  (typeof OUTPUT_EVALUATION_STATES)[keyof typeof OUTPUT_EVALUATION_STATES];

/**
 * Canonical ledger entry sources recorded in `CreditLedgerEntry` for prepaid credits,
 * usage settlement debits, compensations, and goodwill adjustments.
 */
export const CREDIT_LEDGER_SOURCES = {
  BILLING_ORDER_CREDIT: "BILLING_ORDER_CREDIT",
  MODEL_USAGE_DEBIT: "MODEL_USAGE_DEBIT",
  COMPENSATION: "COMPENSATION",
  GOODWILL_CREDIT: "GOODWILL_CREDIT",
} as const;

export type CreditLedgerSource =
  (typeof CREDIT_LEDGER_SOURCES)[keyof typeof CREDIT_LEDGER_SOURCES];

/**
 * Funding principal responsible for a `BillableInvocationAdmission`.
 */
export const ADMISSION_FUNDING_PRINCIPALS = {
  CUSTOMER_WALLET: "CUSTOMER_WALLET",
  PLATFORM_SPONSORED: "PLATFORM_SPONSORED",
} as const;

export type AdmissionFundingPrincipal =
  (typeof ADMISSION_FUNDING_PRINCIPALS)[keyof typeof ADMISSION_FUNDING_PRINCIPALS];

/**
 * Canonical lifecycle states for `BillableInvocationAdmission` (`docs/specs/domain-state-machines.md`).
 */
export const ADMISSION_STATES = {
  REQUESTED: "REQUESTED",
  ADMITTED: "ADMITTED",
  REJECTED: "REJECTED",
  IN_FLIGHT: "IN_FLIGHT",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
  DISPATCH_UNKNOWN: "DISPATCH_UNKNOWN",
  OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
  CONFIRMED_NO_USAGE: "CONFIRMED_NO_USAGE",
  SETTLED: "SETTLED",
  BILLING_INTEGRITY_REVIEW: "BILLING_INTEGRITY_REVIEW",
  COMPENSATED: "COMPENSATED",
} as const;

export type AdmissionState =
  (typeof ADMISSION_STATES)[keyof typeof ADMISSION_STATES];

/**
 * Canonical lifecycle states for `BillingReconciliationCase` (docs/specs/domain-state-machines.md).
 */
export const RECONCILIATION_CASE_STATES = {
  OPEN: "OPEN",
  EVIDENCE_PENDING: "EVIDENCE_PENDING",
  INTEGRITY_REVIEW: "INTEGRITY_REVIEW",
  SETTLED_WITH_USAGE: "SETTLED_WITH_USAGE",
  CONFIRMED_NO_USAGE: "CONFIRMED_NO_USAGE",
  ESCALATED: "ESCALATED",
  CLOSED: "CLOSED",
} as const;

export type ReconciliationCaseState =
  (typeof RECONCILIATION_CASE_STATES)[keyof typeof RECONCILIATION_CASE_STATES];

import { createHmac } from "node:crypto";
import { z } from "zod";

/**
 * Business purpose: Calculate a valid HMAC signature for worker pre-socket error claims.
 * Business rules:
 * - Worker signs failure details using its capabilityToken.
 * - Used in acceptance testing to prove that even a 100% cryptographically valid worker-signed
 *   HMAC is still rejected for IN_FLIGHT invocations (ADR-028 Line 94).
 * Execution flow:
 * 1. Normalize payload string: admissionId:invocationId:failureCategory:clientTimestamp.
 * 2. Hash payload with HMAC-SHA256 using capabilityToken as secret.
 * 3. Return 64-character hexadecimal digest.
 * Failure cases:
 * - Throws Error if capabilityToken or identifiers are empty.
 * Side effects:
 * - Pure computation; no external I/O.
 */
export function computeWorkerPreSocketRejectionHmac(
  capabilityToken: string,
  admissionId: string,
  invocationId: string,
  failureCategory: string,
  clientTimestamp: string,
): string {
  if (!capabilityToken || !admissionId || !invocationId) {
    throw new Error("Missing required parameters for worker pre-socket HMAC computation");
  }
  const payload = `${admissionId}:${invocationId}:${failureCategory}:${clientTimestamp}`;
  return createHmac("sha256", capabilityToken).update(payload).digest("hex");
}

/**
 * Rationale ("Why"): Worker reports physical LLM invocation results (tokens, status, or failure)
 * to settle bounded exposure or transition into reconciliation.
 * Mechanism ("How"): Validates invocation identity, capability token, and non-overlapping token counts.
 * Invariants & Constraints: Worker must provide capability token; token counts must be non-negative integers.
 */
export const billableInvocationSettlementRequestSchema = z.object({
  admissionId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  capabilityToken: z.string().trim().min(32).max(128),
  attemptOrdinal: z.number().int().min(1),
  providerCompletionState: z.nativeEnum(PROVIDER_COMPLETION_STATES),
  finishReason: z.string().trim().max(100).optional(),
  responseStatus: z.string().trim().max(50).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  providerResponseId: z.string().trim().max(200).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  workerClaimedPreSocketError: z.boolean().optional(),
  workerClaimFailureCategory: z.string().trim().max(100).optional(),
  workerClaimTimestamp: z.string().datetime().optional(),
  workerClaimSignature: z.string().trim().max(128).optional(),
});

export type BillableInvocationSettlementRequest = z.infer<
  typeof billableInvocationSettlementRequestSchema
>;

/**
 * Server response for billable invocation settlement.
 */
export const billableInvocationSettlementResponseSchema = z.object({
  settled: z.boolean(),
  state: z.nativeEnum(ADMISSION_STATES),
  rolloutMode: z.nativeEnum(BILLING_ROLLOUT_MODES),
  debitMode: z.nativeEnum(MODEL_USAGE_DEBIT_MODES),
  calculatedMicrocredits: z.string().regex(/^\d+$/),
  debitedMicrocredits: z.string().regex(/^\d+$/),
  shadowMicrocredits: z.string().regex(/^\d+$/).nullable(),
  chargedMicrocredits: z.string().regex(/^\d+$/),
  slotReleased: z.boolean(),
  settledAt: z.string().datetime().nullable(),
});

export type BillableInvocationSettlementResponse = z.infer<
  typeof billableInvocationSettlementResponseSchema
>;

/**
 * Pre-consume cancellation schema: only valid when admission is still ADMITTED.
 */
export const billableInvocationCancelRequestSchema = z.object({
  admissionId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  capabilityToken: z.string().trim().min(32).max(128),
  cancellationReason: z.string().trim().min(1).max(200),
});

export type BillableInvocationCancelRequest = z.infer<
  typeof billableInvocationCancelRequestSchema
>;

/**
 * Admin reconciliation request for closing unknown/disputed admissions as CONFIRMED_NO_USAGE.
 * Evidence must be verified against independent provider audit logs and valid time window.
 */
export const reconciliationNoUsageResolutionRequestSchema = z.object({
  caseId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  provider: z.string().trim().min(1).max(100),
  providerCorrelationId: z.string().trim().min(1).max(200),
  providerLogArtifactId: z.string().trim().min(1).max(200),
  providerLogArchiveSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  providerLogCoverageStart: z.string().datetime(),
  providerLogCoverageEnd: z.string().datetime(),
  auditRationale: z.string().trim().min(10).max(1000),
});

export type ReconciliationNoUsageResolutionRequest = z.infer<
  typeof reconciliationNoUsageResolutionRequestSchema
>;

export const sweepExpiredLeasesRequestSchema = z.object({
  batchSize: z.number().int().min(1).max(500).optional().default(50),
});

export type SweepExpiredLeasesRequest = z.infer<
  typeof sweepExpiredLeasesRequestSchema
>;

export const sweepExpiredLeasesResponseSchema = z.object({
  sweptCount: z.number().int().min(0),
  reconciliationCasesOpened: z.number().int().min(0),
});

export type SweepExpiredLeasesResponse = z.infer<
  typeof sweepExpiredLeasesResponseSchema
>;

/**
 * Rationale ("Why"): G-07 Transaction Compensation & Debit Linking (ADR-028 Line 159).
 * Mechanism ("How"): Binds compensation directly to the immutable original debit in CreditLedgerEntry,
 * enforces server-calculated cumulative compensation bounds, and ensures idempotency.
 * Invariants & Constraints: Amount must be positive decimal integer string of microcredits;
 * caller must provide structured reason and unique idempotencyKey.
 */
export const compensateBillingDebitRequestSchema = z
  .object({
    originalLedgerEntryId: z.string().trim().min(1).max(200),
    amountMicrocredits: z.string().regex(/^[1-9]\d*$/),
    reason: z.string().trim().min(5).max(500),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

export type CompensateBillingDebitRequest = z.infer<
  typeof compensateBillingDebitRequestSchema
>;

/**
 * Server response schema for debit compensation.
 * Why: Surfaces updated ledger entry identity, resulting wallet projection, and audit linkage.
 * Invariants: Cumulative compensation never exceeds original debit absolute amount.
 */
export const compensateBillingDebitResponseSchema = z.object({
  compensated: z.boolean(),
  ledgerEntryId: z.string().trim().min(1).max(200),
  walletId: z.string().trim().min(1).max(200),
  userId: z.string().trim().min(1).max(200),
  originalLedgerEntryId: z.string().trim().min(1).max(200),
  originalDebitMicrocredits: z.string().regex(/^\d+$/),
  compensatedMicrocredits: z.string().regex(/^\d+$/),
  totalCompensatedMicrocredits: z.string().regex(/^\d+$/),
  remainingUncompensatedMicrocredits: z.string().regex(/^\d+$/),
  walletBalanceMicrocredits: z.string().regex(/^-?\d+$/),
  walletVersion: z.number().int().nonnegative(),
  compensatedAt: z.string().datetime(),
});

export type CompensateBillingDebitResponse = z.infer<
  typeof compensateBillingDebitResponseSchema
>;
