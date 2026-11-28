"use client";

import {
  agentStreamEventSchema,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { usePreparationActivityHistory } from "@/lib/api/compliance-rule-set-queries";
import { mergePreparationEvents } from "../utils/rule-set-preparation-activity";
import { useEffect, useState } from "react";

/**
 * Business purpose: Keep Admin activity tied to one selected Preparation and close its
 *   terminal telemetry subscription.
 *
 * Business rules:
 * - Cache events per run, accept only validated activity events for that run and never treat
 *   telemetry as legal acceptance.
 *
 * Execution flow:
 * 1. Subscribe to the dedicated ADMIN stream, merge matching events, and close on
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
  const history = usePreparationActivityHistory(preparationRunId);
  const refetchHistory = history.refetch;
  useEffect(() => {
    if (preparationRunId && terminal) void refetchHistory();
  }, [preparationRunId, terminal, refetchHistory]);
  const current = preparationRunId ? streams[preparationRunId] : undefined;

  useEffect(() => {
    if (!preparationRunId || typeof EventSource === "undefined") return;

    const source = new EventSource(
      `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/activity/stream`,
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
      source.removeEventListener("preparation.activity", onActivity);
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
     * Business purpose: Adopt one validated activity event for the selected Preparation only.
     *
     * Business rules:
     * - Ignore non-string, malformed or foreign-run telemetry and retain only this run's events; the
     *   captured terminal prop closes the subscription after a validated frame.
     *
     * Execution flow:
     * 1. Parse/validate the event, bind it to this run, merge it into the cache and close if
     *   the captured terminal prop is true.
     *
     * Failure cases:
     * - Parsing/schema failures are ignored so the last accepted activity remains visible.
     *
     * Side effects:
     * - Updates the selected run’s React state and may dispose its terminal subscription.
     */
    const onActivity = (message: Event) => {
      const data = (message as MessageEvent).data;
      if (typeof data !== "string") return;
      try {
        const parsed = agentStreamEventSchema.safeParse(JSON.parse(data));
        if (!parsed.success) return;
        if (parsed.data.preparationRunId !== preparationRunId) return;
        setStreams((previous) => ({
          ...previous,
          [preparationRunId]: {
            events: mergePreparationEvents(
              preparationRunId,
              previous[preparationRunId]?.events ?? [],
              [parsed.data],
            ).slice(-5000),
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
    source.addEventListener("preparation.activity", onActivity);
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
      source.removeEventListener("preparation.activity", onActivity);
      source.close();
    };
  }, [preparationRunId, terminal]);

  return {
    events: preparationRunId
      ? mergePreparationEvents(
          preparationRunId,
          ...(history.data?.pages.map((page) => page.events) ?? []),
          current?.events ?? [],
        )
      : [],
    history,
    connected: current?.connected ?? false,
  };
}
