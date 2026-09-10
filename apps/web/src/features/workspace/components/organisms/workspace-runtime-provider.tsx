"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { apiQueryKeys } from "../../../../lib/api/query-keys.ts";
import {
  parseRuntimeEvent,
  runtimeFingerprint,
  affectedAssessmentIds,
} from "../../utils/workspace-runtime-parser";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeAssessmentTimeline,
  type WorkspaceRuntimeContextValue,
} from "../../types/workspace-runtime.types";

const initialRuntime: WorkspaceRuntimeContextValue = {
  connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connecting,
  emittedAt: null,
  runs: [],
  recentActivity: [],
  repositorySnapshots: [],
  scanJobs: [],
  evidenceReports: [],
  postFindingStates: [],
  runsByAssessmentId: {},
  recentActivityByAssessmentId: {},
  latestRunIdByAssessmentId: {},
  postFindingByAssessmentId: {},
  getAssessmentRuntime: (): WorkspaceRuntimeAssessmentTimeline => ({
    currentRun: null,
    recentActivity: [],
    latestRunId: null,
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connecting,
    lastEmittedAt: null,
    postFinding: null,
  }),
};

const WorkspaceRuntimeContext =
  createContext<WorkspaceRuntimeContextValue>(initialRuntime);

export function WorkspaceRuntimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [runtime, setRuntime] = useState(initialRuntime);
  const queryClient = useQueryClient();
  const latestFingerprint = useRef<string | null>(null);

  useEffect(() => {
    let source: EventSource;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;
    let needsResync = false;
    const onRuntime = (event: MessageEvent<string>) => {
      const parsed = parseRuntimeEvent(event.data);
      if (parsed !== null) {
        attempts = 0;
        setRuntime(parsed);
        const fingerprint = runtimeFingerprint(parsed);
        if (latestFingerprint.current !== fingerprint) {
          latestFingerprint.current = fingerprint;
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
              queryKey: apiQueryKeys.assessment.classification(assessmentId),
            });
          }
        }
      }
    };

    const connect = () => {
      if (stopped) return;
      source = new EventSource("/api/workspace/runtime-events");
      source.addEventListener("workspace.runtime", onRuntime);
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
      source.removeEventListener("workspace.runtime", onRuntime);
      source.onopen = null;
      source.onerror = null;
      source.close();
    };
  }, [queryClient]);

  return (
    <WorkspaceRuntimeContext.Provider value={runtime}>
      {children}
    </WorkspaceRuntimeContext.Provider>
  );
}

export function useWorkspaceRuntime() {
  return useContext(WorkspaceRuntimeContext);
}

export const __workspaceRuntimeTestUtils = {
  parseRuntimeEvent,
};
