"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";
import {
  parseRuntimeEvent,
  parseAgentStreamEvent,
  runtimeFingerprint,
  affectedAssessmentIds,
} from "../../utils/workspace-runtime-parser";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeContextValue,
  type WorkspaceRuntimeAssessmentTimeline,
  type WorkspaceRuntimeAgentStreamHistoryState,
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
  canonicalAssessments: [],
  canonicalEvents: [],
  runsByAssessmentId: {},
  recentActivityByAssessmentId: {},
  engineeringProgressByAssessmentId: {},
  agentStreamEventsByAssessmentId: {},
  agentStreamHistoryByAssessmentId: {},
  latestRunIdByAssessmentId: {},
  postFindingByAssessmentId: {},
  canonicalAssessmentByAssessmentId: {},
  canonicalEventsByAssessmentId: {},
  getAssessmentRuntime: (): WorkspaceRuntimeAssessmentTimeline => ({
    canonicalAssessment: null,
    canonicalEvents: [],
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

const WorkspaceRuntimeContext =
  createContext<WorkspaceRuntimeContextValue>(initialRuntime);
const AGENT_STREAM_VISIBLE_EVENT_LIMIT = 5_000;
const AGENT_STREAM_HISTORY_PAGE_LIMIT = 5_000;
export function WorkspaceRuntimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [runtime, setRuntime] = useState(initialRuntime);
  const client = useQueryClient();
  const fingerprint = useRef<string | null>(null);
  useEffect(() => {
    const source = new EventSource("/api/workspace/runtime-events");
    source.addEventListener(
      "workspace.runtime",
      (event: MessageEvent<string>) => {
        const parsed = parseRuntimeEvent(event.data);
        if (!parsed) {
          setRuntime((value) => ({
            ...value,
            connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
          }));
          return;
        }
        setRuntime(parsed);
        const next = runtimeFingerprint(parsed);
        if (next !== fingerprint.current) {
          fingerprint.current = next;
          void client.invalidateQueries({ queryKey: ["assessments"] });
          for (const id of affectedAssessmentIds(parsed))
            void client.invalidateQueries({ queryKey: ["assessment", id] });
        }
      },
    );
    source.onerror = () =>
      setRuntime((value) => ({
        ...value,
        connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
      }));
    return () => source.close();
  }, [client]);
  return (
    <WorkspaceRuntimeContext.Provider value={runtime}>
      {children}
    </WorkspaceRuntimeContext.Provider>
  );
}
export function useWorkspaceRuntime() {
  return useContext(WorkspaceRuntimeContext);
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
  replayAgentStreamHistory?: (
    assessmentId: string,
  ) => Promise<unknown> | unknown;
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
      canonicalAssessment:
        runtime.canonicalAssessmentByAssessmentId[assessmentId] ?? null,
      canonicalEvents:
        runtime.canonicalEventsByAssessmentId[assessmentId] ?? [],
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
