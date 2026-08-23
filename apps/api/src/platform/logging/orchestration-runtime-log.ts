import type { AppConfig } from "../../config/config.types.js";

export const ORCHESTRATION_RUNTIME_LOG_EVENTS = {
  dispatchReceived: "ORCH_RUNTIME_DISPATCH_RECEIVED",
  workerRequest: "ORCH_RUNTIME_WORKER_REQUEST",
  workerResponse: "ORCH_RUNTIME_WORKER_RESPONSE",
  workerUnreachable: "ORCH_RUNTIME_WORKER_UNREACHABLE",
  workerBadResponse: "ORCH_RUNTIME_WORKER_BAD_RESPONSE",
  targetedReanalysisCreate: "ORCH_RUNTIME_TARGETED_REANALYSIS_CREATE",
} as const;

type OrchestrationCoreFields = {
  correlationId?: string | null;
  toolName?: string | null;
  assessmentId?: string | null;
  organizationId?: string | null;
};

/**
 * Checks whether verbose orchestration runtime logging is enabled.
 *
 * @param config - Application configuration containing orchestration settings.
 * @returns True when orchestration debug logging is enabled.
 */
export function isOrchestrationDebugEnabled(
  config: Pick<AppConfig, "orchestration">,
): boolean {
  return config.orchestration.debug;
}

/**
 * Serializes an orchestration runtime event and its contextual fields as JSON.
 *
 * @param event - Stable orchestration event identifier.
 * @param fields - Correlation fields and additional event-specific metadata.
 * @returns JSON string representing the runtime log event.
 */
export function formatOrchestrationRuntimeLog(
  event: string,
  fields: OrchestrationCoreFields & Record<string, unknown>,
): string {
  return JSON.stringify({
    event,
    ...fields,
  });
}

/**
 * Returns orchestration values unchanged before logging.
 *
 * @param value - Arbitrary value that may contain sensitive nested fields.
 * @returns The original value.
 */
export function sanitizeOrchestrationLogValue(value: unknown): unknown {
  return value;
}
