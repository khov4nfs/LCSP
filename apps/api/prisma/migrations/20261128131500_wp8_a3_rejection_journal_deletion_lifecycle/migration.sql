-- Why: the earlier DELETE trigger prevented authorized Legal Source deletion from
-- removing terminal preparation runs and their rejection journal children.
-- How: keep the UPDATE immutability guard, while allowing the existing owner
-- lifecycle to delete the preparation tree in one transaction.
-- Invariant: the per-run event-ID uniqueness and nonempty-ID check remain active;
-- this migration does not authorize verdict delivery or change retention policy.
DROP TRIGGER IF EXISTS "AssessmentRuntimeEvent_ruleRejectionEvent_immutable"
ON "AssessmentRuntimeEvent";

CREATE TRIGGER "AssessmentRuntimeEvent_ruleRejectionEvent_immutable"
BEFORE UPDATE ON "AssessmentRuntimeEvent"
FOR EACH ROW EXECUTE FUNCTION "lcsp_rejection_journal_immutable"();
