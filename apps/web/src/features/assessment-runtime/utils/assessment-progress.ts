import { DECISION_RESOLUTION_STATES } from "@lcsp/contracts/assessment";
import type { AssessmentDetail } from "@lcsp/contracts/assessment-domain";

/** Rules evaluated so far out of the pinned rule set, from canonical coverage rows only. */
export function assessmentProgress(detail: AssessmentDetail | null): {
  done: number;
  total: number;
} | null {
  const coverage = detail?.case?.coverage;
  if (!coverage || coverage.length === 0) return null;
  return {
    done: coverage.filter(
      (row) => row.resolutionState === DECISION_RESOLUTION_STATES.RESOLVED,
    ).length,
    total: coverage.length,
  };
}
