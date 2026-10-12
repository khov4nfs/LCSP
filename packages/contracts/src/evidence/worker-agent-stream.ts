import { z } from "zod";
import { ASSESSMENT_AGENT_STREAM_EVENT_TYPES } from "./assessment-runtime.ts";

/** Worker telemetry is sanitized by the journal; it cannot write lifecycle or decisions. */
export const workerAgentStreamEventRequestSchema = z.strictObject({
  assessment_id: z.string().trim().min(1),
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
});

export type WorkerAgentStreamEventRequest = z.infer<
  typeof workerAgentStreamEventRequestSchema
>;
