import { createHash } from "node:crypto";
import {
  normalizeModelPricingScopeKey,
  type ModelPricingScope,
} from "@lcsp/contracts/billing";
import { ModelPricingInvalidIntervalError } from "./billing.errors.js";

/**
 * Canonical action identifiers included inside model-pricing request fingerprints.
 * Why: Prevents cross-command fingerprint collisions between draft publish and assignment supersede payloads.
 * How: Uses `as const` SCREAMING_SNAKE_CASE constants with a derived union type.
 * Invariants: Included in the hashed canonical JSON payload for every publish and supersede call.
 */
export const MODEL_PRICING_FINGERPRINT_ACTIONS = {
  publishDraft: "PUBLISH_DRAFT",
  supersedeAssignment: "SUPERSEDE_ASSIGNMENT",
} as const;

export type ModelPricingFingerprintAction =
  (typeof MODEL_PRICING_FINGERPRINT_ACTIONS)[keyof typeof MODEL_PRICING_FINGERPRINT_ACTIONS];

export type PublishModelPricingFingerprintInput = {
  action: typeof MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft;
  draftId: string;
  expectedDraftVersion: number;
  scope: ModelPricingScope;
  provider?: string | null;
  resolvedModel?: string | null;
  effectiveFrom: string | Date;
  effectiveTo?: string | Date | null;
  auditReason: string;
  rates: {
    inputMicrocreditsPerMillion: string | bigint;
    outputMicrocreditsPerMillion: string | bigint;
    reasoningPolicy: string;
    reasoningMicrocreditsPerMillion?: string | bigint | null;
    cachedInputPolicy: string;
    cachedInputMicrocreditsPerMillion?: string | bigint | null;
    cacheWritePolicy: string;
    cacheWriteMicrocreditsPerMillion?: string | bigint | null;
    cacheWrite5mMicrocreditsPerMillion?: string | bigint | null;
    cacheWrite1hMicrocreditsPerMillion?: string | bigint | null;
  };
};

export type SupersedeModelPricingFingerprintInput = {
  action: typeof MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment;
  assignmentId: string;
  effectiveFrom: string | Date;
  effectiveTo?: string | Date | null;
  replacementDraftId?: string | null;
  replacementSnapshotId?: string | null;
  auditReason: string;
};

export type ModelPricingFingerprintInput =
  PublishModelPricingFingerprintInput | SupersedeModelPricingFingerprintInput;

/**
 * Business purpose: Normalize a UTC Date or ISO-8601 timestamp into a canonical UTC ISO-8601 string for fingerprinting.
 *
 * Business rules:
 * - Nullish timestamps normalize to `null` (open-ended `effectiveTo`).
 * - Equivalent UTC instants such as `+00:00`, `.000Z`, and `+07:00` normalize to the exact same `.toISOString()` representation.
 *
 * Execution flow:
 * 1. Return `null` when `value` is null or undefined.
 * 2. Convert `Date` or string inputs into a validated `Date` instance and emit `.toISOString()`.
 *
 * Failure cases:
 * - Throws `ModelPricingInvalidIntervalError` when the timestamp is unparseable or non-finite.
 *
 * Side effects:
 * - None: pure deterministic timestamp formatting.
 */
function normalizeFingerprintTimestamp(
  fieldName: string,
  value: string | Date | null | undefined,
): string | null {
  // Why: Equivalent ISO-8601 instants (`Z` vs `+00:00` vs `+07:00`) must produce identical fingerprints on replay.
  // How: Parses input to UTC `Date`, checks finite epoch value, and formats via `.toISOString()`.
  // Invariants: Returns either `null` or a canonical `YYYY-MM-DDTHH:mm:ss.sssZ` string.
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ModelPricingInvalidIntervalError(
      `Invalid UTC timestamp for ${fieldName}`,
    );
  }
  return date.toISOString();
}

/**
 * Business purpose: Normalize optional integer rate values into canonical base-10 strings or `null` for fingerprinting.
 *
 * Business rules:
 * - Both `undefined` and `null` map to `null` so omitted optional rates hash identically to explicit `null`.
 * - `bigint` and unsigned base-10 digit `string` rates (even with leading zeros such as `"0003000000"`) normalize to canonical `BigInt.toString()` representation.
 *
 * Execution flow:
 * 1. Return `null` for nullish inputs.
 * 2. Convert `bigint` via `.toString()`.
 * 3. Trim `string` inputs and, when matching `/^\d+$/`, canonicalize via `BigInt(trimmed).toString()`.
 *
 * Failure cases:
 * - None: non-digit strings fall back to trimmed string output without throwing.
 *
 * Side effects:
 * - None: pure normalization helper.
 */
function normalizeOptionalRateString(
  value: string | bigint | null | undefined,
): string | null {
  // Why: Request payloads may omit nullable bucket rates (`undefined`) or pass leading-zero digit strings (`"0003000000"`),
  // whereas persisted PostgreSQL `BIGINT` columns load as `bigint` (`3000000n` -> `"3000000"`).
  // How: Collapses nullish values to `null`, converts `bigint` via `.toString()`, and canonicalizes unsigned digit strings via `BigInt(trimmed).toString()`.
  // Invariants: Ensures exact replay parity between wire DTOs, direct domain callers, and database-backed entities.
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed).toString();
  }
  return trimmed;
}

/**
 * Business purpose: Recursively canonicalize JSON values by stripping `undefined` keys and sorting object keys lexicographically.
 *
 * Business rules:
 * - Object properties with `undefined` values are omitted while `null` values are preserved.
 * - Object keys at every nesting depth are sorted lexicographically (`localeCompare`-free ASCII code-unit order).
 *
 * Execution flow:
 * 1. Recursively canonicalize array elements in order.
 * 2. For plain objects, sort keys deterministically and copy only keys whose values are not `undefined`.
 * 3. Return primitive values unchanged.
 *
 * Failure cases:
 * - None: pure recursive transformation.
 *
 * Side effects:
 * - None: creates new sorted objects without mutating caller inputs.
 */
function canonicalizeJsonValue(value: unknown): unknown {
  // Why: `JSON.stringify` preserves insertion key order, causing identical semantic objects with reordered keys to hash differently.
  // How: Rebuilds plain objects with sorted keys and omits `undefined` properties recursively.
  // Invariants: Identical semantic JSON structures produce byte-for-byte identical serialized strings.
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        sorted[key] = canonicalizeJsonValue(entry);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Business purpose: Compute a deterministic 64-character SHA-256 hex request fingerprint for publish and supersede idempotency verification.
 *
 * Business rules:
 * - Fingerprints are invariant to object key ordering, `undefined` optional properties, provider casing, surrounding whitespace, and equivalent UTC ISO-8601 representations.
 * - Any change to action, target ID, draft version, normalized scope key, tariff rates, bucket policies, effective interval, replacement target, or audit reason yields a distinct digest.
 * - Transient transport metadata such as `idempotencyKey` and `correlationId` are excluded from the payload digest.
 *
 * Execution flow:
 * 1. Build the canonical normalized payload object for `PUBLISH_DRAFT` or `SUPERSEDE_ASSIGNMENT`.
 * 2. Canonicalize object key order recursively and serialize to deterministic JSON.
 * 3. Hash the UTF-8 canonical JSON string with SHA-256 and return lowercase hex.
 *
 * Failure cases:
 * - Throws `ModelPricingInvalidIntervalError` on invalid timestamps and throws on invalid scope identity via `normalizeModelPricingScopeKey`.
 *
 * Side effects:
 * - None: pure cryptographic hash computation using `node:crypto`.
 */
export function computeModelPricingRequestFingerprint(
  input: ModelPricingFingerprintInput,
): string {
  // Why: Idempotent publish and supersede endpoints must distinguish safe network retries (same key + same payload)
  // from conflicting mutations (same key + altered rates, interval, version, target, or audit reason).
  // How: Normalizes scope keys, UTC timestamps, rates, and strings into a canonical object, sorts keys, and hashes with SHA-256.
  // Invariants: Always returns a 64-char lowercase hex SHA-256 digest.
  let canonicalPayload: Record<string, unknown>;

  if (input.action === MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft) {
    const normalizedScopeKey = normalizeModelPricingScopeKey(
      input.scope,
      input.provider,
      input.resolvedModel,
    );
    canonicalPayload = {
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
      auditReason: input.auditReason.trim(),
      draftId: input.draftId.trim(),
      effectiveFrom: normalizeFingerprintTimestamp(
        "effectiveFrom",
        input.effectiveFrom,
      ),
      effectiveTo: normalizeFingerprintTimestamp(
        "effectiveTo",
        input.effectiveTo,
      ),
      expectedDraftVersion: input.expectedDraftVersion,
      normalizedScopeKey,
      rates: {
        cacheWrite1hMicrocreditsPerMillion: normalizeOptionalRateString(
          input.rates.cacheWrite1hMicrocreditsPerMillion,
        ),
        cacheWrite5mMicrocreditsPerMillion: normalizeOptionalRateString(
          input.rates.cacheWrite5mMicrocreditsPerMillion,
        ),
        cacheWriteMicrocreditsPerMillion: normalizeOptionalRateString(
          input.rates.cacheWriteMicrocreditsPerMillion,
        ),
        cacheWritePolicy: input.rates.cacheWritePolicy,
        cachedInputMicrocreditsPerMillion: normalizeOptionalRateString(
          input.rates.cachedInputMicrocreditsPerMillion,
        ),
        cachedInputPolicy: input.rates.cachedInputPolicy,
        inputMicrocreditsPerMillion: normalizeOptionalRateString(
          input.rates.inputMicrocreditsPerMillion,
        ),
        outputMicrocreditsPerMillion: normalizeOptionalRateString(
          input.rates.outputMicrocreditsPerMillion,
        ),
        reasoningMicrocreditsPerMillion: normalizeOptionalRateString(
          input.rates.reasoningMicrocreditsPerMillion,
        ),
        reasoningPolicy: input.rates.reasoningPolicy,
      },
      scope: input.scope,
    };
  } else {
    canonicalPayload = {
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment,
      assignmentId: input.assignmentId.trim(),
      auditReason: input.auditReason.trim(),
      effectiveFrom: normalizeFingerprintTimestamp(
        "effectiveFrom",
        input.effectiveFrom,
      ),
      effectiveTo: normalizeFingerprintTimestamp(
        "effectiveTo",
        input.effectiveTo,
      ),
      replacementDraftId: input.replacementDraftId?.trim() || null,
      replacementSnapshotId: input.replacementSnapshotId?.trim() || null,
    };
  }

  const canonicalJson = JSON.stringify(canonicalizeJsonValue(canonicalPayload));
  return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}
