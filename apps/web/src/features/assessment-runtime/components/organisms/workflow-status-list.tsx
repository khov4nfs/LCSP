import type { NormalizedAssessmentRuntime } from "../../../workspace/types/assessment-runtime-adapter.types";
import { CanonicalAssessmentStatus } from "./canonical-assessment-status";

export function WorkflowStatusList({
  canonicalAssessment,
  connectionState,
}: {
  canonicalAssessment: NormalizedAssessmentRuntime["canonicalAssessment"];
  connectionState: NormalizedAssessmentRuntime["connectionState"];
}) {
  return (
    <CanonicalAssessmentStatus
      canonicalAssessment={canonicalAssessment}
      connectionState={connectionState}
    />
  );
}
