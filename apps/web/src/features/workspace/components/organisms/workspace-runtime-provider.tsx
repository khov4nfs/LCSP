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
import {
  parseRuntimeEvent,
  runtimeFingerprint,
  affectedAssessmentIds,
} from "../../utils/workspace-runtime-parser";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeContextValue,
} from "../../types/workspace-runtime.types";
export { WORKSPACE_RUNTIME_CONNECTION_STATES };
const initialRuntime: WorkspaceRuntimeContextValue = {
  connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connecting,
  emittedAt: null,
  canonicalAssessments: [],
  canonicalEvents: [],
  canonicalAssessmentByAssessmentId: {},
  canonicalEventsByAssessmentId: {},
  getAssessmentRuntime: () => ({
    canonicalAssessment: null,
    canonicalEvents: [],
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connecting,
    lastEmittedAt: null,
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
