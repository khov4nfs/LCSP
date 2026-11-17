-- Additive dependency ledger for selective decision invalidation.
-- Existing decisions remain historical and deliberately incomplete: no JSON decision packet is
-- reinterpreted or backfilled. Callers must fail closed for dependencyGraphComplete = false.
ALTER TABLE "AssessmentRuleDecision"
  ADD COLUMN "dependencyGraphComplete" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AssessmentDecisionEvidenceDependency" (
  "assessmentId" TEXT NOT NULL,
  "decisionId" UUID NOT NULL,
  "evidenceId" UUID NOT NULL,

  CONSTRAINT "AssessmentDecisionEvidenceDependency_pkey"
    PRIMARY KEY ("decisionId", "evidenceId")
);

CREATE TABLE "AssessmentDecisionFactDependency" (
  "assessmentId" TEXT NOT NULL,
  "decisionId" UUID NOT NULL,
  "factId" UUID NOT NULL,

  CONSTRAINT "AssessmentDecisionFactDependency_pkey"
    PRIMARY KEY ("decisionId", "factId")
);

CREATE INDEX "AssessmentDecisionEvidenceDependency_assessmentId_evidenceId_idx"
  ON "AssessmentDecisionEvidenceDependency"("assessmentId", "evidenceId");

CREATE INDEX "AssessmentDecisionFactDependency_assessmentId_factId_idx"
  ON "AssessmentDecisionFactDependency"("assessmentId", "factId");

ALTER TABLE "AssessmentDecisionEvidenceDependency"
  ADD CONSTRAINT "AssessmentDecisionEvidenceDependency_decision_fkey"
  FOREIGN KEY ("decisionId", "assessmentId")
  REFERENCES "AssessmentRuleDecision"("decisionId", "assessmentId")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "AssessmentDecisionEvidenceDependency"
  ADD CONSTRAINT "AssessmentDecisionEvidenceDependency_evidence_fkey"
  FOREIGN KEY ("evidenceId", "assessmentId")
  REFERENCES "AssessmentEvidence"("evidenceId", "assessmentId")
  ON DELETE NO ACTION ON UPDATE RESTRICT;

ALTER TABLE "AssessmentDecisionFactDependency"
  ADD CONSTRAINT "AssessmentDecisionFactDependency_decision_fkey"
  FOREIGN KEY ("decisionId", "assessmentId")
  REFERENCES "AssessmentRuleDecision"("decisionId", "assessmentId")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "AssessmentDecisionFactDependency"
  ADD CONSTRAINT "AssessmentDecisionFactDependency_fact_fkey"
  FOREIGN KEY ("factId", "assessmentId")
  REFERENCES "AssessmentCaseFact"("factId", "assessmentId")
  ON DELETE NO ACTION ON UPDATE RESTRICT;

CREATE FUNCTION lcsp_assessment_decision_dependency_completeness_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."dependencyGraphComplete" IS DISTINCT FROM NEW."dependencyGraphComplete" THEN
    RAISE EXCEPTION 'decision dependency completeness is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "AssessmentRuleDecision_dependency_completeness_guard"
  BEFORE UPDATE ON "AssessmentRuleDecision"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_decision_dependency_completeness_guard();
