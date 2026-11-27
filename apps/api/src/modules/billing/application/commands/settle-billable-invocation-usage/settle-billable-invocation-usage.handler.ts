import * as crypto from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  BILLING_ROLLOUT_MODES,
  CREDIT_LEDGER_SOURCES,
  MODEL_USAGE_DEBIT_MODES,
  PROVIDER_COMPLETION_STATES,
  RECONCILIATION_CASE_STATES,
  TOKEN_BUCKET_POLICIES,
  deriveAdmissionCapabilityDigest,
  type BillableInvocationSettlementRequest,
  type MicrocreditUsageBuckets,
  type TokenBucketPolicy,
} from "@lcsp/contracts/billing";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  toPrismaAdmissionState,
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
  toPrismaBillingReconciliationState,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { ModelPricingCalculatorService } from "../../shared/model-pricing-calculator.service.js";
import { BillingRolloutAuthorityService } from "../../shared/billing-rollout-authority.service.js";
import { SettleBillableInvocationUsageCommand } from "./settle-billable-invocation-usage.command.js";

export type SettleUsageExecutionResult = {
  settled: boolean;
  state: string;
  rolloutMode: string;
  debitMode: string;
  calculatedMicrocredits: string;
  debitedMicrocredits: string;
  shadowMicrocredits: string | null;
  chargedMicrocredits: string;
  slotReleased: boolean;
  settledAt: string | null;
};

/**
 * Business purpose: Compute deterministic settlement fingerprint for idempotent replay detection and conflict rejection.
 *
 * Business rules:
 * - Includes canonical token counts, attempt ordinal, completion state, response ID, finish reason, and status.
 * - Format is deterministic SHA-256 digest.
 *
 * Execution flow:
 * 1. Assemble colon-delimited string of canonical settlement fields.
 * 2. Hash with SHA-256 and return hex string.
 *
 * Failure cases:
 * - Pure function; no failure.
 *
 * Side effects:
 * - Pure computation with zero external or stateful side effects.
 */
// Rationale ("Why"): ADR-028 Line 138 requires matching settlement replay to return previous result and conflicting payload to be rejected.
// Mechanism ("How"): Computes SHA-256 digest over normalized settlement parameters stored in ModelUsageReceipt.settlementIdempotencyKey.
// Invariants & Constraints: Identical payload yields identical fingerprint; any changed token or outcome alters fingerprint.
function computeSettlementFingerprint(
  payload: BillableInvocationSettlementRequest,
): string {
  const canonical = [
    payload.invocationId,
    payload.attemptOrdinal ?? 1,
    payload.providerCompletionState,
    payload.inputTokens !== undefined && payload.inputTokens !== null
      ? payload.inputTokens
      : "",
    payload.outputTokens !== undefined && payload.outputTokens !== null
      ? payload.outputTokens
      : "",
    payload.totalTokens !== undefined && payload.totalTokens !== null
      ? payload.totalTokens
      : "",
    payload.cachedInputTokens !== undefined &&
    payload.cachedInputTokens !== null
      ? payload.cachedInputTokens
      : "",
    payload.cacheWriteTokens !== undefined && payload.cacheWriteTokens !== null
      ? payload.cacheWriteTokens
      : "",
    payload.reasoningTokens !== undefined && payload.reasoningTokens !== null
      ? payload.reasoningTokens
      : "",
    payload.durationMs !== undefined && payload.durationMs !== null
      ? payload.durationMs
      : "",
    payload.providerResponseId ?? "",
    payload.finishReason ?? "",
    payload.responseStatus ?? "",
  ].join(":");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

@Injectable()
@CommandHandler(SettleBillableInvocationUsageCommand)
export class SettleBillableInvocationUsageHandler implements ICommandHandler<
  SettleBillableInvocationUsageCommand,
  SettleUsageExecutionResult
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelPricingCalculator: ModelPricingCalculatorService,
    private readonly rolloutAuthority: BillingRolloutAuthorityService,
  ) {}

  /**
   * Business purpose: Settle physical LLM invocation usage under Phase C (MODEL_USAGE_DEBIT = SHADOW) with idempotent replay and canonical pricing.
   *
   * Business rules:
   * - Admission must be in IN_FLIGHT, DISPATCH_UNKNOWN, OUTCOME_UNKNOWN, or SETTLED (for idempotent replay) state.
   * - Capability token digest must match stored digest.
   * - Uses row lock FOR UPDATE on BillableInvocationAdmission:
   *   1. If state is already CONFIRMED_NO_USAGE (closed by reconciliation):
   *      ADR-028 Line 157 terminal precedence prevents late settlement from rewriting decision or debiting.
   *      Conflicting evidence is permanently committed into BillingReconciliationCase under INTEGRITY_REVIEW.
   *   2. If state is already SETTLED (ADR-028 Line 138):
   *      If incoming payload matches original settlement fingerprint, return existing result idempotently without duplicate receipt.
   *      If payload conflicts with original settlement, reject with 409 Conflict.
   *   3. If COMPLETED but token usage evidence is missing/invalid:
   *      Must NOT transition to SETTLED or release slot. Keeps case in OUTCOME_UNKNOWN with full exposure and open reconciliation case.
   *   4. If COMPLETED and pinned tariff snapshot or sponsorship policy snapshot is missing/unresolvable:
   *      Must NOT transition to SETTLED or release slot with 0 microcredits. Retains exposure and routes to BILLING_INTEGRITY_REVIEW.
   *   5. If COMPLETED and calculated usage exceeds admitted maximumExposureMicrocredits (ADR-028 Line 138):
   *      Does NOT silently expand debt or settle. Retains bounded exposure, holds concurrency slot, and enters BILLING_INTEGRITY_REVIEW.
   *   6. If COMPLETED with valid tokens within exposure:
   *      Calculates microcredits using canonical ModelPricingCalculatorService (handling cache, reasoning, and rounding consistently with Admin preview).
   *      Persists ModelUsageReceipt with field isolation and settlementIdempotencyKey.
   *      Settles strictly under pinned issuance debit authority (OFF stays OFF, SHADOW stays SHADOW, ON debits only when active authority is ON).
   *      Transitions admission to SETTLED, releases slot, updates reconciliation case to SETTLED_WITH_USAGE, and records AuditEvent.
   *   7. Any failure, timeout, or worker pre-socket error claim transitions to DISPATCH_UNKNOWN or OUTCOME_UNKNOWN,
   *      retaining maximum exposure, keeping slot held, and opening a BillingReconciliationCase.
   *
   * Execution flow:
   * 1. Look up admission by invocationId and admissionId.
   * 2. Verify capability token digest.
   * 3. Compute incoming settlement fingerprint.
   * 4. Begin database transaction with row lock FOR UPDATE.
   * 5. Handle CONFIRMED_NO_USAGE terminal race, SETTLED replay idempotency, or new settlement.
   * 6. Validate token usage evidence; if invalid, transition to OUTCOME_UNKNOWN.
   * 7. Resolve pinned tariff rates; if missing or unresolvable, route to BILLING_INTEGRITY_REVIEW.
   * 8. Perform canonical pricing calculation; if charge exceeds maximum exposure, route to BILLING_INTEGRITY_REVIEW.
   * 9. Persist ModelUsageReceipt, mark admission SETTLED, release slot, and emit AuditEvent.
   * 10. Commit transaction and return execution result.
   *
   * Failure cases:
   * - Throws 404 NOT_FOUND if admission does not exist.
   * - Throws 409 CONFLICT if admission was already resolved to CONFIRMED_NO_USAGE (conflicting evidence recorded).
   * - Throws 409 CONFLICT if admission was SETTLED and incoming replay has conflicting payload.
   * - Throws 422 UNPROCESSABLE_ENTITY if capability token does not match.
   * - Throws 422 UNPROCESSABLE_ENTITY if admission is in a non-settlable state.
   *
   * Side effects:
   * - Updates BillableInvocationAdmission state to SETTLED, DISPATCH_UNKNOWN, or OUTCOME_UNKNOWN.
   * - Updates or creates BillingReconciliationCase; transitions to INTEGRITY_REVIEW upon excessive usage, missing tariff, or late conflicting evidence.
   * - Creates ModelUsageReceipt upon verified COMPLETED outcome within exposure bounds.
   * - Emits AuditEvent record for settled invocation usage.
   */
  // Rationale ("Why"): Implements Phase C shadow settlement accounting while preserving customer wallet balances, enforcing replay idempotency, and canonical tariff math.
  // Mechanism ("How"): Delegates pricing strictly to ModelPricingCalculatorService, enforces ADR-028 Line 138 fingerprint idempotency, and persists AuditEvent.
  // Invariants & Constraints: In SHADOW mode, debitedMicrocredits and chargedMicrocredits are strictly 0; missing token evidence never releases slot.
  async execute(
    command: SettleBillableInvocationUsageCommand,
  ): Promise<SettleUsageExecutionResult> {
    const { payload, correlationId = "usage-settle" } = command;

    const admission = await this.prisma.billableInvocationAdmission.findUnique({
      where: { invocationId: payload.invocationId },
    });

    if (!admission || admission.id !== payload.admissionId) {
      throw problemException(
        BILLING_ERROR_CODES.admissionNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const expectedDigest = deriveAdmissionCapabilityDigest(
      payload.capabilityToken,
    );
    if (admission.capabilityDigest !== expectedDigest) {
      throw problemException(
        BILLING_ERROR_CODES.admissionCapabilityMismatch,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const now = new Date();
    const settlementFingerprint = computeSettlementFingerprint(payload);

    // Check terminal precedence: if already CONFIRMED_NO_USAGE, route to BILLING_INTEGRITY_REVIEW
    if (admission.state === ADMISSION_STATES.CONFIRMED_NO_USAGE) {
      // ADR-028 Line 157: Terminal precedence prevents an unaudited late callback from rewriting a reviewed no-usage outcome.
      // Late conflicting evidence is appended to BILLING_INTEGRITY_REVIEW; it cannot debit until an explicit versioned audited reopen.
      // The original no-usage decision remains immutable history.
      await this.prisma.billingReconciliationCase.updateMany({
        where: { invocationId: admission.invocationId },
        data: {
          state: RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
          conflictingPayload: {
            reportedAttemptOrdinal: payload.attemptOrdinal,
            providerCompletionState: payload.providerCompletionState,
            inputTokens: payload.inputTokens ?? 0,
            outputTokens: payload.outputTokens ?? 0,
            totalTokens: payload.totalTokens ?? 0,
            durationMs: payload.durationMs ?? null,
            providerResponseId: payload.providerResponseId ?? null,
            finishReason: payload.finishReason ?? null,
            reportedAt: now.toISOString(),
          },
          conflictDetectedAt: now,
          version: { increment: 1 },
        },
      });

      throw problemException(
        BILLING_ERROR_CODES.reconciliationAlreadyResolved,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    if (
      admission.state !== ADMISSION_STATES.IN_FLIGHT &&
      admission.state !== ADMISSION_STATES.DISPATCH_UNKNOWN &&
      admission.state !== ADMISSION_STATES.OUTCOME_UNKNOWN &&
      admission.state !== ADMISSION_STATES.SETTLED
    ) {
      throw problemException(
        BILLING_ERROR_CODES.admissionInvalidState,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    // Rationale ("Why"): ADR-028 Line 216 mandates that an admission pins its rollout mode and authority at issuance.
    // Settlement may debit only an admission issued under eligible DEBIT_ENABLED authority;
    // a later process observing a newer mode (e.g. server switching OFF -> SHADOW, or SHADOW -> ON)
    // cannot upgrade an older admission retroactively.
    // Mechanism ("How"): An admission pinned with debitMode: OFF settles strictly under OFF (zero shadow, zero debit).
    // An admission pinned with debitMode: SHADOW settles strictly under SHADOW (shadow usage recorded, zero debit).
    // An admission pinned with debitMode: ON settles under ON only if active server authority is also DEBIT_ENABLED/ON.
    // Invariants: Retroactive authority upgrades are strictly impossible; pinned issuance authority governs settlement.
    const activeAuthority = this.rolloutAuthority.getActiveRolloutAuthority();
    const debitMode =
      admission.debitMode === MODEL_USAGE_DEBIT_MODES.OFF
        ? MODEL_USAGE_DEBIT_MODES.OFF
        : admission.debitMode === MODEL_USAGE_DEBIT_MODES.SHADOW
          ? MODEL_USAGE_DEBIT_MODES.SHADOW
          : admission.rolloutMode === BILLING_ROLLOUT_MODES.DEBIT_ENABLED &&
              admission.debitMode === MODEL_USAGE_DEBIT_MODES.ON &&
              activeAuthority.debitMode === MODEL_USAGE_DEBIT_MODES.ON
            ? MODEL_USAGE_DEBIT_MODES.ON
            : MODEL_USAGE_DEBIT_MODES.SHADOW;

    const result = await this.prisma.$transaction(async (tx) => {
      // ADR-028 Line 145: To prevent cross-command deadlocks, financial mutations acquire authoritative locks
      // in this order: wallet or platform-sponsorship aggregate, admission, original debit/reconciliation case, then projection/outbox writes.
      let lockedWallet: {
        id: string;
        balanceMicrocredits: bigint;
        availableCredits: bigint;
        accountingUnitVersion: number;
        version: number;
      } | null = null;

      if (
        admission.fundingPrincipal ===
        ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET
      ) {
        if (!admission.walletId) {
          // Fail closed: customer admission lacking walletId cannot settle; route to integrity review
          // Rationale: We commit the transition to BILLING_INTEGRITY_REVIEW and reconciliation case,
          // then return a failure flag so the outer handler throws HTTP 422 with the state safely persisted.
          await tx.billableInvocationAdmission.update({
            where: { id: admission.id },
            data: {
              state: toPrismaAdmissionState(
                ADMISSION_STATES.BILLING_INTEGRITY_REVIEW,
              ),
              version: { increment: 1 },
            },
          });
          await tx.billingReconciliationCase.upsert({
            where: { invocationId: admission.invocationId },
            create: {
              id: crypto.randomUUID(),
              caseId: `recon-${admission.invocationId}`,
              invocationId: admission.invocationId,
              admissionId: admission.id,
              state: toPrismaBillingReconciliationState(
                RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
              ),
              provider: admission.resolvedProvider,
              providerCorrelationId: admission.invocationId,
              auditRationale:
                "Customer admission lacking walletId during settlement; routed to integrity review",
            },
            update: {
              state: toPrismaBillingReconciliationState(
                RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
              ),
              auditRationale:
                "Customer admission lacking walletId during settlement; routed to integrity review",
            },
          });
          return {
            failClosedIntegrityReview: true,
            reason:
              "Customer admission lacking walletId during settlement; routed to integrity review",
          };
        }

        const [foundWallet] = await tx.$queryRaw<
          Array<{
            id: string;
            balanceMicrocredits: bigint;
            availableCredits: bigint;
            accountingUnitVersion: number;
            version: number;
          }>
        >`
          SELECT id, "balanceMicrocredits", "availableCredits", "accountingUnitVersion", version
          FROM "BillingWallet"
          WHERE id = ${admission.walletId}
          FOR UPDATE
        `;

        if (!foundWallet) {
          // Fail closed: wallet row not found under row lock; route to integrity review
          // Rationale: Commits BILLING_INTEGRITY_REVIEW and BillingReconciliationCase before HTTP 422 rejection.
          await tx.billableInvocationAdmission.update({
            where: { id: admission.id },
            data: {
              state: toPrismaAdmissionState(
                ADMISSION_STATES.BILLING_INTEGRITY_REVIEW,
              ),
              version: { increment: 1 },
            },
          });
          await tx.billingReconciliationCase.upsert({
            where: { invocationId: admission.invocationId },
            create: {
              id: crypto.randomUUID(),
              caseId: `recon-${admission.invocationId}`,
              invocationId: admission.invocationId,
              admissionId: admission.id,
              state: toPrismaBillingReconciliationState(
                RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
              ),
              provider: admission.resolvedProvider,
              providerCorrelationId: admission.invocationId,
              auditRationale:
                "Customer wallet not found under FOR UPDATE lock during settlement; routed to integrity review",
            },
            update: {
              state: toPrismaBillingReconciliationState(
                RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
              ),
              auditRationale:
                "Customer wallet not found under FOR UPDATE lock during settlement; routed to integrity review",
            },
          });
          return {
            failClosedIntegrityReview: true,
            reason:
              "Customer wallet not found under FOR UPDATE lock during settlement; routed to integrity review",
          };
        }

        lockedWallet = foundWallet;
      } else if (
        admission.fundingPrincipal ===
        ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED
      ) {
        // Platform sponsorship aggregate lock
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext('lcsp:platform-sponsorship'), hashtext(${admission.logicalOperationId}));
        `;
      }

      // Lock admission row FOR UPDATE second (strictly following ADR-028 lock ordering)
      const [lockedAdmission] = await tx.$queryRaw<
        Array<{ id: string; state: string; version: number }>
      >`
        SELECT id, state, version
        FROM "BillableInvocationAdmission"
        WHERE id = ${admission.id}
        FOR UPDATE
      `;

      if (!lockedAdmission) {
        throw problemException(
          BILLING_ERROR_CODES.admissionNotFound,
          correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }

      if (lockedAdmission.state === ADMISSION_STATES.CONFIRMED_NO_USAGE) {
        // Late race conflict: reconciliation committed while we were waiting for row lock.
        // Return conflict sentinel so we can commit update to BillingReconciliationCase outside tx
        // without transaction rollback.
        return { raceConflict: true } as const;
      }

      // ADR-028 Line 138: Under row lock, handle replay idempotency vs payload conflict on SETTLED
      if (lockedAdmission.state === ADMISSION_STATES.SETTLED) {
        const existingReceipt = await tx.modelUsageReceipt.findUnique({
          where: { invocationId: admission.invocationId },
        });

        if (existingReceipt) {
          // Idempotent retry: matching settlement fingerprint returns previous result
          if (
            existingReceipt.settlementIdempotencyKey === settlementFingerprint
          ) {
            return {
              settled: true,
              state: ADMISSION_STATES.SETTLED,
              rolloutMode: admission.rolloutMode,
              debitMode,
              calculatedMicrocredits:
                existingReceipt.calculatedMicrocredits.toString(),
              debitedMicrocredits:
                existingReceipt.debitedMicrocredits.toString(),
              shadowMicrocredits: existingReceipt.shadowMicrocredits
                ? existingReceipt.shadowMicrocredits.toString()
                : null,
              chargedMicrocredits: existingReceipt.chargedMicrocredits
                ? existingReceipt.chargedMicrocredits.toString()
                : "0",
              slotReleased: true,
              settledAt: existingReceipt.settledAt
                ? existingReceipt.settledAt.toISOString()
                : now.toISOString(),
            };
          }

          // Conflicting payload on already settled invocation is explicitly rejected
          throw problemException(
            BILLING_ERROR_CODES.admissionAlreadySettled,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
      }

      // Branch A: COMPLETED -> Confirmed usage settlement
      if (
        payload.providerCompletionState === PROVIDER_COMPLETION_STATES.COMPLETED
      ) {
        // Invariant: Mandatory usage evidence check.
        // A COMPLETED claim without explicit inputTokens and outputTokens cannot be accepted as confirmed usage.
        // Missing token evidence must NOT transition to SETTLED or release the concurrency slot.
        const hasValidTokens =
          typeof payload.inputTokens === "number" &&
          typeof payload.outputTokens === "number" &&
          payload.inputTokens >= 0 &&
          payload.outputTokens >= 0;

        if (!hasValidTokens) {
          // Missing token usage: transition to OUTCOME_UNKNOWN, retain exposure, open reconciliation case, keep slot blocked
          await tx.billableInvocationAdmission.update({
            where: { id: admission.id },
            data: {
              state: ADMISSION_STATES.OUTCOME_UNKNOWN,
              version: { increment: 1 },
            },
          });

          await tx.billingReconciliationCase.upsert({
            where: { invocationId: admission.invocationId },
            create: {
              caseId: `case-${admission.invocationId}`,
              invocationId: admission.invocationId,
              admissionId: admission.id,
              state: RECONCILIATION_CASE_STATES.OPEN,
              provider: admission.resolvedProvider,
              providerCorrelationId: admission.correlationId,
              version: 1,
            },
            update: {
              state: RECONCILIATION_CASE_STATES.OPEN,
              version: { increment: 1 },
            },
          });

          return {
            settled: false,
            state: ADMISSION_STATES.OUTCOME_UNKNOWN,
            rolloutMode: admission.rolloutMode,
            debitMode,
            calculatedMicrocredits: "0",
            debitedMicrocredits: "0",
            shadowMicrocredits: null,
            chargedMicrocredits: "0",
            slotReleased: false,
            settledAt: null,
          };
        }

        // Canonical Pricing Calculation using ModelPricingCalculatorService
        let rates: TariffRatesMicrocreditsPerMillion | null = null;
        if (admission.tariffSnapshotId) {
          const tariff = await tx.customerModelTariffSnapshot.findUnique({
            where: { id: admission.tariffSnapshotId },
          });
          if (tariff) {
            rates = {
              input: tariff.inputMicrocreditsPerMillion,
              output: tariff.outputMicrocreditsPerMillion,
              reasoningPolicy: tariff.reasoningPolicy,
              reasoning: tariff.reasoningMicrocreditsPerMillion ?? undefined,
              cachedInputPolicy: tariff.cachedInputPolicy,
              cachedInput:
                tariff.cachedInputMicrocreditsPerMillion ?? undefined,
              cacheWritePolicy: tariff.cacheWritePolicy,
              cacheWrite: tariff.cacheWriteMicrocreditsPerMillion ?? undefined,
              cacheWrite5m:
                tariff.cacheWrite5mMicrocreditsPerMillion ?? undefined,
              cacheWrite1h:
                tariff.cacheWrite1hMicrocreditsPerMillion ?? undefined,
            };
          }
        } else if (admission.sponsorshipPolicySnapshotId) {
          const policy = await tx.platformSponsorshipPolicySnapshot.findUnique({
            where: { id: admission.sponsorshipPolicySnapshotId },
          });
          if (policy) {
            rates = {
              input: policy.inputMicrocreditsPerMillion,
              output: policy.outputMicrocreditsPerMillion,
              reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
              cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
              cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
            };
          }
        }

        // Invariant: Pinned tariff or platform sponsorship snapshot must exist.
        // A missing snapshot cannot establish financial authority to settle; it must NOT fall back to 0 microcredits or release the slot.
        // It transitions to OUTCOME_UNKNOWN, retains exposure, and routes to BILLING_INTEGRITY_REVIEW.
        if (!rates) {
          await tx.billableInvocationAdmission.update({
            where: { id: admission.id },
            data: {
              state: ADMISSION_STATES.OUTCOME_UNKNOWN,
              version: { increment: 1 },
            },
          });

          await tx.billingReconciliationCase.upsert({
            where: { invocationId: admission.invocationId },
            create: {
              caseId: `case-${admission.invocationId}`,
              invocationId: admission.invocationId,
              admissionId: admission.id,
              state: RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
              provider: admission.resolvedProvider,
              providerCorrelationId: admission.correlationId,
              conflictingPayload: {
                reason: "MISSING_PINNED_TARIFF_SNAPSHOT",
                reportedAttemptOrdinal: payload.attemptOrdinal,
                providerCompletionState: payload.providerCompletionState,
                inputTokens: payload.inputTokens,
                outputTokens: payload.outputTokens,
                reportedAt: now.toISOString(),
              },
              conflictDetectedAt: now,
              version: 1,
            },
            update: {
              state: RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
              conflictingPayload: {
                reason: "MISSING_PINNED_TARIFF_SNAPSHOT",
                reportedAttemptOrdinal: payload.attemptOrdinal,
                providerCompletionState: payload.providerCompletionState,
                inputTokens: payload.inputTokens,
                outputTokens: payload.outputTokens,
                reportedAt: now.toISOString(),
              },
              conflictDetectedAt: now,
              version: { increment: 1 },
            },
          });

          return {
            settled: false,
            state: ADMISSION_STATES.OUTCOME_UNKNOWN,
            rolloutMode: admission.rolloutMode,
            debitMode,
            calculatedMicrocredits: "0",
            debitedMicrocredits: "0",
            shadowMicrocredits: null,
            chargedMicrocredits: "0",
            slotReleased: false,
            settledAt: null,
          };
        }

        const usage: MicrocreditUsageBuckets = {
          inputTokens: BigInt(payload.inputTokens!),
          outputTokens: BigInt(payload.outputTokens!),
          cachedInputTokens:
            payload.cachedInputTokens !== undefined &&
            payload.cachedInputTokens !== null
              ? BigInt(payload.cachedInputTokens)
              : undefined,
          cacheWriteTokens:
            payload.cacheWriteTokens !== undefined &&
            payload.cacheWriteTokens !== null
              ? BigInt(payload.cacheWriteTokens)
              : undefined,
          reasoningTokens:
            payload.reasoningTokens !== undefined &&
            payload.reasoningTokens !== null
              ? BigInt(payload.reasoningTokens)
              : undefined,
        };

        const chargeResult = this.modelPricingCalculator.calculateCharge({
          usage,
          ratesMicrocreditsPerMillion: rates,
        });
        const calculatedMicrocredits = chargeResult.chargeMicrocredits;

        // Invariant (ADR-028 Line 138): Provider usage beyond the admitted maximum exposure does not silently expand debt;
        // it enters BILLING_INTEGRITY_REVIEW. The concurrency slot remains blocked and exposure is bounded at admitted ceiling.
        if (calculatedMicrocredits > admission.maximumExposureMicrocredits) {
          await tx.billableInvocationAdmission.update({
            where: { id: admission.id },
            data: {
              state: ADMISSION_STATES.OUTCOME_UNKNOWN,
              version: { increment: 1 },
            },
          });

          await tx.billingReconciliationCase.upsert({
            where: { invocationId: admission.invocationId },
            create: {
              caseId: `case-${admission.invocationId}`,
              invocationId: admission.invocationId,
              admissionId: admission.id,
              state: RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
              provider: admission.resolvedProvider,
              providerCorrelationId: admission.correlationId,
              conflictingPayload: {
                reason: "EXCESSIVE_USAGE_BEYOND_ADMITTED_EXPOSURE",
                calculatedMicrocredits: calculatedMicrocredits.toString(),
                maximumExposureMicrocredits:
                  admission.maximumExposureMicrocredits.toString(),
                reportedAttemptOrdinal: payload.attemptOrdinal,
                providerCompletionState: payload.providerCompletionState,
                inputTokens: payload.inputTokens,
                outputTokens: payload.outputTokens,
                totalTokens: payload.totalTokens,
                durationMs: payload.durationMs ?? null,
                providerResponseId: payload.providerResponseId ?? null,
                finishReason: payload.finishReason ?? null,
                reportedAt: now.toISOString(),
              },
              conflictDetectedAt: now,
              version: 1,
            },
            update: {
              state: RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
              conflictingPayload: {
                reason: "EXCESSIVE_USAGE_BEYOND_ADMITTED_EXPOSURE",
                calculatedMicrocredits: calculatedMicrocredits.toString(),
                maximumExposureMicrocredits:
                  admission.maximumExposureMicrocredits.toString(),
                reportedAttemptOrdinal: payload.attemptOrdinal,
                providerCompletionState: payload.providerCompletionState,
                inputTokens: payload.inputTokens,
                outputTokens: payload.outputTokens,
                totalTokens: payload.totalTokens,
                durationMs: payload.durationMs ?? null,
                providerResponseId: payload.providerResponseId ?? null,
                finishReason: payload.finishReason ?? null,
                reportedAt: now.toISOString(),
              },
              conflictDetectedAt: now,
              version: { increment: 1 },
            },
          });

          return {
            settled: false,
            state: ADMISSION_STATES.OUTCOME_UNKNOWN,
            rolloutMode: admission.rolloutMode,
            debitMode,
            calculatedMicrocredits: calculatedMicrocredits.toString(),
            debitedMicrocredits: "0",
            shadowMicrocredits: null,
            chargedMicrocredits: "0",
            slotReleased: false,
            settledAt: null,
          };
        }

        let debitedMicrocredits = 0n;
        let chargedMicrocredits = 0n;
        let shadowMicrocredits: bigint | null = null;

        if (
          admission.fundingPrincipal ===
          ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED
        ) {
          // ADR-028 Line 140: Platform sponsored calls are never debited to customer wallets.
          // chargedMicrocredits reflects the actual customer debit (0), while calculatedMicrocredits reflects rate computation.
          debitedMicrocredits = 0n;
          chargedMicrocredits = 0n;
          shadowMicrocredits = null;
        } else if (debitMode === MODEL_USAGE_DEBIT_MODES.ON) {
          if (!lockedWallet) {
            // Unreachable due to upfront check, but enforced fail closed
            throw problemException(
              BILLING_ERROR_CODES.notFound,
              correlationId,
              { status: HttpStatus.UNPROCESSABLE_ENTITY },
            );
          }

          debitedMicrocredits = calculatedMicrocredits;
          chargedMicrocredits = calculatedMicrocredits;

          // Rationale ("Why"): Live settlement under DEBIT_ENABLED must deduct microcredits atomically under row lock.
          // Mechanism ("How"): Locked BillingWallet FOR UPDATE upfront, deduct calculatedMicrocredits, project signed balance
          // (allowing signed negative balance per ADR-028 Line 140), increment version, create CreditLedgerEntry, and emit OutboxMessage.
          // Invariants: Single atomic transaction committing 5 records; wallet.version strictly increments.
          const newBalanceMicrocredits =
            lockedWallet.balanceMicrocredits - calculatedMicrocredits;
          const newAvailableCredits =
            newBalanceMicrocredits > 0n
              ? newBalanceMicrocredits / 1_000_000n
              : 0n;

          await tx.billingWallet.update({
            where: { id: lockedWallet.id },
            data: {
              balanceMicrocredits: newBalanceMicrocredits,
              availableCredits: newAvailableCredits,
              version: { increment: 1 },
            },
          });

          await tx.creditLedgerEntry.create({
            data: {
              userId: admission.userId ?? lockedWallet.id,
              walletId: lockedWallet.id,
              idempotencyKey: `debit-${admission.id}`,
              source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
              ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT as any,
              deltaCredits: -(calculatedMicrocredits / 1_000_000n),
              deltaMicrocredits: -calculatedMicrocredits,
              accountingUnitVersion: lockedWallet.accountingUnitVersion ?? 2,
              admissionId: admission.id,
              requestFingerprint: settlementFingerprint,
            },
          });

          await tx.outboxMessage.create({
            data: {
              id: crypto.randomUUID(),
              aggregateType: OUTBOX_AGGREGATE_TYPES.billingWallet as any,
              aggregateId: lockedWallet.id,
              eventType: BILLING_AUDIT_EVENT_TYPES.usageSettled,
              payload: {
                admissionId: admission.id,
                invocationId: admission.invocationId,
                walletId: lockedWallet.id,
                calculatedMicrocredits: calculatedMicrocredits.toString(),
                debitedMicrocredits: calculatedMicrocredits.toString(),
                shadowMicrocredits: null,
                debitMode,
                settledAt: now.toISOString(),
                correlationId: correlationId ?? null,
              },
              status: "PENDING",
            },
          });
        } else if (debitMode === MODEL_USAGE_DEBIT_MODES.SHADOW) {
          debitedMicrocredits = 0n;
          chargedMicrocredits = 0n;
          shadowMicrocredits = calculatedMicrocredits;
        } else {
          debitedMicrocredits = 0n;
          chargedMicrocredits = 0n;
          shadowMicrocredits = null;
        }

        // Persist ModelUsageReceipt with field isolation and idempotency key
        await tx.modelUsageReceipt.create({
          data: {
            admissionId: admission.id,
            invocationId: admission.invocationId,
            providerCompletionState: payload.providerCompletionState,
            finishReason: payload.finishReason ?? null,
            responseStatus: payload.responseStatus ?? "200",
            operationType: admission.operationType,
            runtimePolicyVersion: admission.runtimePolicyVersion,
            durationMs: payload.durationMs ?? null,
            providerResponseId: payload.providerResponseId ?? null,
            inputTokens: payload.inputTokens
              ? BigInt(payload.inputTokens)
              : null,
            cachedInputTokens: payload.cachedInputTokens
              ? BigInt(payload.cachedInputTokens)
              : null,
            cacheWriteTokens: payload.cacheWriteTokens
              ? BigInt(payload.cacheWriteTokens)
              : null,
            outputTokens: payload.outputTokens
              ? BigInt(payload.outputTokens)
              : null,
            reasoningTokens: payload.reasoningTokens
              ? BigInt(payload.reasoningTokens)
              : null,
            totalTokens: payload.totalTokens
              ? BigInt(payload.totalTokens)
              : null,
            calculatedMicrocredits,
            debitedMicrocredits,
            shadowMicrocredits,
            chargedMicrocredits,
            settlementIdempotencyKey: settlementFingerprint,
            settledAt: now,
          },
        });

        await tx.billableInvocationAdmission.update({
          where: { id: admission.id },
          data: {
            state: ADMISSION_STATES.SETTLED,
            maximumExposureMicrocredits: 0n,
            chargedMicrocredits,
            settlementFingerprint,
            settledAt: now,
            version: { increment: 1 },
          },
        });

        // Update reconciliation case if one exists
        await tx.billingReconciliationCase.updateMany({
          where: { invocationId: admission.invocationId },
          data: {
            state: RECONCILIATION_CASE_STATES.SETTLED_WITH_USAGE,
            resolvedAt: now,
            version: { increment: 1 },
          },
        });

        // Emit audit event for usage settlement
        await tx.auditEvent.create({
          data: {
            id: crypto.randomUUID(),
            eventType: BILLING_AUDIT_EVENT_TYPES.usageSettled,
            actorId: admission.userId ?? null,
            correlationId,
            resourceType: toPrismaAuditResourceType(
              AUDIT_RESOURCE_TYPES.httpRoute,
            ),
            resourceId: admission.id,
            decision: toPrismaAuthDecision(AUDIT_DECISIONS.allow),
            payload: {
              admissionId: admission.id,
              invocationId: admission.invocationId,
              providerCompletionState: payload.providerCompletionState,
              calculatedMicrocredits: calculatedMicrocredits.toString(),
              debitedMicrocredits: debitedMicrocredits.toString(),
              shadowMicrocredits:
                shadowMicrocredits !== null
                  ? shadowMicrocredits.toString()
                  : null,
              chargedMicrocredits: chargedMicrocredits.toString(),
              debitMode,
              inputTokens: payload.inputTokens,
              outputTokens: payload.outputTokens,
              cachedInputTokens: payload.cachedInputTokens ?? 0,
              reasoningTokens: payload.reasoningTokens ?? 0,
            },
          },
        });

        return {
          settled: true,
          state: ADMISSION_STATES.SETTLED,
          rolloutMode: admission.rolloutMode,
          debitMode,
          calculatedMicrocredits: calculatedMicrocredits.toString(),
          debitedMicrocredits: debitedMicrocredits.toString(),
          shadowMicrocredits:
            shadowMicrocredits !== null ? shadowMicrocredits.toString() : null,
          chargedMicrocredits: chargedMicrocredits.toString(),
          slotReleased: true,
          settledAt: now.toISOString(),
        };
      }

      // Branch B: FAILED / Worker abort claim
      if (
        payload.providerCompletionState === PROVIDER_COMPLETION_STATES.FAILED
      ) {
        await tx.billableInvocationAdmission.update({
          where: { id: admission.id },
          data: {
            state: ADMISSION_STATES.DISPATCH_UNKNOWN,
            version: { increment: 1 },
          },
        });

        await tx.billingReconciliationCase.upsert({
          where: { invocationId: admission.invocationId },
          create: {
            caseId: `case-${admission.invocationId}`,
            invocationId: admission.invocationId,
            admissionId: admission.id,
            state: RECONCILIATION_CASE_STATES.OPEN,
            provider: admission.resolvedProvider,
            providerCorrelationId: admission.correlationId,
            version: 1,
          },
          update: {
            state: RECONCILIATION_CASE_STATES.OPEN,
            version: { increment: 1 },
          },
        });

        return {
          settled: false,
          state: ADMISSION_STATES.DISPATCH_UNKNOWN,
          rolloutMode: admission.rolloutMode,
          debitMode,
          calculatedMicrocredits: "0",
          debitedMicrocredits: "0",
          shadowMicrocredits: null,
          chargedMicrocredits: "0",
          slotReleased: false,
          settledAt: null,
        };
      }

      // Branch C: OUTCOME_UNKNOWN (Timeout / Stream Disconnect)
      await tx.billableInvocationAdmission.update({
        where: { id: admission.id },
        data: {
          state: ADMISSION_STATES.OUTCOME_UNKNOWN,
          version: { increment: 1 },
        },
      });

      await tx.billingReconciliationCase.upsert({
        where: { invocationId: admission.invocationId },
        create: {
          caseId: `case-${admission.invocationId}`,
          invocationId: admission.invocationId,
          admissionId: admission.id,
          state: RECONCILIATION_CASE_STATES.OPEN,
          provider: admission.resolvedProvider,
          providerCorrelationId: admission.correlationId,
          version: 1,
        },
        update: {
          state: RECONCILIATION_CASE_STATES.OPEN,
          version: { increment: 1 },
        },
      });

      return {
        settled: false,
        state: ADMISSION_STATES.OUTCOME_UNKNOWN,
        rolloutMode: admission.rolloutMode,
        debitMode,
        calculatedMicrocredits: "0",
        debitedMicrocredits: "0",
        shadowMicrocredits: null,
        chargedMicrocredits: "0",
        slotReleased: false,
        settledAt: null,
      };
    });

    // Why: When customer wallet is missing, the transition to BILLING_INTEGRITY_REVIEW and reconciliation case
    // are committed in the database transaction above. Now we reject the HTTP call with 422 Unprocessable Entity.
    if (
      "failClosedIntegrityReview" in result &&
      result.failClosedIntegrityReview
    ) {
      throw problemException(BILLING_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }

    if ("raceConflict" in result && result.raceConflict) {
      await this.prisma.billingReconciliationCase.updateMany({
        where: { invocationId: admission.invocationId },
        data: {
          state: RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
          conflictingPayload: {
            reportedAttemptOrdinal: payload.attemptOrdinal,
            providerCompletionState: payload.providerCompletionState,
            inputTokens: payload.inputTokens ?? 0,
            outputTokens: payload.outputTokens ?? 0,
            totalTokens: payload.totalTokens ?? 0,
            durationMs: payload.durationMs ?? null,
            providerResponseId: payload.providerResponseId ?? null,
            finishReason: payload.finishReason ?? null,
            reportedAt: now.toISOString(),
          },
          conflictDetectedAt: now,
          version: { increment: 1 },
        },
      });

      throw problemException(
        BILLING_ERROR_CODES.reconciliationAlreadyResolved,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    return result;
  }
}
