import type { AssessmentSummary } from "./workspace.types";
import type { CanonicalAssessmentRuntimeSnapshot } from "@lcsp/contracts/evidence";
import type { WorkspaceRuntimeConnectionState } from "./workspace-runtime.types";

export type WorkspaceOverviewProps = {
  assessments: AssessmentSummary[];
  canonicalAssessments: Record<string, CanonicalAssessmentRuntimeSnapshot>;
  connectionState: WorkspaceRuntimeConnectionState;
};
