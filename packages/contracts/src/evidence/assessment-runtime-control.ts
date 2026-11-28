import { z } from "zod";
/** Requests and runtime acknowledgements are distinct, durable states. */
export const ASSESSMENT_RUNTIME_CONTROL_STATES = {
  running: "RUNNING",
  stopRequested: "STOP_REQUESTED",
  stopped: "STOPPED",
  resumeRequested: "RESUME_REQUESTED",
  completed: "COMPLETED",
} as const;
export type AssessmentRuntimeControlState =
  (typeof ASSESSMENT_RUNTIME_CONTROL_STATES)[keyof typeof ASSESSMENT_RUNTIME_CONTROL_STATES];

export const ASSESSMENT_RUNTIME_CONTROL_ACTIONS = {
  stop: "STOP",
  resume: "RESUME",
} as const;
export type AssessmentRuntimeControlAction =
  (typeof ASSESSMENT_RUNTIME_CONTROL_ACTIONS)[keyof typeof ASSESSMENT_RUNTIME_CONTROL_ACTIONS];

export const ASSESSMENT_RUNTIME_CONTROL_PROBLEM_CODES = {
  notStopped: "RUNTIME_NOT_STOPPED",
  staleTarget: "RUNTIME_CONTROL_TARGET_STALE",
} as const;

export const assessmentRuntimeControlResultSchema = z.strictObject({
  state: z.enum(ASSESSMENT_RUNTIME_CONTROL_STATES),
  targetRunId: z.uuid(),
  requestId: z.uuid().nullable(),
});
export type AssessmentRuntimeControlResult = z.infer<
  typeof assessmentRuntimeControlResultSchema
>;
/**
 * Why: Admin budget extensions must record a constrained authority source (`ADMIN_OVERRIDE` or
 * `SYSTEM_COMPENSATION`) and never allow customer `PAYMENT` sources on this admin-only surface.
 * How: Defined as an `as const` object with `SCREAMING_SNAKE_CASE` values and derived union type.
 * Invariants: `"PAYMENT"` must never be added here; enforced by `ASM-BUDGET-05`.
 */
export const ASSESSMENT_BUDGET_EXTENSION_SOURCES = {
  adminOverride: "ADMIN_OVERRIDE",
  systemCompensation: "SYSTEM_COMPENSATION",
} as const;
export type AssessmentBudgetExtensionSource =
  (typeof ASSESSMENT_BUDGET_EXTENSION_SOURCES)[keyof typeof ASSESSMENT_BUDGET_EXTENSION_SOURCES];

/**
 * Why: WP8 / ASM-BUDGET-05 requires every admin budget override to supply an explicit auditReason
 * and prohibits any `overrideNoProgress` unlock flag (R2: NO_PROGRESS_LIMIT_EXCEEDED is eliminated
 * as a blocker/unlock).
 * How: `auditReason` is required (`trim().min(1)`), `source` is an optional canonical extension source
 * (defaulted server-side to `ADMIN_OVERRIDE`), and `overrideNoProgress` is omitted from this
 * `z.strictObject` so any attempt to pass it fails schema validation.
 * Invariants: Must stay `z.strictObject` so unknown keys like `overrideNoProgress` are rejected.
 */
export const assessmentBudgetExtensionInputSchema = z.strictObject({
  version: z.number().int().positive(),
  auditReason: z.string().trim().min(1),
  source: z.enum(ASSESSMENT_BUDGET_EXTENSION_SOURCES).optional(),
  additionalModelCalls: z.number().int().positive().nullable().optional(),
  additionalInputTokens: z.number().int().positive().nullable().optional(),
  additionalOutputTokens: z.number().int().positive().nullable().optional(),
  additionalTotalTokens: z.number().int().positive().nullable().optional(),
});
export type AssessmentBudgetExtensionInput = z.infer<
  typeof assessmentBudgetExtensionInputSchema
>;

export const assessmentRuntimeControlRequestSchema = z.strictObject({
  targetRunId: z.uuid(),
  budgetExtension: assessmentBudgetExtensionInputSchema.optional(),
});

export const customerRuntimeControlRequestSchema = z.strictObject({
  targetRunId: z.uuid(),
});
export type CustomerRuntimeControlRequest = z.infer<
  typeof customerRuntimeControlRequestSchema
>;

/**
 * Why: Contract 29 (`ASM-BUDGET-05`) requires an idempotencyKey on admin budget extensions to
 * guarantee replay safety and atomic `AuditEvent` correlation across retries.
 * How: `idempotencyKey` is required at the top level alongside `targetRunId`, optional
 * `expectedVersion`, and `budgetExtension`, matching other idempotent command contracts in `@lcsp/contracts`.
 * Invariants: Strict object rejects extra fields; `expectedVersion` remains optional for backward
 * compatibility with `budgetExtension.version`-based callers.
 */
export const adminBudgetExtensionRequestSchema = z.strictObject({
  targetRunId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().nonnegative().optional(),
  budgetExtension: assessmentBudgetExtensionInputSchema,
});
export type AdminBudgetExtensionRequest = z.infer<
  typeof adminBudgetExtensionRequestSchema
>;

export function isAssessmentRuntimeControlState(
  value: unknown,
): value is AssessmentRuntimeControlState {
  return Object.values(ASSESSMENT_RUNTIME_CONTROL_STATES).includes(
    value as AssessmentRuntimeControlState,
  );
}
