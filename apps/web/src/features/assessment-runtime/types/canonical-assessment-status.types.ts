import type {
  AssessmentEvent,
  CanonicalAssessmentRuntimeSnapshot,
} from "@lcsp/contracts";

import type { WorkspaceRuntimeConnectionState } from "../../workspace/types/workspace-runtime.types";
import type { AssessmentUsageSummary } from "@lcsp/contracts/assessment-domain";

export type CanonicalAssessmentStatusProps = {
  canonicalAssessment: CanonicalAssessmentRuntimeSnapshot | null;
  connectionState: WorkspaceRuntimeConnectionState;
};

export type CanonicalAssessmentActivityProps = {
  events: AssessmentEvent[];
  usage?: AssessmentUsageSummary;
};

export type CanonicalStateRowProps = {
  dataState: string;
  label: string;
  value: string;
};
