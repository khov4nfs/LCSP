import {
  BillingConcurrencyError,
  BillingDomainError,
  BillingIdempotencyConflictError,
  InvalidBillingInputError,
  ModelPricingImmutableSnapshotError,
  ModelPricingIncompleteRatesError,
  ModelPricingInvalidIntervalError,
  ModelPricingNotFoundError,
  ModelPricingOverlapConflictError,
  ModelPricingStaleDraftError,
} from "../../domain/billing.errors.js";

/**
 * Normalized PostgreSQL and Prisma error metadata extracted across Prisma 7 `@prisma/adapter-pg` error shapes.
 */
export type ExtractedPostgresError = {
  prismaCode?: string;
  pgCode?: string;
  pgMessage?: string;
  constraint?: string;
  targetFields: readonly string[];
};

const RETRYABLE_PG_CODES = new Set<string>(["40001", "40P01", "55P03"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * Business purpose: Extract normalized Prisma and PostgreSQL SQLSTATE metadata from Prisma 7 `@prisma/adapter-pg` exceptions.
 *
 * Business rules:
 * - Inspects top-level Prisma error properties, direct `DriverAdapterError.cause`, and `meta.driverAdapterError.cause`.
 * - Never throws on malformed or non-object error values; returns an empty metadata record instead.
 *
 * Execution flow:
 * 1. Read optional `code` and `meta` fields from the top-level error object.
 * 2. Inspect `error.cause` (direct `DriverAdapterError` on ORM calls) and `error.meta.driverAdapterError.cause` (raw queries).
 * 3. Extract `pgCode` (`originalCode ?? code`), `pgMessage`, `constraint`, and unique target fields.
 *
 * Failure cases:
 * - None: returns safely extracted metadata for downstream classification without exposing raw PG details.
 *
 * Side effects:
 * - None: pure inspection helper.
 */
export function extractPostgresErrorMetadata(
  error: unknown,
): ExtractedPostgresError {
  // Why: Prisma 7 with `@prisma/adapter-pg` surfaces `23P01`, `23514`, and `P0001` as `DriverAdapterError`
  // with `error.code === undefined` and SQLSTATE nested under `cause.originalCode`, while raw SQL throws `P2010`
  // with `meta.driverAdapterError.cause.originalCode`.
  // How: Checks all three error nesting paths (`error`, `error.cause`, `error.meta.driverAdapterError.cause`).
  // Invariants: Never leaks raw driver detail strings to HTTP callers; returns sanitized structural metadata only.
  const root = asRecord(error);
  if (!root) {
    return { targetFields: [] };
  }

  const meta = asRecord(root.meta);
  const directCause = asRecord(root.cause);
  const adapterError = asRecord(meta?.driverAdapterError);
  const adapterCause = asRecord(adapterError?.cause);
  const pgCause = directCause ?? adapterCause;

  const prismaCode = asNonEmptyString(root.code);
  const pgCode =
    asNonEmptyString(pgCause?.originalCode) ?? asNonEmptyString(pgCause?.code);
  const pgMessage =
    asNonEmptyString(pgCause?.originalMessage) ??
    asNonEmptyString(pgCause?.message) ??
    asNonEmptyString(root.message);

  const causeConstraint = asRecord(pgCause?.constraint);
  const constraint =
    asNonEmptyString(causeConstraint?.index) ??
    asNonEmptyString(pgCause?.constraint);

  const rawFields = Array.isArray(causeConstraint?.fields)
    ? causeConstraint.fields
    : Array.isArray(meta?.target)
      ? meta.target
      : [];
  const targetFields = rawFields
    .map((field) => asNonEmptyString(field))
    .filter((field): field is string => field !== undefined);

  return {
    prismaCode,
    pgCode,
    pgMessage,
    constraint,
    targetFields,
  };
}

/**
 * Business purpose: Determine whether a persistence failure represents a transient PostgreSQL serialization or deadlock conflict eligible for bounded retry.
 *
 * Business rules:
 * - Retries only `P2034` (`TransactionWriteConflict`) and PostgreSQL `40001`, `40P01`, or `55P03`.
 *
 * Execution flow:
 * 1. Extract Prisma and PostgreSQL SQLSTATE metadata via `extractPostgresErrorMetadata`.
 * 2. Return true when `prismaCode === "P2034"` or `pgCode` matches a retryable conflict code.
 *
 * Failure cases:
 * - None: returns false for non-retryable or domain errors.
 *
 * Side effects:
 * - None: pure predicate.
 */
export function isRetryableTransactionConflict(error: unknown): boolean {
  // Why: Concurrent transactions acquiring row/advisory locks or encountering serialization conflicts can succeed on bounded retry.
  // How: Checks Prisma `P2034` and PG SQLSTATE `40001`/`40P01`/`55P03` without retrying deterministic constraint failures (`23P01`, `P0001`).
  // Invariants: Never retries non-transient domain or integrity violations.
  const meta = extractPostgresErrorMetadata(error);
  return (
    meta.prismaCode === "P2034" ||
    (meta.pgCode !== undefined && RETRYABLE_PG_CODES.has(meta.pgCode))
  );
}

/**
 * Business purpose: Translate Prisma and PostgreSQL persistence exceptions into typed opaque `ModelPricingDomainError` / `BillingDomainError` exceptions.
 *
 * Business rules:
 * - Domain errors already thrown inside transactions pass through unchanged.
 * - `23P01` (`CustomerModelTariffAssignment_no_overlap`) maps to `ModelPricingOverlapConflictError` (409).
 * - `P0001` (`CustomerModelTariffSnapshot_immutable`) maps to `ModelPricingImmutableSnapshotError` (409).
 * - `23514` CHECK violations map by constraint name (`*_interval_valid`, `*_rates_non_negative`, `*_scope_identity_check`).
 * - `P2002` (`23505`) unique violations map to `BillingIdempotencyConflictError` or `ModelPricingStaleDraftError`.
 * - `P2025` maps to `ModelPricingNotFoundError` (404).
 * - `P2034` / `40001` map to `BillingConcurrencyError` (409).
 * - Raw PostgreSQL table/column/detail strings are never forwarded in thrown domain error messages.
 *
 * Execution flow:
 * 1. Re-throw existing `BillingDomainError` instances untouched.
 * 2. Extract Prisma/PG error metadata and classify by `pgCode`, `prismaCode`, constraint name, and target fields.
 * 3. Throw the corresponding domain error, or rethrow unknown non-classified errors for global 500 masking.
 *
 * Failure cases:
 * - Always throws a typed domain error or the original unclassified error.
 *
 * Side effects:
 * - None: pure error translation helper.
 */
export function mapPrismaModelPricingPersistenceError(error: unknown): never {
  // Why: Raw `DriverAdapterError` and `PrismaClientKnownRequestError` objects contain database constraint/table details
  // and would otherwise trigger generic 500 errors instead of deterministic 404/409/422 RFC 7807 Problem responses.
  // How: Normalizes PG SQLSTATE across all Prisma 7 adapter paths and emits opaque domain errors without raw PG `detail`.
  // Invariants: Never exposes raw SQL text, schema names, or row values in error messages.
  if (error instanceof BillingDomainError) {
    throw error;
  }

  const meta = extractPostgresErrorMetadata(error);
  const messageText = meta.pgMessage ?? "";
  const constraintText = `${meta.constraint ?? ""} ${messageText}`;

  if (
    meta.pgCode === "23P01" ||
    constraintText.includes("CustomerModelTariffAssignment_no_overlap")
  ) {
    throw new ModelPricingOverlapConflictError(
      "Effective tariff assignment interval overlaps an existing active assignment for this scope",
    );
  }

  if (
    meta.pgCode === "P0001" &&
    (constraintText.includes("CustomerModelTariffSnapshot") ||
      constraintText.includes("append-only"))
  ) {
    throw new ModelPricingImmutableSnapshotError(
      "Published customer model tariff snapshots are immutable and append-only",
    );
  }

  if (meta.pgCode === "23514") {
    if (constraintText.includes("_interval_valid")) {
      throw new ModelPricingInvalidIntervalError(
        "Assignment effectiveTo must be strictly greater than effectiveFrom",
      );
    }
    if (constraintText.includes("_rates_non_negative")) {
      throw new ModelPricingIncompleteRatesError(
        "Tariff microcredit rates must be non-negative integers",
      );
    }
    if (constraintText.includes("_scope_identity_check")) {
      throw new InvalidBillingInputError(
        "Tariff scope does not match provider and resolvedModel cardinality",
      );
    }
    throw new InvalidBillingInputError(
      "Tariff payload violated database check invariant",
    );
  }

  if (meta.prismaCode === "P2002" || meta.pgCode === "23505") {
    const joinedTargets = `${meta.targetFields.join(",")} ${constraintText}`;
    if (
      joinedTargets.includes("idempotencyKey") ||
      joinedTargets.includes("supersedeIdempotencyKey") ||
      joinedTargets.includes("publishedSnapshotId")
    ) {
      throw new BillingIdempotencyConflictError(
        "Idempotency key or published snapshot already exists for another operation",
      );
    }
    if (joinedTargets.includes("normalizedScopeKey")) {
      throw new ModelPricingStaleDraftError(
        "Concurrent tariff snapshot version conflict detected for this scope",
      );
    }
    throw new BillingConcurrencyError(
      "Unique constraint conflict while persisting model tariff change",
    );
  }

  if (meta.prismaCode === "P2025") {
    throw new ModelPricingNotFoundError(
      "Requested model tariff record was not found",
    );
  }

  if (
    meta.prismaCode === "P2034" ||
    (meta.pgCode !== undefined && RETRYABLE_PG_CODES.has(meta.pgCode))
  ) {
    throw new BillingConcurrencyError(
      "Concurrent tariff modification detected; retry the operation",
    );
  }

  throw error;
}
