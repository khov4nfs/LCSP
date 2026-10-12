-- CreateEnum
CREATE TYPE "RuleAnalysisStatus" AS ENUM ('COMPLETED', 'NEEDS_CONTEXT', 'UNRESOLVED', 'FAILED');

-- CreateTable
CREATE TABLE "EngineeringRuleAssessment" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "engineeringRuleId" TEXT NOT NULL,
    "engineeringRuleVersion" TEXT NOT NULL,
    "repositoryVersion" TEXT NOT NULL,
    "contextRevision" INTEGER NOT NULL,
    "status" "RuleAnalysisStatus" NOT NULL,
    "resultId" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "limitations" TEXT[],
    "execution" JSONB NOT NULL,
    "attempt" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineeringRuleAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngineeringRuleAssessment_assessmentId_engineeringRuleId_key" ON "EngineeringRuleAssessment"("assessmentId", "engineeringRuleId");

-- CreateIndex
CREATE INDEX "EngineeringRuleAssessment_assessmentId_updatedAt_idx" ON "EngineeringRuleAssessment"("assessmentId", "updatedAt");

-- AddForeignKey
ALTER TABLE "EngineeringRuleAssessment" ADD CONSTRAINT "EngineeringRuleAssessment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
