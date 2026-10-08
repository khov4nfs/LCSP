import {
  ASSESSMENT_DECISION_RECORD_STATES,
  type AssessmentDetail,
} from "@lcsp/contracts/assessment-domain";
import { resolveAppMessage } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";

export function AssessmentDecisions({
  assessment,
}: {
  assessment: AssessmentDetail;
}) {
  const decisions =
    assessment.case?.decisions.filter(
      (item) => item.state === ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
    ) ?? [];
  if (!decisions.length) return null;
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={resolveAppMessage("pages.agenticAssessment.decisions")}
    >
      <h2 className="text-sm font-semibold">
        {resolveAppMessage("pages.agenticAssessment.decisions")}
      </h2>
      <ul className="flex flex-col gap-3">
        {decisions.map(({ decisionId, decision }) => (
          <li
            key={decisionId}
            className="rounded-lg border p-4"
            data-decision-id={decisionId}
          >
            <div className="mb-2 flex gap-2">
              <Badge variant="outline">
                {resolveAppMessage(
                  `pages.agenticAssessment.outcomes.${decision.applicability}`,
                )}
              </Badge>
              {decision.compliance ? (
                <Badge variant="secondary">
                  {resolveAppMessage(
                    `pages.agenticAssessment.outcomes.${decision.compliance}`,
                  )}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm">{decision.rationale}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {decision.criteria.map((criterion) => (
                <li key={criterion.criterionId} className="text-sm">
                  <Badge variant="outline">
                    {resolveAppMessage(
                      `pages.agenticAssessment.outcomes.${criterion.outcome}`,
                    )}
                  </Badge>{" "}
                  {criterion.rationale}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
