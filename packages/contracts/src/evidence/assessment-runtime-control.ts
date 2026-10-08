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
export const assessmentRuntimeControlRequestSchema = z.strictObject({
  targetRunId: z.uuid(),
});

export function isAssessmentRuntimeControlState(
  value: unknown,
): value is AssessmentRuntimeControlState {
  return Object.values(ASSESSMENT_RUNTIME_CONTROL_STATES).includes(
    value as AssessmentRuntimeControlState,
  );
}

/** Private worker registration/acknowledgement. Never included in customer DTOs. */
export type AssessmentRuntimeControlAcknowledgement = {
  assessmentId: string;
  targetRunId: string;
  state: AssessmentRuntimeControlState;
  threadId?: string;
  boundary?: string;
  logicalRunId?: string;
  workflowRunId?: string;
  correlationId: string;
  context?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
};
