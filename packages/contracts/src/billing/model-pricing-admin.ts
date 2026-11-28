import { z } from "zod";
import {
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_SCOPES,
  PRICING_ASSIGNMENT_STATUSES,
  TOKEN_BUCKET_POLICIES,
  microcreditDecimalSchema,
  microcreditIntegerStringSchema,
  normalizeModelPricingScopeKey,
  type ModelPricingScope,
  type TokenBucketPolicy,
} from "./microcredit-pricing.ts";
import { MODEL_USAGE_DEBIT_MODES } from "./usage-settlement.ts";

/**
 * Source kind returned by Admin model pricing preview calculations.
 * Why: Identifies whether a preview charge used a currently active assignment, a draft, a snapshot, or inline rates.
 * How: Defined as an `as const` SCREAMING_SNAKE_CASE lookup object with a derived union type.
 * Invariants: Shared identically between `apps/api` preview handlers and any future `apps/web` consumers.
 */
export const MODEL_PRICING_PREVIEW_SOURCES = {
  activeAssignment: "ACTIVE_ASSIGNMENT",
  draft: "DRAFT",
  snapshot: "SNAPSHOT",
  inlineRates: "INLINE_RATES",
} as const;

export type ModelPricingPreviewSource =
  (typeof MODEL_PRICING_PREVIEW_SOURCES)[keyof typeof MODEL_PRICING_PREVIEW_SOURCES];

const nonEmptyText = z.string().trim().min(1);

/**
 * Zod wire schema for canonical non-negative base-10 integer microcredit rates and token counts.
 * Why: Tariff rates and token usage counts must never be negative, fractional, or contain leading zeros
 * that would diverge from PostgreSQL `BIGINT` (`BigInt.toString()`) in request fingerprints.
 * How: Requires canonical unsigned base-10 integers (`/^(?:0|[1-9]\d*)$/`) and verifies compatibility with `microcreditIntegerStringSchema`.
 * Invariants: Matches PostgreSQL `>= 0` CHECK constraints and `BigInt.toString()` canonical representation on `CustomerModelTariffDraft` and `CustomerModelTariffSnapshot`.
 */
export const nonNegativeMicrocreditIntegerStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/)
  .refine((value) => microcreditIntegerStringSchema.safeParse(value).success, {
    message: "Must be a non-negative integer microcredit string",
  });

/**
 * Zod wire schema for ISO-8601 UTC timestamps requiring an explicit timezone offset (`Z` or `±HH:MM`).
 * Why: Rejects naive local datetimes so `[effectiveFrom, effectiveTo)` intervals are unambiguous in database UTC.
 * How: Uses Zod v4 `z.iso.datetime({ offset: true })`.
 * Invariants: Every persisted effective interval boundary carries explicit UTC or offset semantics.
 */
export const isoUtcDateTimeSchema = z.iso.datetime({ offset: true });

/**
 * Optional operational cost assumptions captured alongside a mutable pricing draft (never used at runtime).
 * Why: Allows admins to document reference assumptions on drafts without leaking markup/FX into settlement authority.
 * How: Strictly typed `z.strictObject` rejecting arbitrary extra keys.
 * Invariants: Never copied into `CustomerModelTariffSnapshot` or runtime charge math.
 */
export const operationalAssumptionsSchema = z.strictObject({
  providerPriceSource: nonEmptyText.max(200).optional(),
  providerPriceVersion: nonEmptyText.max(120).optional(),
  providerCurrency: nonEmptyText.max(16).optional(),
  referenceFxVndPerUsd: z
    .string()
    .regex(/^\d+(?:\.\d{1,6})?$/)
    .optional(),
  infrastructureOverheadPercent: z.number().min(0).max(1000).optional(),
  markupMultiplier: z.number().positive().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type OperationalAssumptions = z.infer<
  typeof operationalAssumptionsSchema
>;

/**
 * Canonical rate-schedule projection shared by preview responses, coverage rows, drafts, and snapshots.
 */
export const modelTariffRateScheduleViewSchema = z.strictObject({
  inputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
  outputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
  reasoningPolicy: z.enum(TOKEN_BUCKET_POLICIES),
  reasoningMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cachedInputPolicy: z.enum(TOKEN_BUCKET_POLICIES),
  cachedInputMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cacheWritePolicy: z.enum(TOKEN_BUCKET_POLICIES),
  cacheWriteMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cacheWrite5mMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cacheWrite1hMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
});

export type ModelTariffRateScheduleView = z.infer<
  typeof modelTariffRateScheduleViewSchema
>;

const inlineTariffRatesSchema = z.strictObject({
  inputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
  outputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
  reasoningPolicy: z.enum(TOKEN_BUCKET_POLICIES),
  reasoningMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
    .nullable()
    .optional(),
  cachedInputPolicy: z
    .enum(TOKEN_BUCKET_POLICIES)
    .default(TOKEN_BUCKET_POLICIES.unsupported),
  cachedInputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
    .nullable()
    .optional(),
  cacheWritePolicy: z
    .enum(TOKEN_BUCKET_POLICIES)
    .default(TOKEN_BUCKET_POLICIES.unsupported),
  cacheWriteMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
    .nullable()
    .optional(),
  cacheWrite5mMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
    .nullable()
    .optional(),
  cacheWrite1hMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
    .nullable()
    .optional(),
});

type DraftValidationInput = {
  scope?: ModelPricingScope;
  provider?: string | null;
  resolvedModel?: string | null;
  reasoningPolicy?: TokenBucketPolicy;
  reasoningMicrocreditsPerMillion?: string | null;
  cachedInputPolicy?: TokenBucketPolicy;
  cachedInputMicrocreditsPerMillion?: string | null;
  cacheWritePolicy?: TokenBucketPolicy;
  cacheWriteMicrocreditsPerMillion?: string | null;
  cacheWrite5mMicrocreditsPerMillion?: string | null;
  cacheWrite1hMicrocreditsPerMillion?: string | null;
};

/**
 * Business purpose: Validate token-bucket policy invariants and scope identity rules for model pricing drafts and inline preview rates.
 *
 * Business rules:
 * - `INCLUDED_IN_OUTPUT` is forbidden on input-side cache buckets (`cachedInputPolicy`, `cacheWritePolicy`).
 * - `SEPARATE_RATE` requires at least one corresponding non-null microcredit rate on the same payload.
 * - When `scope` is supplied, `(scope, provider, resolvedModel)` must pass `normalizeModelPricingScopeKey`.
 *
 * Execution flow:
 * 1. Check `cachedInputPolicy` and `cacheWritePolicy` against `INCLUDED_IN_OUTPUT`.
 * 2. Verify required rate fields exist whenever any bucket policy is `SEPARATE_RATE`.
 * 3. If `scope` is defined, normalize `(scope, provider, resolvedModel)` and record any scope validation issue.
 *
 * Failure cases:
 * - Adds targeted Zod custom issues on the offending field path when any invariant fails.
 *
 * Side effects:
 * - None: pure Zod refinement helper mutating only the validation issue context.
 */
function validateDraftRatesAndScope(
  input: DraftValidationInput,
  ctx: z.RefinementCtx,
): void {
  // Why: Prevents creating drafts or previewing rates that silently zero-rate secondary token buckets
  // or violate PostgreSQL `CustomerModelTariff*_scope_identity_check` constraints.
  // How: Inspects bucket policies and optional scope identity fields and emits field-scoped Zod issues.
  // Invariants: Mirrors `calculateMicrocreditCharge` and `normalizeModelPricingScopeKey` fail-closed rules.
  if (input.cachedInputPolicy === TOKEN_BUCKET_POLICIES.includedInOutput) {
    ctx.addIssue({
      code: "custom",
      path: ["cachedInputPolicy"],
      message: "INCLUDED_IN_OUTPUT is invalid for cachedInputPolicy",
    });
  }
  if (input.cacheWritePolicy === TOKEN_BUCKET_POLICIES.includedInOutput) {
    ctx.addIssue({
      code: "custom",
      path: ["cacheWritePolicy"],
      message: "INCLUDED_IN_OUTPUT is invalid for cacheWritePolicy",
    });
  }

  if (
    input.reasoningPolicy === TOKEN_BUCKET_POLICIES.separateRate &&
    !input.reasoningMicrocreditsPerMillion
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["reasoningMicrocreditsPerMillion"],
      message:
        "reasoningMicrocreditsPerMillion is required when reasoningPolicy is SEPARATE_RATE",
    });
  }
  if (
    input.cachedInputPolicy === TOKEN_BUCKET_POLICIES.separateRate &&
    !input.cachedInputMicrocreditsPerMillion
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["cachedInputMicrocreditsPerMillion"],
      message:
        "cachedInputMicrocreditsPerMillion is required when cachedInputPolicy is SEPARATE_RATE",
    });
  }
  if (
    input.cacheWritePolicy === TOKEN_BUCKET_POLICIES.separateRate &&
    !input.cacheWriteMicrocreditsPerMillion &&
    !input.cacheWrite5mMicrocreditsPerMillion &&
    !input.cacheWrite1hMicrocreditsPerMillion
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["cacheWriteMicrocreditsPerMillion"],
      message:
        "At least one cache-write rate is required when cacheWritePolicy is SEPARATE_RATE",
    });
  }

  if (input.scope !== undefined) {
    try {
      normalizeModelPricingScopeKey(
        input.scope,
        input.provider,
        input.resolvedModel,
      );
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["scope"],
        message:
          error instanceof Error
            ? error.message
            : "Invalid pricing scope identity",
      });
    }
  }
}

/**
 * Business purpose: Validate partial draft-update patches for optimistic version updates without allowing empty or invalid policy transitions.
 *
 * Business rules:
 * - At least one editable field besides `expectedVersion` must be supplied.
 * - Any bucket policy or rate invariants present in the patch must satisfy `validateDraftRatesAndScope`.
 *
 * Execution flow:
 * 1. Check whether any editable key in the patch is defined.
 * 2. Delegate policy/rate/scope checks to `validateDraftRatesAndScope`.
 *
 * Failure cases:
 * - Adds a custom Zod issue if the patch has no editable fields or violates policy/rate/scope rules.
 *
 * Side effects:
 * - None: pure Zod refinement helper mutating only the validation issue context.
 */
function validateUpdateDraftPatch(
  input: DraftValidationInput & {
    expectedVersion: number;
    inputMicrocreditsPerMillion?: string;
    outputMicrocreditsPerMillion?: string;
    operationalAssumptions?: OperationalAssumptions | null;
  },
  ctx: z.RefinementCtx,
): void {
  // Why: Empty PATCH requests would bump draft version or record misleading audit events with no changes.
  // How: Checks every editable property key and requires at least one non-undefined field alongside expectedVersion.
  // Invariants: Backend update handler still validates the merged full draft state before persistence.
  const hasEditableField =
    input.scope !== undefined ||
    input.provider !== undefined ||
    input.resolvedModel !== undefined ||
    input.inputMicrocreditsPerMillion !== undefined ||
    input.outputMicrocreditsPerMillion !== undefined ||
    input.reasoningPolicy !== undefined ||
    input.reasoningMicrocreditsPerMillion !== undefined ||
    input.cachedInputPolicy !== undefined ||
    input.cachedInputMicrocreditsPerMillion !== undefined ||
    input.cacheWritePolicy !== undefined ||
    input.cacheWriteMicrocreditsPerMillion !== undefined ||
    input.cacheWrite5mMicrocreditsPerMillion !== undefined ||
    input.cacheWrite1hMicrocreditsPerMillion !== undefined ||
    input.operationalAssumptions !== undefined;

  if (!hasEditableField) {
    ctx.addIssue({
      code: "custom",
      message: "At least one editable draft field must be provided",
    });
  }

  validateDraftRatesAndScope(input, ctx);
}

/**
 * Business purpose: Enforce mutually exclusive tariff-source selection when previewing model pricing calculations.
 *
 * Business rules:
 * - At most one of `draftId`, `snapshotId`, or inline `rates` may be provided; omitting all three resolves the effective active assignment.
 * - When inline `rates` are provided, bucket policy/rate completeness rules apply immediately.
 *
 * Execution flow:
 * 1. Count how many of `draftId`, `snapshotId`, and `rates` are defined.
 * 2. Reject payloads specifying more than one source, and validate inline `rates` if present.
 *
 * Failure cases:
 * - Adds custom Zod issues when multiple tariff sources are supplied or inline rates fail policy/rate checks.
 *
 * Side effects:
 * - None: pure Zod refinement helper.
 */
function validatePreviewSourceSelection(
  input: {
    draftId?: string;
    snapshotId?: string;
    rates?: DraftValidationInput;
  },
  ctx: z.RefinementCtx,
): void {
  // Why: Ambiguous preview requests mixing draftId, snapshotId, and inline rates would hide which authority produced the quote.
  // How: Counts defined source selectors and rejects count > 1, then runs `validateDraftRatesAndScope` on inline rates.
  // Invariants: Omitting all three selectors resolves the effective published assignment for `(provider, resolvedModel, effectiveAt)`.
  const sourceCount =
    Number(input.draftId !== undefined) +
    Number(input.snapshotId !== undefined) +
    Number(input.rates !== undefined);
  if (sourceCount > 1) {
    ctx.addIssue({
      code: "custom",
      message: "Provide at most one of draftId, snapshotId, or rates",
    });
  }
  if (input.rates !== undefined) {
    validateDraftRatesAndScope(input.rates, ctx);
  }
}

/**
 * Business purpose: Enforce half-open UTC interval validity `[effectiveFrom, effectiveTo)` on publish and supersede requests.
 *
 * Business rules:
 * - `effectiveTo` may be null/undefined (open-ended) or strictly greater than `effectiveFrom` (`effectiveTo > effectiveFrom`).
 *
 * Execution flow:
 * 1. Return immediately when `effectiveTo` is null or undefined.
 * 2. Parse both ISO timestamps to epoch milliseconds and assert `toMs > fromMs`.
 *
 * Failure cases:
 * - Adds a custom Zod issue on `effectiveTo` when `effectiveTo <= effectiveFrom` or timestamps cannot be parsed.
 *
 * Side effects:
 * - None: pure Zod refinement helper matching `CustomerModelTariffAssignment_interval_valid`.
 */
function validateUtcEffectiveInterval(
  input: { effectiveFrom: string; effectiveTo?: string | null },
  ctx: z.RefinementCtx,
): void {
  // Why: Mirrors PostgreSQL CHECK `("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")` at DTO validation boundary.
  // How: Compares parsed UTC millisecond instants when `effectiveTo` is non-null.
  // Invariants: Zero-width `[t, t)` and inverted `[t2, t1)` intervals are rejected before DB transaction entry.
  if (input.effectiveTo === undefined || input.effectiveTo === null) {
    return;
  }
  const fromMs = Date.parse(input.effectiveFrom);
  const toMs = Date.parse(input.effectiveTo);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    ctx.addIssue({
      code: "custom",
      path: ["effectiveTo"],
      message: "effectiveTo must be strictly greater than effectiveFrom",
    });
  }
}

/**
 * Business purpose: Enforce strict XOR replacement targeting and interval validity on assignment supersede commands.
 *
 * Business rules:
 * - Exactly one of `replacementDraftId` or `replacementSnapshotId` must be supplied (never both, never neither).
 * - Effective interval `[effectiveFrom, effectiveTo)` must satisfy `validateUtcEffectiveInterval`.
 *
 * Execution flow:
 * 1. Check strict XOR between `replacementDraftId` and `replacementSnapshotId`.
 * 2. Delegate interval validation to `validateUtcEffectiveInterval`.
 *
 * Failure cases:
 * - Adds a custom Zod issue if both or neither replacement targets are provided or if interval bounds are invalid.
 *
 * Side effects:
 * - None: pure Zod refinement helper.
 */
function validateSupersedeReplacementTarget(
  input: {
    effectiveFrom: string;
    effectiveTo?: string | null;
    replacementDraftId?: string;
    replacementSnapshotId?: string;
  },
  ctx: z.RefinementCtx,
): void {
  // Why: Superseding an active or scheduled assignment must point atomically to one replacement authority.
  // How: Requires `Boolean(replacementDraftId) !== Boolean(replacementSnapshotId)` and checks `[effectiveFrom, effectiveTo)`.
  // Invariants: Historical snapshots remain immutable regardless of whether a draft or existing snapshot replaces the assignment.
  const hasDraft = input.replacementDraftId !== undefined;
  const hasSnapshot = input.replacementSnapshotId !== undefined;
  if (hasDraft === hasSnapshot) {
    ctx.addIssue({
      code: "custom",
      message:
        "Exactly one of replacementDraftId or replacementSnapshotId must be provided",
    });
  }
  validateUtcEffectiveInterval(input, ctx);
}

/** Request DTO for creating a mutable `CustomerModelTariffDraft`. */
export const createModelTariffDraftSchema = z
  .strictObject({
    scope: z.enum(MODEL_PRICING_SCOPES),
    provider: nonEmptyText.max(64).nullable().optional(),
    resolvedModel: nonEmptyText.max(128).nullable().optional(),
    inputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
    outputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
    reasoningPolicy: z.enum(TOKEN_BUCKET_POLICIES),
    reasoningMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
      .nullable()
      .optional(),
    cachedInputPolicy: z
      .enum(TOKEN_BUCKET_POLICIES)
      .default(TOKEN_BUCKET_POLICIES.unsupported),
    cachedInputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
      .nullable()
      .optional(),
    cacheWritePolicy: z
      .enum(TOKEN_BUCKET_POLICIES)
      .default(TOKEN_BUCKET_POLICIES.unsupported),
    cacheWriteMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
      .nullable()
      .optional(),
    cacheWrite5mMicrocreditsPerMillion:
      nonNegativeMicrocreditIntegerStringSchema.nullable().optional(),
    cacheWrite1hMicrocreditsPerMillion:
      nonNegativeMicrocreditIntegerStringSchema.nullable().optional(),
    operationalAssumptions: operationalAssumptionsSchema.nullable().optional(),
  })
  .superRefine(validateDraftRatesAndScope);

export type CreateModelTariffDraftInput = z.infer<
  typeof createModelTariffDraftSchema
>;

/** Request DTO for updating a mutable `CustomerModelTariffDraft` with optimistic version check. */
export const updateModelTariffDraftSchema = z
  .strictObject({
    expectedVersion: z.number().int().safe().min(1),
    scope: z.enum(MODEL_PRICING_SCOPES).optional(),
    provider: nonEmptyText.max(64).nullable().optional(),
    resolvedModel: nonEmptyText.max(128).nullable().optional(),
    inputMicrocreditsPerMillion:
      nonNegativeMicrocreditIntegerStringSchema.optional(),
    outputMicrocreditsPerMillion:
      nonNegativeMicrocreditIntegerStringSchema.optional(),
    reasoningPolicy: z.enum(TOKEN_BUCKET_POLICIES).optional(),
    reasoningMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
      .nullable()
      .optional(),
    cachedInputPolicy: z.enum(TOKEN_BUCKET_POLICIES).optional(),
    cachedInputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
      .nullable()
      .optional(),
    cacheWritePolicy: z.enum(TOKEN_BUCKET_POLICIES).optional(),
    cacheWriteMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema
      .nullable()
      .optional(),
    cacheWrite5mMicrocreditsPerMillion:
      nonNegativeMicrocreditIntegerStringSchema.nullable().optional(),
    cacheWrite1hMicrocreditsPerMillion:
      nonNegativeMicrocreditIntegerStringSchema.nullable().optional(),
    operationalAssumptions: operationalAssumptionsSchema.nullable().optional(),
  })
  .superRefine(validateUpdateDraftPatch);

export type UpdateModelTariffDraftInput = z.infer<
  typeof updateModelTariffDraftSchema
>;

/** Request DTO for Admin pricing preview using exact integer microcredit math. */
export const previewModelPricingSchema = z
  .strictObject({
    provider: nonEmptyText.max(64),
    resolvedModel: nonEmptyText.max(128),
    effectiveAt: isoUtcDateTimeSchema.optional(),
    usage: z.strictObject({
      inputTokens: nonNegativeMicrocreditIntegerStringSchema,
      outputTokens: nonNegativeMicrocreditIntegerStringSchema,
      cachedInputTokens: nonNegativeMicrocreditIntegerStringSchema.optional(),
      cacheWriteTokens: nonNegativeMicrocreditIntegerStringSchema.optional(),
      cacheWrite5mTokens: nonNegativeMicrocreditIntegerStringSchema.optional(),
      cacheWrite1hTokens: nonNegativeMicrocreditIntegerStringSchema.optional(),
      reasoningTokens: nonNegativeMicrocreditIntegerStringSchema.optional(),
    }),
    draftId: nonEmptyText.optional(),
    snapshotId: nonEmptyText.optional(),
    rates: inlineTariffRatesSchema.optional(),
  })
  .superRefine(validatePreviewSourceSelection);

export type PreviewModelPricingInput = z.infer<
  typeof previewModelPricingSchema
>;

/** Response DTO for Admin pricing preview calculations. */
export const previewModelPricingResponseSchema = z.strictObject({
  provider: nonEmptyText,
  resolvedModel: nonEmptyText,
  allowlisted: z.boolean(),
  resolvedScope: z.enum(MODEL_PRICING_SCOPES),
  normalizedScopeKey: nonEmptyText,
  source: z.enum(MODEL_PRICING_PREVIEW_SOURCES),
  draftId: nonEmptyText.nullable(),
  snapshotId: nonEmptyText.nullable(),
  assignmentId: nonEmptyText.nullable(),
  chargeMicrocredits: nonNegativeMicrocreditIntegerStringSchema,
  chargeCreditsDecimal: microcreditDecimalSchema,
  effectiveRates: modelTariffRateScheduleViewSchema,
  warnings: z.array(z.string()),
  // Invariant: `debitMode` strictly forbids `"ON"` while MODEL_USAGE_DEBIT=OFF is enforced.
  debitMode: z.enum([
    MODEL_USAGE_DEBIT_MODES.OFF,
    MODEL_USAGE_DEBIT_MODES.SHADOW,
  ]),
});

export type PreviewModelPricingResponse = z.infer<
  typeof previewModelPricingResponseSchema
>;

/** Request DTO for atomically publishing a draft into an immutable snapshot + assignment + audit event. */
export const publishModelTariffDraftSchema = z
  .strictObject({
    idempotencyKey: nonEmptyText.max(200),
    requestFingerprint: nonEmptyText.max(128),
    auditReason: nonEmptyText.max(500),
    expectedDraftVersion: z.number().int().safe().min(1),
    effectiveFrom: isoUtcDateTimeSchema,
    effectiveTo: isoUtcDateTimeSchema.nullable().optional(),
  })
  .superRefine(validateUtcEffectiveInterval);

export type PublishModelTariffDraftInput = z.infer<
  typeof publishModelTariffDraftSchema
>;

/** Request DTO for atomically superseding an assignment without mutating historical snapshots. */
export const supersedeModelTariffAssignmentSchema = z
  .strictObject({
    idempotencyKey: nonEmptyText.max(200),
    requestFingerprint: nonEmptyText.max(128),
    auditReason: nonEmptyText.max(500),
    expectedAssignmentVersion: z.number().int().safe().min(1).optional(),
    effectiveFrom: isoUtcDateTimeSchema,
    effectiveTo: isoUtcDateTimeSchema.nullable().optional(),
    replacementDraftId: nonEmptyText.optional(),
    expectedDraftVersion: z.number().int().safe().min(1).optional(),
    replacementSnapshotId: nonEmptyText.optional(),
  })
  .superRefine(validateSupersedeReplacementTarget);

export type SupersedeModelTariffAssignmentInput = z.infer<
  typeof supersedeModelTariffAssignmentSchema
>;

/** View projection for a runtime-allowlisted model route entry. */
export const modelPricingAllowlistedModelViewSchema = z.strictObject({
  role: nonEmptyText,
  routeKey: nonEmptyText,
  provider: nonEmptyText,
  resolvedModel: nonEmptyText,
});

export type ModelPricingAllowlistedModelView = z.infer<
  typeof modelPricingAllowlistedModelViewSchema
>;

/** View projection for a mutable `CustomerModelTariffDraft`. */
export const modelTariffDraftViewSchema = z.strictObject({
  id: nonEmptyText,
  scope: z.enum(MODEL_PRICING_SCOPES),
  provider: nonEmptyText.nullable(),
  resolvedModel: nonEmptyText.nullable(),
  normalizedScopeKey: nonEmptyText,
  status: z.enum(CUSTOMER_TARIFF_DRAFT_STATUSES),
  version: z.number().int().safe().min(1),
  inputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
  outputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
  reasoningPolicy: z.enum(TOKEN_BUCKET_POLICIES),
  reasoningMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cachedInputPolicy: z.enum(TOKEN_BUCKET_POLICIES),
  cachedInputMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cacheWritePolicy: z.enum(TOKEN_BUCKET_POLICIES),
  cacheWriteMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cacheWrite5mMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cacheWrite1hMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  operationalAssumptions: operationalAssumptionsSchema.nullable(),
  publishedSnapshotId: nonEmptyText.nullable(),
  createdBy: nonEmptyText,
  updatedBy: nonEmptyText,
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema,
});

export type ModelTariffDraftView = z.infer<typeof modelTariffDraftViewSchema>;

/** View projection for an immutable `CustomerModelTariffSnapshot`. */
export const modelTariffSnapshotViewSchema = z.strictObject({
  id: nonEmptyText,
  sourceDraftId: nonEmptyText.nullable(),
  scope: z.enum(MODEL_PRICING_SCOPES),
  provider: nonEmptyText.nullable(),
  resolvedModel: nonEmptyText.nullable(),
  normalizedScopeKey: nonEmptyText,
  version: z.number().int().safe().min(1),
  accountingUnitVersion: z.number().int().safe().min(1),
  inputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
  outputMicrocreditsPerMillion: nonNegativeMicrocreditIntegerStringSchema,
  reasoningPolicy: z.enum(TOKEN_BUCKET_POLICIES),
  reasoningMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cachedInputPolicy: z.enum(TOKEN_BUCKET_POLICIES),
  cachedInputMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cacheWritePolicy: z.enum(TOKEN_BUCKET_POLICIES),
  cacheWriteMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cacheWrite5mMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  cacheWrite1hMicrocreditsPerMillion:
    nonNegativeMicrocreditIntegerStringSchema.nullable(),
  idempotencyKey: nonEmptyText,
  requestFingerprint: nonEmptyText,
  publishedBy: nonEmptyText,
  auditReason: nonEmptyText,
  publishedAt: isoUtcDateTimeSchema,
  createdAt: isoUtcDateTimeSchema,
});

export type ModelTariffSnapshotView = z.infer<
  typeof modelTariffSnapshotViewSchema
>;

/** View projection for a versioned half-open UTC `CustomerModelTariffAssignment`. */
export const modelTariffAssignmentViewSchema = z.strictObject({
  id: nonEmptyText,
  tariffSnapshotId: nonEmptyText,
  scope: z.enum(MODEL_PRICING_SCOPES),
  normalizedScopeKey: nonEmptyText,
  status: z.enum(PRICING_ASSIGNMENT_STATUSES),
  version: z.number().int().safe().min(1),
  effectiveFrom: isoUtcDateTimeSchema,
  effectiveTo: isoUtcDateTimeSchema.nullable(),
  supersededByAssignmentId: nonEmptyText.nullable(),
  supersededBy: nonEmptyText.nullable(),
  supersededAt: isoUtcDateTimeSchema.nullable(),
  cancelledAt: isoUtcDateTimeSchema.nullable(),
  auditReason: nonEmptyText.nullable(),
  createdBy: nonEmptyText,
  createdAt: isoUtcDateTimeSchema,
});

export type ModelTariffAssignmentView = z.infer<
  typeof modelTariffAssignmentViewSchema
>;

/** Effective pricing coverage row for an allowlisted `(provider, resolvedModel)` pair. */
export const modelPricingCoverageRowSchema = z.strictObject({
  provider: nonEmptyText,
  resolvedModel: nonEmptyText,
  normalizedScopeKey: nonEmptyText,
  hasCoverage: z.boolean(),
  resolvedScope: z.enum(MODEL_PRICING_SCOPES).nullable(),
  fallbackSource: z.enum(MODEL_PRICING_SCOPES).nullable(),
  assignmentId: nonEmptyText.nullable(),
  snapshotId: nonEmptyText.nullable(),
  snapshotVersion: z.number().int().safe().min(1).nullable(),
  effectiveFrom: isoUtcDateTimeSchema.nullable(),
  effectiveTo: isoUtcDateTimeSchema.nullable(),
  rates: modelTariffRateScheduleViewSchema.nullable(),
});

export type ModelPricingCoverageRow = z.infer<
  typeof modelPricingCoverageRowSchema
>;

/** Response DTO returned by draft publication. */
export const publishModelTariffDraftResponseSchema = z.strictObject({
  draft: modelTariffDraftViewSchema,
  snapshot: modelTariffSnapshotViewSchema,
  assignment: modelTariffAssignmentViewSchema,
  auditEventId: nonEmptyText,
  idempotentReplay: z.boolean(),
});

export type PublishModelTariffDraftResponse = z.infer<
  typeof publishModelTariffDraftResponseSchema
>;

/** Response DTO returned by assignment supersede. */
export const supersedeModelTariffAssignmentResponseSchema = z.strictObject({
  supersededAssignment: modelTariffAssignmentViewSchema,
  replacementAssignment: modelTariffAssignmentViewSchema,
  replacementSnapshot: modelTariffSnapshotViewSchema,
  auditEventId: nonEmptyText,
  idempotentReplay: z.boolean(),
});

export type SupersedeModelTariffAssignmentResponse = z.infer<
  typeof supersedeModelTariffAssignmentResponseSchema
>;

/** Query DTO for `GET /admin/billing/model-pricing`. */
export const adminModelPricingOverviewQuerySchema = z.strictObject({
  provider: nonEmptyText.max(64).optional(),
  resolvedModel: nonEmptyText.max(128).optional(),
  scope: z.enum(MODEL_PRICING_SCOPES).optional(),
  status: z.enum(PRICING_ASSIGNMENT_STATUSES).optional(),
  activeAt: isoUtcDateTimeSchema.optional(),
});

export type AdminModelPricingOverviewQuery = z.infer<
  typeof adminModelPricingOverviewQuerySchema
>;

/** Read-only Admin Model Pricing overview payload shared by NestJS API and Next.js BFF. */
export const adminModelPricingOverviewResponseSchema = z.strictObject({
  // Invariant: `debitMode` rejects `ON` across API and BFF while MODEL_USAGE_DEBIT=OFF holds.
  debitMode: z.enum([
    MODEL_USAGE_DEBIT_MODES.OFF,
    MODEL_USAGE_DEBIT_MODES.SHADOW,
  ]),
  dbUtcNow: isoUtcDateTimeSchema,
  allowlistedModels: z.array(modelPricingAllowlistedModelViewSchema),
  coverage: z.array(modelPricingCoverageRowSchema),
  assignments: z.array(modelTariffAssignmentViewSchema),
  drafts: z.array(modelTariffDraftViewSchema),
  snapshots: z.array(modelTariffSnapshotViewSchema),
});

export type AdminModelPricingOverviewResponse = z.infer<
  typeof adminModelPricingOverviewResponseSchema
>;
