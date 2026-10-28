-- CreateTable
CREATE TABLE "RuleSetPreparationAuthoringDraft" (
    "preparationRunId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "draft" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleSetPreparationAuthoringDraft_pkey" PRIMARY KEY ("preparationRunId","revision")
);

-- AddForeignKey
ALTER TABLE "RuleSetPreparationAuthoringDraft" ADD CONSTRAINT "RuleSetPreparationAuthoringDraft_preparationRunId_fkey" FOREIGN KEY ("preparationRunId") REFERENCES "RuleSetPreparationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
