import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { SupersedeModelTariffAssignmentResponse } from "@lcsp/contracts/billing";
import {
  BillingIdempotencyConflictError,
  InvalidBillingInputError,
  ModelPricingInvalidIntervalError,
} from "../../../domain/billing.errors.js";
import {
  MODEL_PRICING_FINGERPRINT_ACTIONS,
  computeModelPricingRequestFingerprint,
} from "../../../domain/model-pricing-fingerprint.js";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
} from "../../../domain/repositories/model-pricing.port.js";
import {
  toModelTariffAssignmentView,
  toModelTariffSnapshotView,
} from "../../mappers/model-pricing-view.mapper.js";
import { SupersedeModelTariffAssignmentCommand } from "./supersede-model-tariff-assignment.command.js";

/**
 * Business purpose: Parse and validate an ISO-8601 UTC timestamp string into a `Date` instance for supersede effective intervals.
 *
 * Business rules:
 * - Rejects unparseable or non-finite timestamps with `ModelPricingInvalidIntervalError`.
 *
 * Execution flow:
 * 1. Construct `new Date(iso)` and verify `Number.isFinite(parsed.getTime())`.
 *
 * Failure cases:
 * - Throws `ModelPricingInvalidIntervalError` when the timestamp is invalid.
 *
 * Side effects:
 * - None: pure validation helper.
 */
/**
 * Business purpose: Parse and validate an ISO timestamp string into a valid UTC Date object for interval boundaries.
 *
 * Business rules:
 * - String must parse into a finite timestamp in milliseconds.
 * - Rejects unparseable or invalid date values.
 *
 * Execution flow:
 * 1. Instantiate Date with ISO string.
 * 2. Validate getTime() is finite.
 * 3. Return Date instance.
 *
 * Failure cases:
 * - Throws ModelPricingInvalidIntervalError if timestamp is not a finite date.
 *
 * Side effects:
 * - Pure parser function.
 */
// Rationale ("Why"): Ensures replacement interval timestamps are valid before assignment supersede execution.
// Mechanism ("How"): Checks Date.getTime() validity and raises domain error on failure.
// Invariants & Constraints: Fails closed on invalid date inputs.
/**
 * Business purpose: Parse and validate an ISO UTC date string into a Date instance for assignment supersede intervals.
 *
 * Business rules:
 * - String must parse into a finite timestamp in UTC milliseconds.
 * - Non-finite timestamps are rejected to prevent invalid assignment boundary timestamps.
 *
 * Execution flow:
 * 1. Instantiate Date from ISO string.
 * 2. Validate timestamp with Number.isFinite.
 * 3. Return parsed Date if valid.
 *
 * Failure cases:
 * - Throws ModelPricingInvalidIntervalError if date string is invalid.
 *
 * Side effects:
 * - Pure validation and parsing helper; no mutations.
 */
function parseUtcDate(fieldName: string, iso: string): Date {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ModelPricingInvalidIntervalError(
      `Invalid UTC timestamp for ${fieldName}`,
    );
  }
  return parsed;
}

@CommandHandler(SupersedeModelTariffAssignmentCommand)
export class SupersedeModelTariffAssignmentHandler implements ICommandHandler<SupersedeModelTariffAssignmentCommand> {
  constructor(
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly repo: ModelPricingRepositoryPort,
  ) {}

  /**
   * Business purpose: Supersede an active or scheduled tariff assignment with a replacement draft or existing snapshot without mutating historical snapshots.
   *
   * Business rules:
   * - Requires strict XOR between `replacementDraftId` and `replacementSnapshotId`.
   * - Enforces canonical `requestFingerprint` parity and valid half-open UTC interval `[effectiveFrom, effectiveTo)`.
   * - Historical `CustomerModelTariffSnapshot` rows are strictly immutable and never modified.
   *
   * Execution flow:
   * 1. Enforce strict XOR target selection and validate `[effectiveFrom, effectiveTo)` UTC interval bounds.
   * 2. Recompute canonical supersede `requestFingerprint` and reject mismatched caller fingerprints.
   * 3. Delegate atomic supersede + audit logging to `repo.supersedeAssignment` and project views at `dbUtcNow`.
   *
   * Failure cases:
   * - Throws `InvalidBillingInputError`, `ModelPricingInvalidIntervalError`, `BillingIdempotencyConflictError`, `ModelPricingNotFoundError`, `ModelPricingInvalidStateError`, `ModelPricingStaleDraftError`, or `ModelPricingOverlapConflictError`.
   *
   * Side effects:
   * - Updates superseded assignment window/metadata, inserts replacement assignment (and new snapshot if from draft), and records `AuditEvent` atomically.
   */
  async execute(
    command: SupersedeModelTariffAssignmentCommand,
  ): Promise<SupersedeModelTariffAssignmentResponse> {
    // Why: Price rotations must close or cancel the prior assignment and activate a replacement atomically
    // while leaving historical snapshots untouched for financial provenance.
    // How: Enforces XOR target + interval + fingerprint invariants before delegating atomic persistence to `repo.supersedeAssignment`.
    // Invariants: Never mutates historical snapshots; preserves idempotency replay and conflict guarantees.
    const { input } = command;

    const hasDraft = input.replacementDraftId !== undefined;
    const hasSnapshot = input.replacementSnapshotId !== undefined;
    if (hasDraft === hasSnapshot) {
      throw new InvalidBillingInputError(
        "Exactly one of replacementDraftId or replacementSnapshotId must be provided",
      );
    }

    const effectiveFrom = parseUtcDate("effectiveFrom", input.effectiveFrom);
    const effectiveTo =
      input.effectiveTo !== undefined && input.effectiveTo !== null
        ? parseUtcDate("effectiveTo", input.effectiveTo)
        : null;

    if (
      effectiveTo !== null &&
      effectiveTo.getTime() <= effectiveFrom.getTime()
    ) {
      throw new ModelPricingInvalidIntervalError(
        "effectiveTo must be strictly greater than effectiveFrom",
      );
    }

    const canonicalFingerprint = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment,
      assignmentId: input.assignmentId,
      effectiveFrom,
      effectiveTo,
      replacementDraftId: input.replacementDraftId ?? null,
      replacementSnapshotId: input.replacementSnapshotId ?? null,
      auditReason: input.auditReason,
    });

    if (input.requestFingerprint.trim() !== canonicalFingerprint) {
      throw new BillingIdempotencyConflictError(
        "requestFingerprint does not match canonical supersede payload",
      );
    }

    const result = await this.repo.supersedeAssignment({
      assignmentId: input.assignmentId,
      idempotencyKey: input.idempotencyKey.trim(),
      requestFingerprint: canonicalFingerprint,
      auditReason: input.auditReason.trim(),
      expectedAssignmentVersion: input.expectedAssignmentVersion,
      effectiveFrom,
      effectiveTo,
      replacementDraftId: input.replacementDraftId,
      expectedDraftVersion: input.expectedDraftVersion,
      replacementSnapshotId: input.replacementSnapshotId,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return {
      supersededAssignment: toModelTariffAssignmentView(
        result.supersededAssignment,
        result.dbUtcNow,
      ),
      replacementAssignment: toModelTariffAssignmentView(
        result.replacementAssignment,
        result.dbUtcNow,
      ),
      replacementSnapshot: toModelTariffSnapshotView(
        result.replacementSnapshot,
      ),
      auditEventId: result.auditEventId,
      idempotentReplay: result.idempotentReplay,
    };
  }
}
