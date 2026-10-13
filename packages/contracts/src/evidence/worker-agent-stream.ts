import { z } from "zod";
import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
} from "./assessment-runtime.ts";

/** Worker telemetry is sanitized by the journal; it cannot write lifecycle or decisions. */
export const workerAgentStreamEventRequestSchema = z
  .strictObject({
    assessment_id: z.string().trim().min(1).optional(),
    boundary_type: z.enum(AGENT_STREAM_BOUNDARY_TYPES).optional(),
    boundary_id: z.string().trim().min(1).optional(),
    preparation_run_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1),
    event_type: z.enum(ASSESSMENT_AGENT_STREAM_EVENT_TYPES),
    event_id: z.unknown().optional(),
    // The journal assigns its own timestamp; the worker sends this metadata.
    emitted_at: z.unknown().optional(),
    client_sequence: z.unknown().optional(),
    correlation_id: z.unknown().optional(),
    source: z.unknown().optional(),
    agent_name: z.unknown().optional(),
    subagent_name: z.unknown().optional(),
    namespace: z.unknown().optional(),
    node_name: z.unknown().optional(),
    message_id: z.unknown().optional(),
    tool_name: z.unknown().optional(),
    tool_call_id: z.unknown().optional(),
    status: z.unknown().optional(),
    text: z.unknown().optional(),
    data: z.unknown().optional(),
  })
  .superRefine((payload, context) => {
    const preparation =
      payload.boundary_type ===
        AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation ||
      payload.preparation_run_id !== undefined;
    const identity = preparation
      ? payload.preparation_run_id
      : payload.assessment_id;
    if (!identity) {
      context.addIssue({
        code: "custom",
        path: [preparation ? "preparation_run_id" : "assessment_id"],
        message: "A stream boundary identity is required",
      });
    }
  });

export type WorkerAgentStreamEventRequest = z.infer<
  typeof workerAgentStreamEventRequestSchema
>;
