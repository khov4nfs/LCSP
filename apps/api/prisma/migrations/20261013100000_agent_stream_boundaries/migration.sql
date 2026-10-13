-- Reuse the durable assessment runtime journal for every customer-visible agent boundary.
CREATE TYPE "AgentStreamBoundaryType" AS ENUM ('ASSESSMENT', 'RULE_SET_PREPARATION');

ALTER TABLE "AssessmentRuntimeEvent"
  ADD COLUMN "boundaryType" "AgentStreamBoundaryType" NOT NULL DEFAULT 'ASSESSMENT',
  ADD COLUMN "boundaryId" TEXT,
  ADD COLUMN "preparationRunId" TEXT;

UPDATE "AssessmentRuntimeEvent"
SET "boundaryId" = "assessmentId"
WHERE "boundaryId" IS NULL;

ALTER TABLE "AssessmentRuntimeEvent"
  ALTER COLUMN "assessmentId" DROP NOT NULL,
  ALTER COLUMN "boundaryId" SET NOT NULL;

ALTER TABLE "AssessmentRuntimeEvent"
  ADD CONSTRAINT "AssessmentRuntimeEvent_preparationRunId_fkey"
  FOREIGN KEY ("preparationRunId") REFERENCES "RuleSetPreparationRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AssessmentRuntimeEvent_boundaryType_boundaryId_createdAt_idx"
  ON "AssessmentRuntimeEvent"("boundaryType", "boundaryId", "createdAt");

CREATE INDEX "AssessmentRuntimeEvent_preparationRunId_createdAt_idx"
  ON "AssessmentRuntimeEvent"("preparationRunId", "createdAt");
