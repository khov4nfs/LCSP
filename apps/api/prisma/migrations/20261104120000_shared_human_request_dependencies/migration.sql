-- Keep request ownership in every dependency and registration foreign key.
CREATE UNIQUE INDEX "AssessmentHumanRequest_requestId_assessmentId_key"
  ON "AssessmentHumanRequest"("requestId", "assessmentId");

CREATE TABLE "AssessmentHumanRequestDependency" (
  "requestId" UUID NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "assessmentRuleId" TEXT NOT NULL,
  "criterionIds" JSONB NOT NULL,
  CONSTRAINT "AssessmentHumanRequestDependency_pkey" PRIMARY KEY ("requestId", "assessmentRuleId")
);
CREATE INDEX "AssessmentHumanRequestDependency_assessmentId_assessmentRuleId_idx"
  ON "AssessmentHumanRequestDependency"("assessmentId", "assessmentRuleId");
ALTER TABLE "AssessmentHumanRequestDependency"
  ADD CONSTRAINT "AssessmentHumanRequestDependency_requestId_assessmentId_fkey"
  FOREIGN KEY ("requestId", "assessmentId") REFERENCES "AssessmentHumanRequest"("requestId", "assessmentId")
  ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "AssessmentHumanRequestDependency"
  ADD CONSTRAINT "AssessmentHumanRequestDependency_assessmentId_assessmentRuleId_fkey"
  FOREIGN KEY ("assessmentId", "assessmentRuleId") REFERENCES "AssessmentDecisionCoverage"("assessmentId", "assessmentRuleId")
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- Preserve every existing question's original rule dependency.
INSERT INTO "AssessmentHumanRequestDependency" ("requestId", "assessmentId", "assessmentRuleId", "criterionIds")
SELECT "requestId", "assessmentId", "assessmentRuleId", "criterionIds" FROM "AssessmentHumanRequest";

CREATE TABLE "AssessmentHumanRequestRegistration" (
  "assessmentId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestId" UUID NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "caseRevision" INTEGER NOT NULL,
  "requestRevision" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentHumanRequestRegistration_pkey" PRIMARY KEY ("assessmentId", "idempotencyKey")
);
CREATE INDEX "AssessmentHumanRequestRegistration_requestId_idx"
  ON "AssessmentHumanRequestRegistration"("requestId");
ALTER TABLE "AssessmentHumanRequestRegistration"
  ADD CONSTRAINT "AssessmentHumanRequestRegistration_requestId_assessmentId_fkey"
  FOREIGN KEY ("requestId", "assessmentId") REFERENCES "AssessmentHumanRequest"("requestId", "assessmentId")
  ON DELETE CASCADE ON UPDATE RESTRICT;
