import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";

export function agentStreamRuntimeRunId(
  event: AssessmentAgentStreamEvent,
): string | undefined {
  const data = event.data as Record<string, unknown> | null;
  const control = data?.runtimeControl as Record<string, unknown> | undefined;
  const nativeRunId = data?.runtimeRunId ?? control?.targetRunId;
  return typeof nativeRunId === "string" ? nativeRunId : undefined;
}

/** A native generation spans worker and customer-control correlation IDs. */
export function agentStreamTurnKey(event: AssessmentAgentStreamEvent): string {
  const nativeRunId = agentStreamRuntimeRunId(event);
  return JSON.stringify(
    nativeRunId === undefined
      ? [event.runId, event.correlationId]
      : [nativeRunId],
  );
}
