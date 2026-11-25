import { z } from "zod";

export const WORKLOAD_SCOPES = {
  ASSESSMENT_ROOT: "ASSESSMENT_ROOT",
  RULE_SET_PREPARATION: "RULE_SET_PREPARATION",
} as const;
export type WorkloadScope =
  (typeof WORKLOAD_SCOPES)[keyof typeof WORKLOAD_SCOPES];

// Why: R2 eliminates `NO_PROGRESS_LIMIT_EXCEEDED` as an assessment blocker; only call/token
// limits and operational budget exhaustion/unavailability block admission.
// How: Removed `NO_PROGRESS_LIMIT_EXCEEDED` from `ASSESSMENT_BUDGET_REASONS`.
// Invariants: `noProgressLimit` and `consecutiveTurnsWithoutProgress` remain diagnostic telemetry only.
export const ASSESSMENT_BUDGET_REASONS = {
  CALL_LIMIT_EXCEEDED: "CALL_LIMIT_EXCEEDED",
  TOKEN_LIMIT_EXCEEDED: "TOKEN_LIMIT_EXCEEDED",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  AGENT_BUDGET_REACHED: "AGENT_BUDGET_REACHED",
  BUDGET_UNAVAILABLE: "BUDGET_UNAVAILABLE",
} as const;
export type AssessmentBudgetReason =
  (typeof ASSESSMENT_BUDGET_REASONS)[keyof typeof ASSESSMENT_BUDGET_REASONS];

export const assessmentBudgetLimitsSchema = z.strictObject({
  maxModelCalls: z.number().int().positive().nullable(),
  maxInputTokens: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  maxTotalTokens: z.number().int().positive().nullable(),
  noProgressLimit: z.number().int().positive().nullable(),
});
export type AssessmentBudgetLimits = z.infer<
  typeof assessmentBudgetLimitsSchema
>;

// Why: Historical DB `Assessment.blockerReference` JSONB rows may still carry `overrideNoProgress: false`
// from before R2 removed the no-progress unlock. Using `z.object` on this persisted read schema
// strips legacy unknown keys safely instead of failing `safeParse` and dropping authorized limits.
// How: Removed `overrideNoProgress` from the schema and type while relaxing `z.strictObject` -> `z.object`
// for persisted read compatibility; wire input remains strictly rejected by `assessmentBudgetExtensionInputSchema`.
// Invariants: `applyBudgetExtension` never reads or acts on `overrideNoProgress`.
export const assessmentBudgetExtensionSchema = z.object({
  version: z.number().int().positive(),
  authorizedBy: z.string().min(1),
  authorizedAt: z.string().datetime(),
  auditReason: z.string().min(1).optional(),
  additionalModelCalls: z.number().int().positive().nullable().optional(),
  additionalInputTokens: z.number().int().positive().nullable().optional(),
  additionalOutputTokens: z.number().int().positive().nullable().optional(),
  additionalTotalTokens: z.number().int().positive().nullable().optional(),
});
export type AssessmentBudgetExtension = z.infer<
  typeof assessmentBudgetExtensionSchema
>;

export const LEGACY_BUDGET_EXTENSION_ALLOWANCE = {
  version: 1,
  authorizedBy: "system:legacy_budget_extended_migration",
  authorizedAt: "2026-01-01T00:00:00.000Z",
  auditReason:
    "Legacy budgetExtended flag migration to fixed effective ceiling",
  additionalModelCalls: 50,
  additionalInputTokens: 1_000_000,
  additionalOutputTokens: 50_000,
  additionalTotalTokens: 1_050_000,
} as const satisfies AssessmentBudgetExtension;

export const assessmentCumulativeUsageSchema = z.strictObject({
  modelCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  consecutiveTurnsWithoutProgress: z.number().int().nonnegative(),
  unmeasuredModelCalls: z.number().int().nonnegative().optional(),
});
export type AssessmentCumulativeUsage = z.infer<
  typeof assessmentCumulativeUsageSchema
>;

// Why: R2 eliminates `NO_PROGRESS` as a blocking admission status.
// How: Removed `NO_PROGRESS` from `ASSESSMENT_BUDGET_STATUSES` and `assessmentBudgetStatusSchema`.
// Invariants: Budget admission status is strictly `ADMITTED` or `EXHAUSTED`.
export const ASSESSMENT_BUDGET_STATUSES = {
  ADMITTED: "ADMITTED",
  EXHAUSTED: "EXHAUSTED",
} as const;
export type AssessmentBudgetStatus =
  (typeof ASSESSMENT_BUDGET_STATUSES)[keyof typeof ASSESSMENT_BUDGET_STATUSES];

export const assessmentBudgetStatusSchema = z.enum([
  ASSESSMENT_BUDGET_STATUSES.ADMITTED,
  ASSESSMENT_BUDGET_STATUSES.EXHAUSTED,
]);

export const assessmentBudgetStateSchema = z.strictObject({
  workloadScope: z.enum([
    WORKLOAD_SCOPES.ASSESSMENT_ROOT,
    WORKLOAD_SCOPES.RULE_SET_PREPARATION,
  ]),
  limits: assessmentBudgetLimitsSchema,
  cumulativeUsage: assessmentCumulativeUsageSchema,
  status: assessmentBudgetStatusSchema,
});
export type AssessmentBudgetState = z.infer<typeof assessmentBudgetStateSchema>;

export interface BudgetAdmissionEvaluation {
  admitted: boolean;
  reason: AssessmentBudgetReason | null;
  status: AssessmentBudgetStatus;
}

/**
 * Business purpose: Evaluate whether a workload invocation can be admitted under cumulative call and token limits.
 *
 * Business rules:
 * - Reject model calls exceeding maxModelCalls when configured.
 * - Reject token requests exceeding maxInputTokens, maxOutputTokens, or maxTotalTokens when configured.
 * - Consecutive turns without progress (noProgressLimit) are diagnostic telemetry only and never block admission.
 *
 * Execution flow:
 * 1. Check model call count against maxModelCalls.
 * 2. Check cumulative input, output, and total tokens against their configured limits.
 * 3. Return ADMITTED when call and token limits are satisfied.
 *
 * Failure cases:
 * - When any call or token limit is exceeded, returns admitted=false with status EXHAUSTED and the specific reason.
 *
 * Side effects:
 * - Pure calculation; does not mutate input objects or call external services.
 */
export function evaluateBudgetAdmission(
  limits: AssessmentBudgetLimits,
  usage: AssessmentCumulativeUsage,
): BudgetAdmissionEvaluation {
  if (
    limits.maxModelCalls !== null &&
    usage.modelCalls >= limits.maxModelCalls
  ) {
    return {
      admitted: false,
      reason: ASSESSMENT_BUDGET_REASONS.CALL_LIMIT_EXCEEDED,
      status: ASSESSMENT_BUDGET_STATUSES.EXHAUSTED,
    };
  }
  if (
    limits.maxInputTokens !== null &&
    usage.inputTokens >= limits.maxInputTokens
  ) {
    return {
      admitted: false,
      reason: ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED,
      status: ASSESSMENT_BUDGET_STATUSES.EXHAUSTED,
    };
  }
  if (
    limits.maxOutputTokens !== null &&
    usage.outputTokens >= limits.maxOutputTokens
  ) {
    return {
      admitted: false,
      reason: ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED,
      status: ASSESSMENT_BUDGET_STATUSES.EXHAUSTED,
    };
  }
  if (
    limits.maxTotalTokens !== null &&
    usage.totalTokens >= limits.maxTotalTokens
  ) {
    return {
      admitted: false,
      reason: ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED,
      status: ASSESSMENT_BUDGET_STATUSES.EXHAUSTED,
    };
  }
  return {
    admitted: true,
    reason: null,
    status: ASSESSMENT_BUDGET_STATUSES.ADMITTED,
  };
}

/**
 * Business purpose: Calculate effective budget limits by applying an authoritative versioned extension to base limits.
 *
 * Business rules:
 * - If no extension is present, returns base limits unmodified.
 * - Additional model calls and tokens are added to configured base limits; unconfigured (null) base limits remain null.
 * - Diagnostic noProgressLimit is preserved unchanged because no-progress unlocks are eliminated.
 *
 * Execution flow:
 * 1. Check if extension exists; if not, return base limits.
 * 2. Calculate effective call and token limits by summing base and additional amounts where configured.
 * 3. Preserve base noProgressLimit and return the new AssessmentBudgetLimits object.
 *
 * Failure cases:
 * - Pure calculation; does not throw.
 *
 * Side effects:
 * - Pure function without external mutations.
 */
export function applyBudgetExtension(
  baseLimits: AssessmentBudgetLimits,
  extension: AssessmentBudgetExtension | null | undefined,
): AssessmentBudgetLimits {
  if (!extension) {
    return baseLimits;
  }
  return {
    maxModelCalls:
      baseLimits.maxModelCalls !== null
        ? baseLimits.maxModelCalls + (extension.additionalModelCalls ?? 0)
        : null,
    maxInputTokens:
      baseLimits.maxInputTokens !== null
        ? baseLimits.maxInputTokens + (extension.additionalInputTokens ?? 0)
        : null,
    maxOutputTokens:
      baseLimits.maxOutputTokens !== null
        ? baseLimits.maxOutputTokens + (extension.additionalOutputTokens ?? 0)
        : null,
    maxTotalTokens:
      baseLimits.maxTotalTokens !== null
        ? baseLimits.maxTotalTokens + (extension.additionalTotalTokens ?? 0)
        : null,
    noProgressLimit: baseLimits.noProgressLimit,
  };
}

/**
 * Business purpose: Parse and validate an optional positive integer budget limit from environment configuration.
 *
 * Business rules:
 * - When the variable is undefined, null, or empty whitespace, return null (unconstrained cumulative limit).
 * - When the variable is a valid string representation of a positive integer (e.g. "50"), return the parsed integer.
 * - When the variable is non-empty but cannot be parsed as a strictly positive integer (e.g. "0", "-5", "abc", "1.5"), throw an error to fail closed.
 *
 * Execution flow:
 * 1. Check if raw value is undefined or blank string. If so, return null.
 * 2. Trim raw string and attempt strict integer parsing.
 * 3. Validate that the parsed value is a safe positive integer and exact string roundtrip matches.
 * 4. Return the parsed positive integer or throw Error on validation failure.
 *
 * Failure cases:
 * - Throws Error if configured environment value is not a valid positive integer.
 *
 * Side effects:
 * - Pure validation function without external state mutation.
 */
export function parseConfiguredPositiveInt(
  envName: string,
  raw: string | undefined | null,
): number | null {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return null;
  }
  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
    throw new Error(
      `Invalid configuration for ${envName}: expected a positive integer, got "${raw}"`,
    );
  }
  return parsed;
}

/**
 * Business purpose: Resolve authoritative budget limits for an assessment or preparation workload scope from environment variables.
 *
 * Business rules:
 * - Default behavior is unconstrained (null) for all cumulative token and call dimensions when not explicitly configured.
 * - Rule Set Preparation has no cumulative output-token ceiling; maxOutputTokens is permanently null for RULE_SET_PREPARATION.
 * - Assessment Root preserves support for its explicitly configured LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS ceiling.
 * - Malformed configurations throw errors immediately to prevent silent permissive or restrictive execution.
 * - Optional noProgressLimit is parsed purely as diagnostic telemetry metadata and never cleared via override flags.
 *
 * Execution flow:
 * 1. Identify prefix based on workload scope (LCSP_RSP for RULE_SET_PREPARATION, LCSP_ASSESSMENT for ASSESSMENT_ROOT).
 * 2. Parse optional positive integer limits for model calls, input tokens, output tokens, total tokens, and diagnostic no-progress threshold.
 * 3. Return an AssessmentBudgetLimits object.
 *
 * Failure cases:
 * - Throws Error if any present configuration variable fails positive integer validation.
 *
 * Side effects:
 * - Pure configuration resolver; does not mutate environment or persist state.
 */
export function resolveConfiguredBudgetLimits(
  env: Record<string, string | undefined>,
  scope: WorkloadScope = WORKLOAD_SCOPES.ASSESSMENT_ROOT,
): AssessmentBudgetLimits {
  const prefix =
    scope === WORKLOAD_SCOPES.RULE_SET_PREPARATION
      ? "LCSP_RSP"
      : "LCSP_ASSESSMENT";
  const noProgress = parseConfiguredPositiveInt(
    `${prefix}_NO_PROGRESS_LIMIT`,
    env[`${prefix}_NO_PROGRESS_LIMIT`],
  );

  return {
    maxModelCalls: parseConfiguredPositiveInt(
      `${prefix}_MAX_MODEL_CALLS`,
      env[`${prefix}_MAX_MODEL_CALLS`],
    ),
    maxInputTokens: parseConfiguredPositiveInt(
      `${prefix}_MAX_INPUT_TOKENS`,
      env[`${prefix}_MAX_INPUT_TOKENS`],
    ),
    maxOutputTokens:
      scope === WORKLOAD_SCOPES.RULE_SET_PREPARATION
        ? null
        : parseConfiguredPositiveInt(
            "LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS",
            env.LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS,
          ),
    maxTotalTokens: parseConfiguredPositiveInt(
      `${prefix}_MAX_TOTAL_TOKENS`,
      env[`${prefix}_MAX_TOTAL_TOKENS`],
    ),
    noProgressLimit: noProgress,
  };
}
