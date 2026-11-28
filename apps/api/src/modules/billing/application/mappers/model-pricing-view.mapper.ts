import type { ConfigService } from "@nestjs/config";
import {
  MODEL_USAGE_DEBIT_MODES,
  PRICING_ASSIGNMENT_STATUSES,
  type MicrocreditTariffRates,
  type ModelTariffAssignmentView,
  type ModelTariffDraftView,
  type ModelTariffRateScheduleView,
  type ModelTariffSnapshotView,
  type PricingAssignmentStatus,
  type TokenBucketPolicy,
} from "@lcsp/contracts/billing";
import type {
  AppConfig,
  ModelUsageDebitConfig,
} from "../../../../config/config.types.js";
import { BillingDomainError } from "../../domain/billing.errors.js";
import type {
  ModelTariffAssignmentRecord,
  ModelTariffDraftRecord,
  ModelTariffSnapshotRecord,
} from "../../domain/repositories/model-pricing.port.js";

export type SafeModelUsageDebitMode =
  typeof MODEL_USAGE_DEBIT_MODES.OFF | typeof MODEL_USAGE_DEBIT_MODES.SHADOW;

type RateRecordFields = {
  inputMicrocreditsPerMillion: bigint;
  outputMicrocreditsPerMillion: bigint;
  reasoningPolicy: TokenBucketPolicy;
  reasoningMicrocreditsPerMillion: bigint | null;
  cachedInputPolicy: TokenBucketPolicy;
  cachedInputMicrocreditsPerMillion: bigint | null;
  cacheWritePolicy: TokenBucketPolicy;
  cacheWriteMicrocreditsPerMillion: bigint | null;
  cacheWrite5mMicrocreditsPerMillion: bigint | null;
  cacheWrite1hMicrocreditsPerMillion: bigint | null;
};

/**
 * Business purpose: Read and enforce the `MODEL_USAGE_DEBIT` safety posture across Admin pricing read and preview endpoints.
 *
 * Business rules:
 * - Defaults to `MODEL_USAGE_DEBIT_MODES.OFF` when configuration is absent.
 * - Fails closed with `BillingDomainError` if `MODEL_USAGE_DEBIT` is ever `ON` during WP8 Phase B2.
 *
 * Execution flow:
 * 1. Read `modelUsageDebit.mode` from `ConfigService` when injected.
 * 2. Reject `MODEL_USAGE_DEBIT_MODES.ON` fail-closed.
 * 3. Return `OFF` or `SHADOW`.
 *
 * Failure cases:
 * - Throws `BillingDomainError` when configured mode is `ON`.
 *
 * Side effects:
 * - None: pure configuration read.
 */
export function readSafeModelUsageDebitMode(
  configService?: ConfigService<AppConfig, true>,
): SafeModelUsageDebitMode {
  // Why: WP8 Phase B2 must strictly preserve MODEL_USAGE_DEBIT=OFF without live wallet cutover or debit.
  // How: Mirrors `BillingUsageKernel` config resolution, defaulting to OFF and failing closed if ON.
  // Invariants: Return type excludes `MODEL_USAGE_DEBIT_MODES.ON`.
  const mode =
    configService?.get<ModelUsageDebitConfig>("modelUsageDebit")?.mode ??
    MODEL_USAGE_DEBIT_MODES.OFF;
  if (mode === MODEL_USAGE_DEBIT_MODES.ON) {
    throw new BillingDomainError(
      "MODEL_USAGE_DEBIT is disabled (OFF) until all WP8 enablement gates are closed",
    );
  }
  return mode;
}

/**
 * Business purpose: Derive the canonical `PricingAssignmentStatus` (`SCHEDULED` | `ACTIVE` | `SUPERSEDED`) for an assignment at a reference UTC timestamp.
 *
 * Business rules:
 * - Assignments that were cancelled, superseded, or whose half-open `effectiveTo <= referenceTime` has elapsed are `SUPERSEDED`.
 * - Assignments starting strictly in the future (`effectiveFrom > referenceTime`) are `SCHEDULED`.
 * - All remaining assignments (`effectiveFrom <= referenceTime < effectiveTo`) are `ACTIVE`.
 *
 * Execution flow:
 * 1. Check cancellation, supersede linkage, and `effectiveTo <= referenceTime`.
 * 2. Check `effectiveFrom > referenceTime` for `SCHEDULED`.
 * 3. Otherwise return `ACTIVE`.
 *
 * Failure cases:
 * - None: deterministic status projection.
 *
 * Side effects:
 * - None: pure function.
 */
export function deriveAssignmentStatus(
  assignment: ModelTariffAssignmentRecord,
  referenceTime: Date,
): PricingAssignmentStatus {
  // Why: Half-open `[effectiveFrom, effectiveTo)` assignments transition at DB UTC instants without requiring background cron mutations.
  // How: Evaluates supersede/cancellation flags first, then compares UTC milliseconds against `referenceTime`.
  // Invariants: Matches SQL active-window filter `cancelledAt IS NULL AND effectiveFrom <= t AND (effectiveTo IS NULL OR effectiveTo > t)`.
  const refMs = referenceTime.getTime();
  if (
    assignment.cancelledAt !== null ||
    assignment.supersededAt !== null ||
    assignment.supersededByAssignmentId !== null ||
    (assignment.effectiveTo !== null &&
      assignment.effectiveTo.getTime() <= refMs)
  ) {
    return PRICING_ASSIGNMENT_STATUSES.superseded;
  }
  if (assignment.effectiveFrom.getTime() > refMs) {
    return PRICING_ASSIGNMENT_STATUSES.scheduled;
  }
  return PRICING_ASSIGNMENT_STATUSES.active;
}

/**
 * Business purpose: Convert `bigint` persistence rate columns into canonical stringified `ModelTariffRateScheduleView` DTO fields.
 *
 * Business rules:
 * - Every `bigint` microcredit value is serialized via `.toString()` with zero floating-point conversion.
 *
 * Execution flow:
 * 1. Map required and nullable rate fields to base-10 strings or `null`.
 *
 * Failure cases:
 * - None: pure projection.
 *
 * Side effects:
 * - None: pure function.
 */
export function toModelTariffRateScheduleView(
  record: RateRecordFields,
): ModelTariffRateScheduleView {
  return {
    inputMicrocreditsPerMillion: record.inputMicrocreditsPerMillion.toString(),
    outputMicrocreditsPerMillion:
      record.outputMicrocreditsPerMillion.toString(),
    reasoningPolicy: record.reasoningPolicy,
    reasoningMicrocreditsPerMillion:
      record.reasoningMicrocreditsPerMillion !== null
        ? record.reasoningMicrocreditsPerMillion.toString()
        : null,
    cachedInputPolicy: record.cachedInputPolicy,
    cachedInputMicrocreditsPerMillion:
      record.cachedInputMicrocreditsPerMillion !== null
        ? record.cachedInputMicrocreditsPerMillion.toString()
        : null,
    cacheWritePolicy: record.cacheWritePolicy,
    cacheWriteMicrocreditsPerMillion:
      record.cacheWriteMicrocreditsPerMillion !== null
        ? record.cacheWriteMicrocreditsPerMillion.toString()
        : null,
    cacheWrite5mMicrocreditsPerMillion:
      record.cacheWrite5mMicrocreditsPerMillion !== null
        ? record.cacheWrite5mMicrocreditsPerMillion.toString()
        : null,
    cacheWrite1hMicrocreditsPerMillion:
      record.cacheWrite1hMicrocreditsPerMillion !== null
        ? record.cacheWrite1hMicrocreditsPerMillion.toString()
        : null,
  };
}

/**
 * Business purpose: Convert domain rate columns into `MicrocreditTariffRates` consumed by `ModelPricingCalculatorService`.
 *
 * Business rules:
 * - Null nullable rates become `undefined` so `assertCompleteTariffRates` never substitutes `0n` for missing rates.
 *
 * Execution flow:
 * 1. Copy required `bigint` input/output rates and bucket policies, converting nullable rates to `undefined` when null.
 *
 * Failure cases:
 * - None: pure adapter.
 *
 * Side effects:
 * - None: pure function.
 */
export function toMicrocreditTariffRates(
  record: RateRecordFields,
): MicrocreditTariffRates {
  return {
    input: record.inputMicrocreditsPerMillion,
    output: record.outputMicrocreditsPerMillion,
    reasoningPolicy: record.reasoningPolicy,
    reasoning: record.reasoningMicrocreditsPerMillion ?? undefined,
    cachedInputPolicy: record.cachedInputPolicy,
    cachedInput: record.cachedInputMicrocreditsPerMillion ?? undefined,
    cacheWritePolicy: record.cacheWritePolicy,
    cacheWrite: record.cacheWriteMicrocreditsPerMillion ?? undefined,
    cacheWrite5m: record.cacheWrite5mMicrocreditsPerMillion ?? undefined,
    cacheWrite1h: record.cacheWrite1hMicrocreditsPerMillion ?? undefined,
  };
}

/**
 * Business purpose: Project a `ModelTariffDraftRecord` into its canonical wire `ModelTariffDraftView`.
 *
 * Business rules:
 * - Converts all `bigint` rates to canonical base-10 strings and `Date` values to ISO-8601 UTC strings.
 *
 * Execution flow:
 * 1. Format rate schedule, timestamps, and metadata into `ModelTariffDraftView`.
 *
 * Failure cases:
 * - None: pure projection.
 *
 * Side effects:
 * - None: pure function.
 */
export function toModelTariffDraftView(
  record: ModelTariffDraftRecord,
): ModelTariffDraftView {
  return {
    id: record.id,
    scope: record.scope,
    provider: record.provider,
    resolvedModel: record.resolvedModel,
    normalizedScopeKey: record.normalizedScopeKey,
    status: record.status,
    version: record.version,
    ...toModelTariffRateScheduleView(record),
    operationalAssumptions: record.operationalAssumptions,
    publishedSnapshotId: record.publishedSnapshotId,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Business purpose: Project an immutable `ModelTariffSnapshotRecord` into its canonical wire `ModelTariffSnapshotView`.
 *
 * Business rules:
 * - Preserves append-only provenance fields (`sourceDraftId`, `idempotencyKey`, `requestFingerprint`, `publishedBy`, `auditReason`).
 *
 * Execution flow:
 * 1. Format rate schedule, version counters, and ISO-8601 UTC timestamps into `ModelTariffSnapshotView`.
 *
 * Failure cases:
 * - None: pure projection.
 *
 * Side effects:
 * - None: pure function.
 */
export function toModelTariffSnapshotView(
  record: ModelTariffSnapshotRecord,
): ModelTariffSnapshotView {
  return {
    id: record.id,
    sourceDraftId: record.sourceDraftId,
    scope: record.scope,
    provider: record.provider,
    resolvedModel: record.resolvedModel,
    normalizedScopeKey: record.normalizedScopeKey,
    version: record.version,
    accountingUnitVersion: record.accountingUnitVersion,
    ...toModelTariffRateScheduleView(record),
    idempotencyKey: record.idempotencyKey,
    requestFingerprint: record.requestFingerprint,
    publishedBy: record.publishedBy,
    auditReason: record.auditReason,
    publishedAt: record.publishedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Business purpose: Project a `ModelTariffAssignmentRecord` into its canonical wire `ModelTariffAssignmentView` with derived status.
 *
 * Business rules:
 * - Derives `SCHEDULED` | `ACTIVE` | `SUPERSEDED` deterministically from `referenceTime`.
 *
 * Execution flow:
 * 1. Compute derived `status` via `deriveAssignmentStatus`.
 * 2. Format UTC ISO timestamps and nullable supersede metadata.
 *
 * Failure cases:
 * - None: pure projection.
 *
 * Side effects:
 * - None: pure function.
 */
export function toModelTariffAssignmentView(
  record: ModelTariffAssignmentRecord,
  referenceTime: Date,
): ModelTariffAssignmentView {
  return {
    id: record.id,
    tariffSnapshotId: record.tariffSnapshotId,
    scope: record.scope,
    normalizedScopeKey: record.normalizedScopeKey,
    status: deriveAssignmentStatus(record, referenceTime),
    version: record.version,
    effectiveFrom: record.effectiveFrom.toISOString(),
    effectiveTo: record.effectiveTo ? record.effectiveTo.toISOString() : null,
    supersededByAssignmentId: record.supersededByAssignmentId,
    supersededBy: record.supersededBy,
    supersededAt: record.supersededAt
      ? record.supersededAt.toISOString()
      : null,
    cancelledAt: record.cancelledAt ? record.cancelledAt.toISOString() : null,
    auditReason: record.auditReason,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
  };
}
