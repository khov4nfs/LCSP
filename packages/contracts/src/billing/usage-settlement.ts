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

/**
 * Why: Only a real rule-authoring tool refusal can support this narrow domain verdict.
 * How: Pin the journal activity kind shared by worker evidence and the billing callback.
 * Invariant: Other progress or generic failure events cannot be treated as DOMAIN_REJECTED.
 */
export const RULE_PREPARATION_REJECTION_ACTIVITY_KINDS = {
  ruleAuthoringToolRejected: "RULE_AUTHORING_TOOL_REJECTED",
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
  // Why: Provider cache writes may have distinct 5-minute and 1-hour prices in the pinned tariff.
  // How: Preserve split counts through strict settlement parsing for canonical calculation and receipt evidence.
  // Invariant: Never discard a priced bucket before the server calculates a customer charge.
  cacheWrite5mTokens: z.number().int().nonnegative().optional(),
  cacheWrite1hTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  // Why: A later evaluator must name a tool call actually emitted by this paid model response.
  // How: Pin a bounded, sorted, duplicate-free list in the immutable settlement receipt.
  // Invariant: The list contains identities only; prompt, tool arguments and output stay out of billing records.
  // Why: JavaScript UTF-16 sort and PostgreSQL C collation disagree on some Unicode IDs.
  // How: Limit identity bytes to printable ASCII so API and database canonical ordering match.
  // Invariant: Unknown provider ID formats fail closed instead of creating ambiguous billing evidence.
  toolCallIds: z.array(z.string().min(1).max(200).regex(/^[!-~]+$/)).max(64)
    .refine((ids) => ids.every((id, index) => index === 0 || ids[index - 1]! < id), {
      message: "toolCallIds must be sorted and unique",
    }).optional(),
  workerClaimedPreSocketError: z.boolean().optional(),
  workerClaimFailureCategory: z.string().trim().max(100).optional(),
  workerClaimTimestamp: z.string().datetime().optional(),
  workerClaimSignature: z.string().trim().max(128).optional(),
}).superRefine((input, context) => {
  // Why: An unknown provider outcome does not prove that any tool call was emitted.
  // How: Accept physical tool-call evidence only with a confirmed completed response.
  // Invariant: Reconciliation cannot inherit fabricated causation from an unresolved invocation.
  if (input.toolCallIds?.length && input.providerCompletionState !== PROVIDER_COMPLETION_STATES.COMPLETED) {
    context.addIssue({ code: "custom", path: ["toolCallIds"], message: "toolCallIds require COMPLETED outcome" });
  }
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
  // Why: A final settled model call can exhaust the shared wallet without another admission to return 402.
  // How: Server returns the post-settlement decision pinned to the immutable receipt for worker checkpointing.
  // Invariant: OFF/SHADOW and non-terminal outcomes never request a payment pause.
  paymentRequired: z.boolean(),
  settledAt: z.string().datetime().nullable(),
});

export type BillableInvocationSettlementResponse = z.infer<
  typeof billableInvocationSettlementResponseSchema
>;

/**
 * Why: A rule-authoring rejection is a downstream business evaluation, never a provider usage outcome.
 * How: Restrict the callback to one persisted rejection event and one pinned tool call from a settled response.
 * Invariants: This phase does not accept generic verdicts or customer-wallet output evaluation writes.
 */
export const rulePreparationDomainRejectionRequestSchema = z.strictObject({
  admissionId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  preparationRunId: z.string().trim().min(1).max(200),
  runId: z.string().trim().min(1).max(200),
  eventId: z.string().uuid(),
  toolCallId: z.string().min(1).max(200).regex(/^[!-~]+$/),
  rejectionCode: z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/),
  evaluatorVersion: z.string().trim().min(1).max(100),
});

export type RulePreparationDomainRejectionRequest = z.infer<
  typeof rulePreparationDomainRejectionRequestSchema
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
 * Decision actions available to an authorized Admin when resolving a BillingReconciliationCase.
 * Rationale ("Why"): ADR-028 Line 155 mandates explicit audited decisions to either confirm no-usage
 * with verified log evidence, maintain exposure under integrity review, or escalate for manual review.
 * Invariants & Constraints: Defined as frozen `as const` SCREAMING_SNAKE_CASE object.
 */
export const RECONCILIATION_DECISION_ACTIONS = {
  confirmNoUsage: "CONFIRM_NO_USAGE",
  maintainExposure: "MAINTAIN_EXPOSURE",
  flagIntegrityReview: "FLAG_INTEGRITY_REVIEW",
  escalate: "ESCALATE",
} as const;

export type ReconciliationDecisionAction =
  (typeof RECONCILIATION_DECISION_ACTIONS)[keyof typeof RECONCILIATION_DECISION_ACTIONS];

/**
 * Admin query parameters for listing BillingReconciliationCase records.
 */
export const billingAdminReconciliationCaseListQuerySchema = z.object({
  state: z
    .enum([
      RECONCILIATION_CASE_STATES.OPEN,
      RECONCILIATION_CASE_STATES.EVIDENCE_PENDING,
      RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
      RECONCILIATION_CASE_STATES.SETTLED_WITH_USAGE,
      RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE,
      RECONCILIATION_CASE_STATES.ESCALATED,
      RECONCILIATION_CASE_STATES.CLOSED,
    ])
    .optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type BillingAdminReconciliationCaseListQuery = z.infer<
  typeof billingAdminReconciliationCaseListQuerySchema
>;

/**
 * Summary representation of a BillingReconciliationCase in admin queue.
 */
export const billingReconciliationCaseItemSchema = z.object({
  caseId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  admissionId: z.string().trim().min(1).max(200),
  state: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(100),
  providerCorrelationId: z.string().trim().min(1).max(200),
  providerLogArtifactId: z.string().trim().min(1).max(200).nullable(),
  coverageStart: z.string().datetime().nullable(),
  coverageEnd: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: z.string().trim().min(1).max(200).nullable(),
  auditRationale: z.string().trim().nullable(),
  conflictDetectedAt: z.string().datetime().nullable(),
  hasConflictingPayload: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  admission: z.object({
    walletId: z.string().trim().nullable(),
    userId: z.string().trim().nullable(),
    maximumExposureMicrocredits: z.string().regex(/^\d+$/),
    state: z.string().trim(),
    admittedAt: z.string().datetime(),
    consumedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime(),
  }),
});

export type BillingReconciliationCaseItem = z.infer<
  typeof billingReconciliationCaseItemSchema
>;

/**
 * Detailed representation of a BillingReconciliationCase with full evidence linkage.
 */
export const billingReconciliationCaseDetailResponseSchema = z.object({
  caseId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  admissionId: z.string().trim().min(1).max(200),
  state: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(100),
  providerCorrelationId: z.string().trim().min(1).max(200),
  providerLogArtifactId: z.string().trim().min(1).max(200).nullable(),
  coverageStart: z.string().datetime().nullable(),
  coverageEnd: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: z.string().trim().min(1).max(200).nullable(),
  auditRationale: z.string().trim().nullable(),
  conflictDetectedAt: z.string().datetime().nullable(),
  conflictingPayload: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  admission: z.object({
    id: z.string().trim().min(1).max(200),
    invocationId: z.string().trim().min(1).max(200),
    walletId: z.string().trim().nullable(),
    userId: z.string().trim().nullable(),
    maximumExposureMicrocredits: z.string().regex(/^\d+$/),
    state: z.string().trim(),
    rolloutMode: z.string().trim(),
    debitMode: z.string().trim(),
    requestedModel: z.string().trim(),
    resolvedProvider: z.string().trim(),
    resolvedModel: z.string().trim(),
    admittedAt: z.string().datetime(),
    consumedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime(),
  }),
  evidenceArtifact: z
    .object({
      artifactId: z.string().trim(),
      provider: z.string().trim(),
      sha256: z.string().trim(),
      coverageStart: z.string().datetime(),
      coverageEnd: z.string().datetime(),
      verified: z.boolean(),
      ingestedAt: z.string().datetime(),
    })
    .nullable(),
  // Why: Admin compensation must refer to an existing debit and a server-computed remaining ceiling.
  // How: Expose only the case-bound immutable ledger identity and decimal microcredit amounts.
  // Invariant: A missing or ineligible debit cannot be presented as compensable.
  compensationPreview: z
    .object({
      originalLedgerEntryId: z.string().trim().min(1).max(200),
      originalDebitMicrocredits: z.string().regex(/^\d+$/),
      totalCompensatedMicrocredits: z.string().regex(/^\d+$/),
      remainingUncompensatedMicrocredits: z.string().regex(/^\d+$/),
    })
    .nullable(),
});

export type BillingReconciliationCaseDetailResponse = z.infer<
  typeof billingReconciliationCaseDetailResponseSchema
>;

/**
 * Request payload for Admin manual decision on a BillingReconciliationCase.
 * Rationale ("Why"): ADR-028 Line 155 & Line 173 mandate audited Admin decisions.
 * Mechanism ("How"): Binds decision, idempotency key, audit rationale, and stored provider log artifact ID.
 * Invariants & Constraints: Strict schema rejecting unknown fields; does not trust client-supplied coverage metadata.
 */
export const reconciliationCaseDecisionRequestSchema = z
  .object({
    decision: z.enum([
      RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
      RECONCILIATION_DECISION_ACTIONS.maintainExposure,
      RECONCILIATION_DECISION_ACTIONS.flagIntegrityReview,
      RECONCILIATION_DECISION_ACTIONS.escalate,
    ]),
    idempotencyKey: z.string().trim().min(1).max(200),
    auditRationale: z.string().trim().min(10).max(1000),
    providerLogArtifactId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type ReconciliationCaseDecisionRequest = z.infer<
  typeof reconciliationCaseDecisionRequestSchema
>;

/**
 * Response payload for an audited Admin decision on a BillingReconciliationCase.
 */
export const reconciliationCaseDecisionResponseSchema = z.object({
  decided: z.boolean(),
  caseId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  admissionId: z.string().trim().min(1).max(200),
  previousState: z.string().trim().min(1).max(100),
  newState: z.string().trim().min(1).max(100),
  decision: z.string().trim().min(1).max(100),
  slotReleased: z.boolean(),
  auditRationale: z.string().trim().min(10).max(1000),
  decidedAt: z.string().datetime(),
  decidedBy: z.string().trim().min(1).max(200),
});

export type ReconciliationCaseDecisionResponse = z.infer<
  typeof reconciliationCaseDecisionResponseSchema
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
