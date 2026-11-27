import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { PublishModelTariffDraftResponse } from "@lcsp/contracts/billing";
import { ModelPricingInvalidIntervalError } from "../../../domain/billing.errors.js";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
} from "../../../domain/repositories/model-pricing.port.js";
import {
  toModelTariffAssignmentView,
  toModelTariffDraftView,
  toModelTariffSnapshotView,
} from "../../mappers/model-pricing-view.mapper.js";
import { PublishModelTariffDraftCommand } from "./publish-model-tariff-draft.command.js";

/**
 * Business purpose: Parse and validate an ISO-8601 UTC timestamp string into a `Date` instance for publish effective intervals.
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
 * Business purpose: Parse and validate an ISO UTC date string into a Date instance for tariff publication boundaries.
 *
 * Business rules:
 * - String must parse into a finite timestamp in UTC milliseconds.
 * - Non-finite timestamps are rejected to prevent corrupt assignment intervals.
 *
 * Execution flow:
 * 1. Instantiate Date from ISO string.
 * 2. Validate timestamp with Number.isFinite.
 * 3. Return parsed Date if valid.
 *
 * Failure cases:
 * - Throws ModelPricingInvalidIntervalError if date string cannot be parsed into a valid timestamp.
 *
 * Side effects:
 * - Pure validation and parsing helper; no persistence or state mutations.
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
// Rationale ("Why"): Ensures tariff interval timestamps are valid before domain processing.
// Mechanism ("How"): Checks Date.getTime() validity and raises domain error on failure.
// Invariants & Constraints: Fails closed on invalid date inputs.
function parseUtcDate(fieldName: string, iso: string): Date {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ModelPricingInvalidIntervalError(
      `Invalid UTC timestamp for ${fieldName}`,
    );
  }
  return parsed;
}

@CommandHandler(PublishModelTariffDraftCommand)
export class PublishModelTariffDraftHandler implements ICommandHandler<PublishModelTariffDraftCommand> {
  constructor(
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly repo: ModelPricingRepositoryPort,
  ) {}

  /**
   * Business purpose: Publish a `DRAFT` tariff atomically into an immutable `CustomerModelTariffSnapshot`, a half-open `[effectiveFrom, effectiveTo)` assignment, and an `AuditEvent`.
   *
   * Business rules:
   * - Requires `idempotencyKey`, canonical `requestFingerprint`, `auditReason`, `expectedDraftVersion`, and valid half-open UTC interval `[effectiveFrom, effectiveTo)`.
   * - Supports exact idempotent replay (`idempotentReplay: true`) and rejects conflicting payloads under the same `idempotencyKey` (`409`).
   * - Delegates DB-clock resolution, advisory scope locking, allowlist/rate checks, GiST overlap enforcement, and audit persistence to `repo.publishDraft`.
   *
   * Execution flow:
   * 1. Parse and validate `[effectiveFrom, effectiveTo)` UTC timestamps (`effectiveTo > effectiveFrom` when non-null).
   * 2. Execute transactional `repo.publishDraft`.
   * 3. Project draft, immutable snapshot, assignment (status at `dbUtcNow`), `auditEventId`, and `idempotentReplay`.
   *
   * Failure cases:
   * - Throws `ModelPricingInvalidIntervalError`, `BillingIdempotencyConflictError`, `ModelPricingNotFoundError`, `ModelPricingStaleDraftError`, `ModelPricingOverlapConflictError`, or `ModelPricingUnlistedModelError`.
   *
   * Side effects:
   * - Creates immutable snapshot + assignment + audit event and transitions draft to `PUBLISHED` atomically.
   */
  async execute(
    command: PublishModelTariffDraftCommand,
  ): Promise<PublishModelTariffDraftResponse> {
    // Why: Publishing promotes an editable draft into immutable billing authority without partial state or overlap races.
    // How: Validates UTC interval bounds first, then delegates idempotent atomic persistence to `repo.publishDraft`.
    // Invariants: Snapshot, assignment, draft transition, and AuditEvent always commit or roll back together.
    const { input } = command;
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

    const published = await this.repo.publishDraft({
      draftId: input.draftId,
      idempotencyKey: input.idempotencyKey.trim(),
      requestFingerprint: input.requestFingerprint.trim(),
      auditReason: input.auditReason.trim(),
      expectedDraftVersion: input.expectedDraftVersion,
      effectiveFrom,
      effectiveTo,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    return {
      draft: toModelTariffDraftView(published.draft),
      snapshot: toModelTariffSnapshotView(published.snapshot),
      assignment: toModelTariffAssignmentView(
        published.assignment,
        published.dbUtcNow,
      ),
      auditEventId: published.auditEventId,
      idempotentReplay: published.idempotentReplay,
    };
  }
}
