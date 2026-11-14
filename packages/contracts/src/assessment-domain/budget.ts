import { z } from "zod";

export const WORKLOAD_SCOPES = {
  ASSESSMENT_ROOT: "ASSESSMENT_ROOT",
  RULE_SET_PREPARATION: "RULE_SET_PREPARATION",
} as const;
export type WorkloadScope =
  (typeof WORKLOAD_SCOPES)[keyof typeof WORKLOAD_SCOPES];

export const ASSESSMENT_BUDGET_REASONS = {
  CALL_LIMIT_EXCEEDED: "CALL_LIMIT_EXCEEDED",
  TOKEN_LIMIT_EXCEEDED: "TOKEN_LIMIT_EXCEEDED",
  NO_PROGRESS_LIMIT_EXCEEDED: "NO_PROGRESS_LIMIT_EXCEEDED",
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

export const assessmentCumulativeUsageSchema = z.strictObject({
  modelCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  consecutiveTurnsWithoutProgress: z.number().int().nonnegative(),
});
export type AssessmentCumulativeUsage = z.infer<
  typeof assessmentCumulativeUsageSchema
>;

export const ASSESSMENT_BUDGET_STATUSES = {
  ADMITTED: "ADMITTED",
  EXHAUSTED: "EXHAUSTED",
  NO_PROGRESS: "NO_PROGRESS",
} as const;
export type AssessmentBudgetStatus =
  (typeof ASSESSMENT_BUDGET_STATUSES)[keyof typeof ASSESSMENT_BUDGET_STATUSES];

export const assessmentBudgetStatusSchema = z.enum([
  ASSESSMENT_BUDGET_STATUSES.ADMITTED,
  ASSESSMENT_BUDGET_STATUSES.EXHAUSTED,
  ASSESSMENT_BUDGET_STATUSES.NO_PROGRESS,
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
export type AssessmentBudgetState = z.infer<
  typeof assessmentBudgetStateSchema
>;

export interface BudgetAdmissionEvaluation {
  admitted: boolean;
  reason: AssessmentBudgetReason | null;
  status: AssessmentBudgetStatus;
}

/**
 * Business purpose: Evaluate whether a workload invocation can be admitted under cumulative limits.
 *
 * Business rules:
 * - Reject model calls exceeding maxModelCalls when configured.
 * - Reject token requests exceeding maxInputTokens, maxOutputTokens, or maxTotalTokens when configured.
 * - Reject consecutive turns without authoritative progress exceeding noProgressLimit when configured.
 *
 * Execution flow:
 * 1. Check model call count against limit.
 * 2. Check cumulative tokens against input, output, and total limits.
 * 3. Check consecutive turns without progress against limit.
 * 4. Return admission status and reason.
 *
 * Failure cases:
 * - When any limit is exceeded, returns admitted=false with the specific reason.
 *
 * Side effects:
 * - Pure calculation; does not mutate input objects or call external services.
 */
export function evaluateBudgetAdmission(
  limits: AssessmentBudgetLimits,
  usage: AssessmentCumulativeUsage,
): BudgetAdmissionEvaluation {
  if (limits.maxModelCalls !== null && usage.modelCalls >= limits.maxModelCalls) {
    return {
      admitted: false,
      reason: ASSESSMENT_BUDGET_REASONS.CALL_LIMIT_EXCEEDED,
      status: "EXHAUSTED",
    };
  }
  if (limits.maxInputTokens !== null && usage.inputTokens >= limits.maxInputTokens) {
    return {
      admitted: false,
      reason: ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED,
      status: "EXHAUSTED",
    };
  }
  if (limits.maxOutputTokens !== null && usage.outputTokens >= limits.maxOutputTokens) {
    return {
      admitted: false,
      reason: ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED,
      status: "EXHAUSTED",
    };
  }
  if (limits.maxTotalTokens !== null && usage.totalTokens >= limits.maxTotalTokens) {
    return {
      admitted: false,
      reason: ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED,
      status: "EXHAUSTED",
    };
  }
  if (
    limits.noProgressLimit !== null &&
    usage.consecutiveTurnsWithoutProgress >= limits.noProgressLimit
  ) {
    return {
      admitted: false,
      reason: ASSESSMENT_BUDGET_REASONS.NO_PROGRESS_LIMIT_EXCEEDED,
      status: "NO_PROGRESS",
    };
  }
  return {
    admitted: true,
    reason: null,
    status: "ADMITTED",
  };
}
