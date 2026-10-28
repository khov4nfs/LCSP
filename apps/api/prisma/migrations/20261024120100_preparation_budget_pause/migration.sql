-- Preserve the existing failure invariant, with one non-terminal budget-pause exception.
ALTER TABLE "RuleSetPreparationRun"
  DROP CONSTRAINT "RuleSetPreparationRun_failure_reason_check",
  ADD CONSTRAINT "RuleSetPreparationRun_failure_reason_check" CHECK (
    (("executionState" = 'FAILED') = ("failureReason" IS NOT NULL))
    OR ("executionState" = 'PAUSED' AND "failureReason"::text = 'AGENT_BUDGET_REACHED')
  );
