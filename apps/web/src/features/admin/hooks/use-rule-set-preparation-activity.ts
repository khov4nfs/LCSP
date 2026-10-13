"use client";

import {
  workspaceAssessmentSnapshotSchema,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { useEffect, useState } from "react";

export function useRuleSetPreparationActivity(preparationRunId: string | null) {
  const [streams, setStreams] = useState<
    Record<string, { events: AssessmentAgentStreamEvent[]; connected: boolean }>
  >({});
  const current = preparationRunId ? streams[preparationRunId] : undefined;

  useEffect(() => {
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
        const events = parsed.data.agent_stream_events.filter(
          (event) => event.preparationRunId === preparationRunId,
        );
        setStreams((previous) => ({
          ...previous,
          [preparationRunId]: {
            events,
            connected: previous[preparationRunId]?.connected ?? true,
          },
        }));
      } catch {
        // A malformed telemetry frame must not affect the Admin page.
      }
    };
    source.addEventListener("workspace.runtime", onRuntime);
    source.onopen = () =>
      setStreams((previous) => ({
        ...previous,
        [preparationRunId]: {
          events: previous[preparationRunId]?.events ?? [],
          connected: true,
        },
      }));
    source.onerror = () =>
      setStreams((previous) => ({
        ...previous,
        [preparationRunId]: {
          events: previous[preparationRunId]?.events ?? [],
          connected: false,
        },
      }));
    return () => {
      source.removeEventListener("workspace.runtime", onRuntime);
      source.close();
    };
  }, [preparationRunId]);

  return {
    events: current?.events ?? [],
    connected: current?.connected ?? false,
  };
}
