-- Validation feedback survives worker/API restarts; edits revoke the previous result.
ALTER TABLE "RuleSetPreparationRun" ADD COLUMN "draftValidation" JSONB;
