"use client";

import {
  workspaceAssessmentSnapshotSchema,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { useEffect, useState } from "react";

export function useRuleSetPreparationActivity(preparationRunId: string | null) {
  const [events, setEvents] = useState<AssessmentAgentStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setEvents([]);
    setConnected(false);
    if (!preparationRunId || typeof EventSource === "undefined") return;

    const source = new EventSource(
      `/api/workspace/runtime-events?preparation_run_id=${encodeURIComponent(preparationRunId)}`,
    );
    const onRuntime = (message: Event) => {
      const data = (message as MessageEvent).data;
      if (typeof data !== "string") return;
      try {
        const parsed = workspaceAssessmentSnapshotSchema.safeParse(
          JSON.parse(data),
        );
        if (!parsed.success) return;
        setEvents(
          parsed.data.agent_stream_events.filter(
            (event) => event.preparationRunId === preparationRunId,
          ),
        );
      } catch {
        // A malformed telemetry frame must not affect the Admin page.
      }
    };
    source.addEventListener("workspace.runtime", onRuntime);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    return () => {
      source.removeEventListener("workspace.runtime", onRuntime);
      source.close();
    };
  }, [preparationRunId]);

  return { events, connected };
}
