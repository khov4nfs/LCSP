import type {
  AssessmentEvent,
  CanonicalAssessmentRuntimeSnapshot,
} from "@lcsp/contracts";

import type { WorkspaceRuntimeConnectionState } from "../../workspace/types/workspace-runtime.types";

export type CanonicalAssessmentStatusProps = {
  canonicalAssessment: CanonicalAssessmentRuntimeSnapshot | null;
  connectionState: WorkspaceRuntimeConnectionState;
};

export type CanonicalAssessmentActivityProps = {
  events: AssessmentEvent[];
};

export type CanonicalStateRowProps = {
  dataState: string;
  label: string;
  value: string;
};
