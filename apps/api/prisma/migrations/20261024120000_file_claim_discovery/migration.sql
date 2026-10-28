ALTER TYPE "RuleSetPreparationFailureReason" ADD VALUE 'AGENT_BUDGET_REACHED';
ALTER TABLE "RuleSetPreparationRun" ADD COLUMN "reviewOperationId" TEXT;
