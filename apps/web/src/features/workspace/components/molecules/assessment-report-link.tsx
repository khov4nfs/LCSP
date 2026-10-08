import {
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import type { AssessmentDetail } from "@lcsp/contracts/assessment-domain";
import { resolveAppMessage } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";

export function AssessmentReportLink({
  assessment,
}: {
  assessment: AssessmentDetail;
}) {
  if (assessment.lifecycle?.state !== ASSESSMENT_LIFECYCLE_STATES.COMPLETE)
    return null;
  const artifact = assessment.case?.artifacts.find(
    (item) => item.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
  );
  if (!artifact) return null;
  return (
    <a
      className={buttonVariants()}
      href={`/api/assessments/${encodeURIComponent(assessment.assessment_id)}/artifacts/${encodeURIComponent(artifact.artifactId)}/download`}
      data-artifact-id={artifact.artifactId}
    >
      {resolveAppMessage("pages.agenticAssessment.downloadReport")}
    </a>
  );
}
