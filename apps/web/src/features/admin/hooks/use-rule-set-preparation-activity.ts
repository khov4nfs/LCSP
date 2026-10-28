"use client";

import {
  workspaceAssessmentSnapshotSchema,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { useEffect, useState } from "react";

/**
 * Business purpose: Keep Admin activity tied to one selected Preparation and close its
 *   terminal telemetry subscription.
 *
 * Business rules:
 * - Cache events per run, accept only validated snapshots for that run and never treat
 *   telemetry as legal acceptance.
 *
 * Execution flow:
 * 1. Subscribe when a run and EventSource exist, project matching snapshots, and close on
 *   cleanup or when the terminal prop closes the stream after a matching frame or 1500ms.
 *
 * Failure cases:
 * - Unavailable EventSource or missing run yields no subscription; malformed frames are
 *   ignored and connection errors only change connection display state.
 *
 * Side effects:
 * - Opens/closes an SSE connection, maintains per-run React state and may schedule a 1500ms
 *   terminal-close timer.
 */
export function useRuleSetPreparationActivity(
  preparationRunId: string | null,
  terminal: boolean,
) {
  const [streams, setStreams] = useState<
    Record<string, { events: AssessmentAgentStreamEvent[]; connected: boolean }>
  >({});
  const current = preparationRunId ? streams[preparationRunId] : undefined;

  useEffect(() => {
    if (!preparationRunId || typeof EventSource === "undefined") return;

    const source = new EventSource(
      `/api/workspace/runtime-events?preparation_run_id=${encodeURIComponent(preparationRunId)}`,
    );
    let closed = false;
    let terminalCloseTimer: number | null = null;
    /**
     * Business purpose: Close a terminal Preparation activity subscription once without losing
     *   its retained events.
     *
     * Business rules:
     * - Repeated closure is a no-op; only an existing run entry is marked disconnected.
     *
     * Execution flow:
     * 1. Cancel the terminal timer, remove the runtime listener, close EventSource and mark the
     *   cached run disconnected.
     *
     * Failure cases:
     * - An absent cached run remains absent; no new event state is invented.
     *
     * Side effects:
     * - Disposes the SSE resources and updates connection state.
     */
    const close = () => {
      if (closed) return;
      closed = true;
      if (terminalCloseTimer !== null) window.clearTimeout(terminalCloseTimer);
      source.removeEventListener("workspace.runtime", onRuntime);
      source.close();
      setStreams((previous) => {
        const current = previous[preparationRunId];
        return current
          ? {
              ...previous,
              [preparationRunId]: { ...current, connected: false },
            }
          : previous;
      });
    };
    /**
     * Business purpose: Adopt a validated activity snapshot for the selected Preparation only.
     *
     * Business rules:
     * - Ignore non-string or malformed telemetry and retain only this run's events; the
     *   captured terminal prop closes the subscription after a validated frame.
     *
     * Execution flow:
     * 1. Parse/validate the snapshot, filter its events to this run, replace its cached event
     *   snapshot and close if the captured terminal prop is true.
     *
     * Failure cases:
     * - Parsing/schema failures are ignored so the last accepted activity remains visible.
     *
     * Side effects:
     * - Updates the selected run’s React state and may dispose its terminal subscription.
     */
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
            connected: terminal
              ? false
              : (previous[preparationRunId]?.connected ?? true),
          },
        }));
        if (terminal) close();
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
    if (terminal) terminalCloseTimer = window.setTimeout(close, 1500);
    return () => {
      if (terminalCloseTimer !== null) window.clearTimeout(terminalCloseTimer);
      source.removeEventListener("workspace.runtime", onRuntime);
      source.close();
    };
  }, [preparationRunId, terminal]);

  return {
    events: current?.events ?? [],
    connected: current?.connected ?? false,
  };
}
