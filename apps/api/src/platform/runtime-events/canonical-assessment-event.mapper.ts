import {
  assessmentEventSchema,
  type AssessmentEvent,
} from "@lcsp/contracts/assessment";

/** Columns of an `AssessmentEvent` row that make up the customer-visible canonical event. */
export const CANONICAL_EVENT_SELECT = {
  eventId: true,
  assessmentId: true,
  threadId: true,
  sequence: true,
  timestamp: true,
  eventType: true,
  actorType: true,
  executionId: true,
  parentExecutionId: true,
  taskId: true,
  toolCallId: true,
  tokenUsage: true,
  technicalDetailsRef: true,
  payload: true,
} as const;

export type CanonicalEventRow = {
  eventId: string;
  assessmentId: string;
  threadId: string;
  sequence: number;
  timestamp: Date;
  eventType: string;
  actorType: string;
  executionId: string | null;
  parentExecutionId: string | null;
  taskId: string | null;
  toolCallId: string | null;
  tokenUsage: unknown;
  technicalDetailsRef: string | null;
  payload: unknown;
};

/** Validates one persisted row against the canonical event contract; a corrupt row is never rendered. */
export function toAssessmentEvent(row: CanonicalEventRow): AssessmentEvent {
  const parsed = assessmentEventSchema.safeParse({
    eventId: row.eventId,
    assessmentId: row.assessmentId,
    threadId: row.threadId,
    sequence: row.sequence,
    timestamp: row.timestamp.toISOString(),
    eventType: row.eventType,
    actorType: row.actorType,
    ...(row.executionId ? { executionId: row.executionId } : {}),
    ...(row.parentExecutionId
      ? { parentExecutionId: row.parentExecutionId }
      : {}),
    ...(row.taskId ? { taskId: row.taskId } : {}),
    ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
    ...(row.tokenUsage ? { tokenUsage: row.tokenUsage } : {}),
    ...(row.technicalDetailsRef
      ? { technicalDetailsRef: row.technicalDetailsRef }
      : {}),
    payload: row.payload,
  });
  if (!parsed.success) {
    throw new Error("Invalid persisted assessment event");
  }
  return parsed.data;
}
