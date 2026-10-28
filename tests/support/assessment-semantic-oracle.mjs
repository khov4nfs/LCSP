import assert from "node:assert/strict";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  RULE_DECISION_BASIS_KINDS,
} from "@lcsp/contracts/assessment";

// Evaluation oracle only: production Agents still interpret the pinned duty and source.
export function assertSemanticOutcome(
  { decisions, requests = [], lifecycleState },
  expected,
) {
  if (expected.decision === null) {
    assert.equal(
      decisions.length,
      0,
      "Unproven applicability cannot become a decision",
    );
    assert.ok(
      requests.some(
        (request) => request.status === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
      ),
    );
    assert.ok(
      [
        ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
        ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT,
      ].includes(lifecycleState),
      "Unproven applicability must remain in the human-resolution lifecycle",
    );
    return;
  }
  assert.equal(decisions.length, 1);
  const decision = decisions[0].decision ?? decisions[0];
  assert.equal(decision.applicability, expected.applicability);
  assert.equal(decision.compliance, expected.compliance);
  assert.deepEqual(
    decision.criteria
      .map(({ criterionId, outcome }) => ({ criterionId, outcome }))
      .sort((a, b) => a.criterionId.localeCompare(b.criterionId)),
    [...expected.criteria].sort((a, b) =>
      a.criterionId.localeCompare(b.criterionId),
    ),
  );
  if (expected.finding) {
    assert.ok(
      decision.applicabilityBasis?.some(
        (basis) =>
          basis.kind === RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION &&
          basis.finding === expected.finding &&
          basis.references.length > 0,
      ),
    );
  }
}
