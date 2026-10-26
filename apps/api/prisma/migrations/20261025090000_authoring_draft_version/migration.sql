ALTER TABLE "RuleSetPreparationAuthoringDraft"
ADD COLUMN "draftVersion" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "RuleSetPreparationAuthoringDraft_version_check" CHECK ("draftVersion" >= 0);
