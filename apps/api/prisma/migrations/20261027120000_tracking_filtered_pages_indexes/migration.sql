CREATE INDEX "Assessment_ownerId_updatedAt_id_idx"
  ON "Assessment" ("ownerId", "updatedAt" DESC, "id");

CREATE INDEX "Assessment_ownerId_lifecycleState_id_idx"
  ON "Assessment" ("ownerId", "lifecycleState", "id");

CREATE INDEX "AssessmentDecisionCoverage_ruleSetVersionId_assessmentRuleId_assessmentId_idx"
  ON "AssessmentDecisionCoverage" ("ruleSetVersionId", "assessmentRuleId", "assessmentId");
