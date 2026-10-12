import type { CanonicalAssessmentRuntimeSnapshot } from "@lcsp/contracts/evidence";
import type { AssessmentEvent } from "@lcsp/contracts/assessment";
export const WORKSPACE_RUNTIME_CONNECTION_STATES = {
  connecting: "CONNECTING",
  connected: "CONNECTED",
  disconnected: "DISCONNECTED",
} as const;
export type WorkspaceRuntimeConnectionState =
  (typeof WORKSPACE_RUNTIME_CONNECTION_STATES)[keyof typeof WORKSPACE_RUNTIME_CONNECTION_STATES];
export type WorkspaceRuntimeAssessmentTimeline = {
  canonicalAssessment: CanonicalAssessmentRuntimeSnapshot | null;
  canonicalEvents: AssessmentEvent[];
  connectionState: WorkspaceRuntimeConnectionState;
  lastEmittedAt: string | null;
};
export type WorkspaceRuntimeContextValue = {
  connectionState: WorkspaceRuntimeConnectionState;
  emittedAt: string | null;
  canonicalAssessments: CanonicalAssessmentRuntimeSnapshot[];
  canonicalEvents: AssessmentEvent[];
  canonicalAssessmentByAssessmentId: Record<
    string,
    CanonicalAssessmentRuntimeSnapshot
  >;
  canonicalEventsByAssessmentId: Record<string, AssessmentEvent[]>;
  getAssessmentRuntime: (
    assessmentId: string,
  ) => WorkspaceRuntimeAssessmentTimeline;
};
