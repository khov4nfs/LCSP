-- Why: A worker-supplied stream event ID was not unique in the persisted rule-rejection journal.
-- How: Reject duplicate rejection IDs per run at the storage boundary rather than choosing a JSON row by order.
-- Invariant: Other stream event kinds keep their existing replay and lifecycle rules.
CREATE UNIQUE INDEX "AssessmentRuntimeEvent_ruleRejectionEvent_run_event_unique"
ON "AssessmentRuntimeEvent" (
  "runId",
  (("outputSummaryJson" #>> '{agentStreamEvent,eventId}') COLLATE "C")
)
WHERE "boundaryType" = 'RULE_SET_PREPARATION'
  AND "outputSummaryJson" #>> '{agentStreamEvent,data,activity_kind}' = 'RULE_AUTHORING_TOOL_REJECTED';

-- Why: A missing ID cannot be bound to a later evaluation even with a unique index.
-- How: Require a nonempty persisted stream ID for this exact rejection kind.
-- Invariant: Only the rule-authoring rejection evidence class is constrained.
ALTER TABLE "AssessmentRuntimeEvent"
ADD CONSTRAINT "AssessmentRuntimeEvent_ruleRejectionEvent_id_present"
CHECK (
  NOT (
    "boundaryType" = 'RULE_SET_PREPARATION'
    AND "outputSummaryJson" #>> '{agentStreamEvent,data,activity_kind}' = 'RULE_AUTHORING_TOOL_REJECTED'
  )
  OR length(coalesce("outputSummaryJson" #>> '{agentStreamEvent,eventId}', '')) > 0
);

-- Why: A callback must not rely on journal evidence that a direct DB writer can rewrite or erase later.
-- How: Reject UPDATE and DELETE of a persisted rule-authoring rejection row.
-- Invariant: Unrelated runtime events remain governed by their existing retention policy.
CREATE FUNCTION "lcsp_rejection_journal_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."boundaryType" = 'RULE_SET_PREPARATION'
     AND OLD."outputSummaryJson" #>> '{agentStreamEvent,data,activity_kind}' = 'RULE_AUTHORING_TOOL_REJECTED' THEN
    RAISE EXCEPTION 'rule rejection journal evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "AssessmentRuntimeEvent_ruleRejectionEvent_immutable"
BEFORE UPDATE OR DELETE ON "AssessmentRuntimeEvent"
FOR EACH ROW EXECUTE FUNCTION "lcsp_rejection_journal_immutable"();
