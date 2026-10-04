"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { apiQueryKeys } from "../../../../lib/api/query-keys.ts";
import { apiRequest } from "../../../../lib/api/api-request.ts";
import {
  parseAgentStreamEvent,
  parseRuntimeEvent,
  runtimeFingerprint,
  affectedAssessmentIds,
} from "../../utils/workspace-runtime-parser";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeAssessmentTimeline,
  type WorkspaceRuntimeAgentStreamHistoryState,
  type WorkspaceRuntimeContextValue,
} from "../../types/workspace-runtime.types";

export { WORKSPACE_RUNTIME_CONNECTION_STATES };

const initialRuntime: WorkspaceRuntimeContextValue = {
  connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connecting,
  emittedAt: null,
  runs: [],
  recentActivity: [],
  engineeringProgress: [],
  repositorySnapshots: [],
  scanJobs: [],
  evidenceReports: [],
  postFindingStates: [],
  runsByAssessmentId: {},
  recentActivityByAssessmentId: {},
  engineeringProgressByAssessmentId: {},
  agentStreamEventsByAssessmentId: {},
  agentStreamHistoryByAssessmentId: {},
  latestRunIdByAssessmentId: {},
  postFindingByAssessmentId: {},
  stageLifecycleByAssessmentId: {},
  getAssessmentRuntime: (): WorkspaceRuntimeAssessmentTimeline => ({
    currentRun: null,
    recentActivity: [],
    engineeringProgress: [],
    agentStreamEvents: [],
    agentStreamHistory: emptyAgentStreamHistoryState(),
    latestRunId: null,
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connecting,
    lastEmittedAt: null,
    postFinding: null,
  }),
  subscribeAssessmentRuntime: () => () => undefined,
  loadMoreAgentStreamHistory: () => Promise.resolve(false),
};

const WorkspaceRuntimeContext =
  createContext<WorkspaceRuntimeContextValue>(initialRuntime);
const AGENT_STREAM_VISIBLE_EVENT_LIMIT = 5_000;
const AGENT_STREAM_HISTORY_PAGE_LIMIT = 5_000;

export type ScopedAgentStreamSource = {
  onopen?: ((event: Event) => void) | null;
  onerror?: ((event: Event) => void) | null;
  addEventListener: (
    type: "workspace.agent-stream",
    listener: (event: MessageEvent<string>) => void,
  ) => void;
  removeEventListener: (
    type: "workspace.agent-stream",
    listener: (event: MessageEvent<string>) => void,
  ) => void;
  close: () => void;
};

export type ScopedAgentStreamEntry = {
  source: ScopedAgentStreamSource | null;
  subscribers: number;
  onAgentStream: (event: MessageEvent<string>) => void;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  stopped: boolean;
  connect: () => void;
};

export function WorkspaceRuntimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [runtime, setRuntime] = useState(initialRuntime);
  const queryClient = useQueryClient();
  const latestFingerprint = useRef<string | null>(null);
  const scopedAgentStreams = useRef<Map<string, ScopedAgentStreamEntry>>(
    new Map(),
  );
  const initialHistoryRequests = useRef<Set<string>>(new Set());
  const historyPageRequests = useRef<Set<string>>(new Set());

  const appendAgentStreamEvent = useCallback((event: MessageEvent<string>) => {
    const parsed = parseAgentStreamEvent(event.data);
    if (parsed === null) return false;
    setRuntime((current) => {
      const previous =
        current.agentStreamEventsByAssessmentId[parsed.assessmentId] ?? [];
      if (previous.some((item) => item.eventId === parsed.eventId)) {
        return current;
      }
      const historyState =
        current.agentStreamHistoryByAssessmentId[parsed.assessmentId] ??
        emptyAgentStreamHistoryState();
      const nextEvents = mergeAgentStreamEvents(previous, [parsed], {
        limit: agentStreamRetentionLimit(historyState),
      });
      return withAgentStreamEvents(current, {
        ...current.agentStreamEventsByAssessmentId,
        [parsed.assessmentId]: nextEvents,
      });
    });
    return true;
  }, []);

  const loadAgentStreamHistoryPage = useCallback(
    async (
      assessmentId: string,
      options: { cursor: string | null; initial: boolean },
    ) => {
      const scopedAssessmentId = assessmentId.trim();
      if (!scopedAssessmentId) return false;
      const requestKey = `${scopedAssessmentId}:${options.cursor ?? ""}`;
      if (historyPageRequests.current.has(requestKey)) return false;
      historyPageRequests.current.add(requestKey);
      setRuntime((current) =>
        withAgentStreamHistoryState(current, scopedAssessmentId, {
          ...(current.agentStreamHistoryByAssessmentId[scopedAssessmentId] ??
            emptyAgentStreamHistoryState()),
          isLoading: true,
          error: null,
        }),
      );
      try {
        const { ok, payload } = await apiRequest(
          workspaceRuntimeHistoryUrl(
            scopedAssessmentId,
            options.cursor,
            AGENT_STREAM_HISTORY_PAGE_LIMIT,
          ),
        );
        const page = ok ? parseAgentStreamHistoryPage(payload) : null;
        if (page === null) {
          setRuntime((current) =>
            withAgentStreamHistoryState(current, scopedAssessmentId, {
              ...(current.agentStreamHistoryByAssessmentId[
                scopedAssessmentId
              ] ?? emptyAgentStreamHistoryState()),
              isLoading: false,
              error: "history-load-failed",
            }),
          );
          return false;
        }
        setRuntime((current) => {
          const previous =
            current.agentStreamEventsByAssessmentId[scopedAssessmentId] ?? [];
          const previousHistory =
            current.agentStreamHistoryByAssessmentId[scopedAssessmentId] ??
            emptyAgentStreamHistoryState();
          const nextHistoryState = {
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            isLoading: false,
            error: null,
            hasLoadedOlderHistory:
              previousHistory.hasLoadedOlderHistory || !options.initial,
            hasHydratedCompleteHistory:
              previousHistory.hasHydratedCompleteHistory ||
              (!page.hasMore && page.nextCursor === null),
          } satisfies WorkspaceRuntimeAgentStreamHistoryState;
          const nextEvents = mergeAgentStreamEvents(previous, page.events, {
            limit: agentStreamRetentionLimit(nextHistoryState),
          });
          return withAgentStreamHistoryState(
            withAgentStreamEvents(current, {
              ...current.agentStreamEventsByAssessmentId,
              [scopedAssessmentId]: nextEvents,
            }),
            scopedAssessmentId,
            nextHistoryState,
          );
        });
        return true;
      } catch {
        setRuntime((current) =>
          withAgentStreamHistoryState(current, scopedAssessmentId, {
            ...(current.agentStreamHistoryByAssessmentId[scopedAssessmentId] ??
              emptyAgentStreamHistoryState()),
            isLoading: false,
            error: "history-load-failed",
          }),
        );
        return false;
      } finally {
        historyPageRequests.current.delete(requestKey);
      }
    },
    [],
  );

  const loadMoreAgentStreamHistory = useCallback(
    async (assessmentId: string) => {
      const scopedAssessmentId = assessmentId.trim();
      if (!scopedAssessmentId) return false;
      const historyState =
        runtime.agentStreamHistoryByAssessmentId[scopedAssessmentId] ??
        emptyAgentStreamHistoryState();
      if (
        historyState.isLoading ||
        (historyState.error === null &&
          (!historyState.hasMore || historyState.nextCursor === null))
      ) {
        return false;
      }
      if (historyState.error !== null && historyState.nextCursor === null) {
        initialHistoryRequests.current.add(scopedAssessmentId);
        const loaded = await loadAgentStreamHistoryPage(scopedAssessmentId, {
          cursor: null,
          initial: true,
        });
        retainInitialAgentStreamHistoryRequest(
          initialHistoryRequests.current,
          scopedAssessmentId,
          loaded,
        );
        return loaded;
      }
      return loadAgentStreamHistoryPage(scopedAssessmentId, {
        cursor: historyState.nextCursor,
        initial: false,
      });
    },
    [loadAgentStreamHistoryPage, runtime.agentStreamHistoryByAssessmentId],
  );

  const subscribeAssessmentRuntime = useCallback(
    (assessmentId: string) => {
      const scopedAssessmentId = assessmentId.trim();
      if (
        scopedAssessmentId &&
        !initialHistoryRequests.current.has(scopedAssessmentId)
      ) {
        initialHistoryRequests.current.add(scopedAssessmentId);
        void loadAgentStreamHistoryPage(scopedAssessmentId, {
          cursor: null,
          initial: true,
        }).then((loaded) => {
          retainInitialAgentStreamHistoryRequest(
            initialHistoryRequests.current,
            scopedAssessmentId,
            loaded,
          );
        });
      }
      return subscribeScopedAssessmentRuntimeStream({
        assessmentId,
        appendAgentStreamEvent,
        scopedAgentStreams: scopedAgentStreams.current,
        replayAgentStreamHistory: (replayAssessmentId) =>
          loadAgentStreamHistoryPage(replayAssessmentId, {
            cursor: null,
            initial: true,
          }),
      });
    },
    [appendAgentStreamEvent, loadAgentStreamHistoryPage],
  );

  useEffect(() => {
    let source: EventSource;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;
    let needsResync = false;
    const activeScopedAgentStreams = scopedAgentStreams.current;
    const onRuntime = (event: MessageEvent<string>) => {
      const parsed = parseRuntimeEvent(event.data);
      if (parsed !== null) {
        attempts = 0;
        setRuntime((current) =>
          withAgentStreamHistoryByAssessmentId(
            withAgentStreamEvents(
              parsed,
              current.agentStreamEventsByAssessmentId,
            ),
            current.agentStreamHistoryByAssessmentId,
          ),
        );
        const fingerprint = runtimeFingerprint(parsed);
        if (latestFingerprint.current !== fingerprint) {
          latestFingerprint.current = fingerprint;
          // Runtime outcomes can change lifecycle status (e.g. AI not detected).
          void queryClient.invalidateQueries({
            queryKey: apiQueryKeys.workspace.assessments(),
          });
          for (const assessmentId of affectedAssessmentIds(parsed)) {
            void queryClient.invalidateQueries({
              queryKey: apiQueryKeys.assessment.interview(assessmentId),
            });
            void queryClient.invalidateQueries({
              queryKey: apiQueryKeys.assessment.readiness(assessmentId),
            });
            void queryClient.invalidateQueries({
              queryKey: apiQueryKeys.assessment.evidence(assessmentId),
            });
            void queryClient.invalidateQueries({
              queryKey:
                apiQueryKeys.assessment.evidenceGraphOverviewRoot(assessmentId),
            });
            void queryClient.invalidateQueries({
              queryKey: apiQueryKeys.assessment.classification(assessmentId),
            });
            void queryClient.invalidateQueries({
              queryKey: apiQueryKeys.assessment.artifacts(assessmentId),
            });
          }
        }
      }
    };

    const onAgentStream = (event: MessageEvent<string>) => {
      if (appendAgentStreamEvent(event)) {
        attempts = 0;
      }
    };

    const connect = () => {
      if (stopped) return;
      source = new EventSource(workspaceRuntimeEventsUrl());
      source.addEventListener("workspace.runtime", onRuntime);
      source.addEventListener("workspace.agent-stream", onAgentStream);
      source.onopen = () => {
        if (needsResync) {
          latestFingerprint.current = null;
          void queryClient.invalidateQueries({
            queryKey: apiQueryKeys.workspace.detail(),
          });
          void queryClient.invalidateQueries({
            queryKey: apiQueryKeys.workspace.assessments(),
          });
          void queryClient.invalidateQueries({
            predicate: (query) => query.queryKey[0] === "assessment",
          });
          needsResync = false;
        }
        setRuntime((current) => ({
          ...current,
          connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
        }));
      };
      source.onerror = () => {
        source.removeEventListener("workspace.runtime", onRuntime);
        source.removeEventListener("workspace.agent-stream", onAgentStream);
        source.onopen = null;
        source.onerror = null;
        source.close();
        needsResync = true;
        setRuntime((current) => ({
          ...current,
          connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
        }));
        const delay = Math.min(1000 * 2 ** Math.min(attempts++, 5), 30000);
        retryTimer = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      for (const entry of activeScopedAgentStreams.values()) {
        closeScopedAssessmentRuntimeStream(entry);
      }
      activeScopedAgentStreams.clear();
      source.removeEventListener("workspace.runtime", onRuntime);
      source.removeEventListener("workspace.agent-stream", onAgentStream);
      source.onopen = null;
      source.onerror = null;
      source.close();
    };
  }, [appendAgentStreamEvent, queryClient]);

  return (
    <WorkspaceRuntimeContext.Provider
      value={{
        ...runtime,
        subscribeAssessmentRuntime,
        loadMoreAgentStreamHistory,
      }}
    >
      {children}
    </WorkspaceRuntimeContext.Provider>
  );
}

export function workspaceRuntimeEventsUrl(
  assessmentId?: string,
  agentStreamOnly = false,
): string {
  const params = new URLSearchParams();
  if (assessmentId) {
    params.set("assessment_id", assessmentId);
  }
  if (agentStreamOnly) {
    params.set("agent_stream_only", "1");
  }
  const query = params.toString();
  return query
    ? `/api/workspace/runtime-events?${query}`
    : "/api/workspace/runtime-events";
}

export function workspaceRuntimeHistoryUrl(
  assessmentId: string,
  cursor: string | null,
  limit = AGENT_STREAM_HISTORY_PAGE_LIMIT,
): string {
  const params = new URLSearchParams();
  params.set("assessment_id", assessmentId);
  params.set("limit", String(limit));
  if (cursor) {
    params.set("cursor", cursor);
  }
  return `/api/workspace/runtime-events/history?${params.toString()}`;
}

export function subscribeScopedAssessmentRuntimeStream({
  assessmentId,
  appendAgentStreamEvent,
  scopedAgentStreams,
  replayAgentStreamHistory,
  reconnectDelayMs = defaultScopedAgentStreamReconnectDelayMs,
  createEventSource = (url) => new EventSource(url),
}: {
  assessmentId: string;
  appendAgentStreamEvent: (event: MessageEvent<string>) => boolean;
  scopedAgentStreams: Map<string, ScopedAgentStreamEntry>;
  replayAgentStreamHistory?: (assessmentId: string) => Promise<unknown> | unknown;
  reconnectDelayMs?: (attempt: number) => number;
  createEventSource?: (url: string) => ScopedAgentStreamSource;
}): () => void {
  const scopedAssessmentId = assessmentId.trim();
  if (!scopedAssessmentId) {
    return () => undefined;
  }
  const existing = scopedAgentStreams.get(scopedAssessmentId);
  if (existing) {
    existing.subscribers += 1;
    return () => {
      releaseScopedAssessmentRuntimeStream(
        scopedAgentStreams,
        scopedAssessmentId,
      );
    };
  }

  const onAgentStream = (event: MessageEvent<string>) => {
    appendAgentStreamEvent(event);
  };
  const entry: ScopedAgentStreamEntry = {
    source: null,
    subscribers: 1,
    onAgentStream,
    reconnectTimer: null,
    attempts: 0,
    stopped: false,
    connect: () => {
      if (entry.stopped) return;
      const source = createEventSource(
        workspaceRuntimeEventsUrl(scopedAssessmentId, true),
      );
      entry.source = source;
      source.addEventListener("workspace.agent-stream", onAgentStream);
      source.onopen = () => {
        entry.attempts = 0;
      };
      source.onerror = () => {
        cleanupScopedAgentStreamSource(entry);
        const delay = reconnectDelayMs(entry.attempts++);
        entry.reconnectTimer = setTimeout(() => {
          entry.reconnectTimer = null;
          void Promise.resolve(replayAgentStreamHistory?.(scopedAssessmentId))
            .catch(() => undefined)
            .then(() => {
              if (!entry.stopped) {
                entry.connect();
              }
            });
        }, delay);
      };
    },
  };
  scopedAgentStreams.set(scopedAssessmentId, entry);
  entry.connect();

  return () => {
    releaseScopedAssessmentRuntimeStream(
      scopedAgentStreams,
      scopedAssessmentId,
    );
  };
}

function releaseScopedAssessmentRuntimeStream(
  scopedAgentStreams: Map<string, ScopedAgentStreamEntry>,
  scopedAssessmentId: string,
) {
  const current = scopedAgentStreams.get(scopedAssessmentId);
  if (!current) return;
  current.subscribers -= 1;
  if (current.subscribers > 0) return;
  closeScopedAssessmentRuntimeStream(current);
  scopedAgentStreams.delete(scopedAssessmentId);
}

function defaultScopedAgentStreamReconnectDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.min(attempt, 5), 30000);
}

function closeScopedAssessmentRuntimeStream(entry: ScopedAgentStreamEntry) {
  entry.stopped = true;
  if (entry.reconnectTimer !== null) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
  cleanupScopedAgentStreamSource(entry);
}

function cleanupScopedAgentStreamSource(entry: ScopedAgentStreamEntry) {
  if (entry.source === null) return;
  entry.source.removeEventListener(
    "workspace.agent-stream",
    entry.onAgentStream,
  );
  entry.source.onopen = null;
  entry.source.onerror = null;
  entry.source.close();
  entry.source = null;
}

export function mergeAgentStreamEvents(
  previous: AssessmentAgentStreamEvent[],
  incoming: AssessmentAgentStreamEvent[],
  options: { limit?: number | null } = {},
): AssessmentAgentStreamEvent[] {
  const eventsById = new Map<string, AssessmentAgentStreamEvent>();
  for (const event of previous) {
    eventsById.set(event.eventId, event);
  }
  for (const event of incoming) {
    if (!eventsById.has(event.eventId)) {
      eventsById.set(event.eventId, event);
    }
  }
  const ordered = [...eventsById.values()].sort(compareAgentStreamEvents);
  return typeof options.limit === "number"
    ? ordered.slice(-options.limit)
    : ordered;
}

export function agentStreamRetentionLimit(
  historyState: WorkspaceRuntimeAgentStreamHistoryState,
): number | null {
  return historyState.hasLoadedOlderHistory ||
    historyState.hasHydratedCompleteHistory ||
    hasOlderAgentStreamHistoryCursor(historyState)
    ? null
    : AGENT_STREAM_VISIBLE_EVENT_LIMIT;
}

export function retainInitialAgentStreamHistoryRequest(
  initialHistoryRequests: Set<string>,
  assessmentId: string,
  loaded: boolean,
) {
  if (loaded) {
    initialHistoryRequests.add(assessmentId);
    return;
  }
  initialHistoryRequests.delete(assessmentId);
}

function hasOlderAgentStreamHistoryCursor(
  historyState: WorkspaceRuntimeAgentStreamHistoryState,
): boolean {
  return historyState.hasMore && historyState.nextCursor !== null;
}

function compareAgentStreamEvents(
  left: AssessmentAgentStreamEvent,
  right: AssessmentAgentStreamEvent,
) {
  if (left.runId === right.runId) {
    const sequence = left.sequence - right.sequence;
    if (sequence !== 0) return sequence;
  }
  const emittedAt = left.emittedAt.localeCompare(right.emittedAt);
  if (emittedAt !== 0) return emittedAt;
  if (left.runId !== right.runId) {
    return left.runId.localeCompare(right.runId);
  }
  return left.eventId.localeCompare(right.eventId);
}

function withAgentStreamEvents(
  runtime: WorkspaceRuntimeContextValue,
  agentStreamEventsByAssessmentId: WorkspaceRuntimeContextValue["agentStreamEventsByAssessmentId"],
): WorkspaceRuntimeContextValue {
  return {
    ...runtime,
    agentStreamEventsByAssessmentId,
    getAssessmentRuntime: (assessmentId: string) => ({
      currentRun: runtime.runsByAssessmentId[assessmentId]?.[0] ?? null,
      recentActivity: runtime.recentActivityByAssessmentId[assessmentId] ?? [],
      engineeringProgress:
        runtime.engineeringProgressByAssessmentId[assessmentId] ?? [],
      agentStreamEvents: agentStreamEventsByAssessmentId[assessmentId] ?? [],
      agentStreamHistory:
        runtime.agentStreamHistoryByAssessmentId[assessmentId] ??
        emptyAgentStreamHistoryState(),
      latestRunId: runtime.latestRunIdByAssessmentId[assessmentId] ?? null,
      connectionState: runtime.connectionState,
      lastEmittedAt: runtime.emittedAt,
      postFinding: runtime.postFindingByAssessmentId[assessmentId] ?? null,
      stageLifecycle:
        runtime.stageLifecycleByAssessmentId[assessmentId] ?? null,
    }),
  };
}

function withAgentStreamHistoryState(
  runtime: WorkspaceRuntimeContextValue,
  assessmentId: string,
  historyState: WorkspaceRuntimeAgentStreamHistoryState,
): WorkspaceRuntimeContextValue {
  return withAgentStreamHistoryByAssessmentId(runtime, {
    ...runtime.agentStreamHistoryByAssessmentId,
    [assessmentId]: historyState,
  });
}

function withAgentStreamHistoryByAssessmentId(
  runtime: WorkspaceRuntimeContextValue,
  agentStreamHistoryByAssessmentId: WorkspaceRuntimeContextValue["agentStreamHistoryByAssessmentId"],
): WorkspaceRuntimeContextValue {
  return withAgentStreamEvents(
    {
      ...runtime,
      agentStreamHistoryByAssessmentId,
    },
    runtime.agentStreamEventsByAssessmentId,
  );
}

type AgentStreamHistoryPage = {
  events: AssessmentAgentStreamEvent[];
  hasMore: boolean;
  nextCursor: string | null;
};

function parseAgentStreamHistoryPage(
  payload: unknown,
): AgentStreamHistoryPage | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const item = payload as Record<string, unknown>;
  if (!Array.isArray(item.events) || typeof item.has_more !== "boolean") {
    return null;
  }
  const events = item.events.flatMap((event): AssessmentAgentStreamEvent[] => {
    const parsed = parseAgentStreamEvent(JSON.stringify(event));
    return parsed === null ? [] : [parsed];
  });
  return {
    events,
    hasMore: item.has_more,
    nextCursor: typeof item.next_cursor === "string" ? item.next_cursor : null,
  };
}

function emptyAgentStreamHistoryState(): WorkspaceRuntimeAgentStreamHistoryState {
  return {
    hasMore: false,
    nextCursor: null,
    isLoading: false,
    error: null,
    hasLoadedOlderHistory: false,
    hasHydratedCompleteHistory: false,
  };
}

export function useWorkspaceRuntime() {
  return useContext(WorkspaceRuntimeContext);
}

const __workspaceRuntimeTestUtils = {
  parseRuntimeEvent,
};