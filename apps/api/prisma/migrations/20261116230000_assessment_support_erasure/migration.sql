BEGIN;
-- Owned assessment cascades remove both ends of these same-case support edges.
-- Check at commit so trigger ordering cannot reject a complete erasure; independent
-- deletion of referenced evidence/facts/requests still fails if any edge survives.
ALTER TABLE "AssessmentDecisionEvidenceDependency" ALTER CONSTRAINT "AssessmentDecisionEvidenceDependency_evidence_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AssessmentDecisionFactDependency" ALTER CONSTRAINT "AssessmentDecisionFactDependency_fact_fkey" DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "AssessmentFactNeed" DROP CONSTRAINT "AssessmentFactNeed_resolvedFactId_assessmentId_fkey";
ALTER TABLE "AssessmentFactNeed" ADD CONSTRAINT "AssessmentFactNeed_resolvedFactId_assessmentId_fkey"
  FOREIGN KEY ("resolvedFactId", "assessmentId") REFERENCES "AssessmentCaseFact"("factId", "assessmentId") ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AssessmentHumanRequest" DROP CONSTRAINT "AssessmentHumanRequest_factNeedId_assessmentId_fkey";
ALTER TABLE "AssessmentHumanRequest" ADD CONSTRAINT "AssessmentHumanRequest_factNeedId_assessmentId_fkey"
  FOREIGN KEY ("factNeedId", "assessmentId") REFERENCES "AssessmentFactNeed"("factNeedId", "assessmentId") ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "AssessmentHumanFactProposal" DROP CONSTRAINT "AssessmentHumanFactProposal_requestId_assessmentId_fkey";
ALTER TABLE "AssessmentHumanFactProposal" ADD CONSTRAINT "AssessmentHumanFactProposal_requestId_assessmentId_fkey"
  FOREIGN KEY ("requestId", "assessmentId") REFERENCES "AssessmentHumanRequest"("requestId", "assessmentId") ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AssessmentHumanFactProposal" DROP CONSTRAINT "AssessmentHumanFactProposal_factNeedId_assessmentId_fkey";
ALTER TABLE "AssessmentHumanFactProposal" ADD CONSTRAINT "AssessmentHumanFactProposal_factNeedId_assessmentId_fkey"
  FOREIGN KEY ("factNeedId", "assessmentId") REFERENCES "AssessmentFactNeed"("factNeedId", "assessmentId") ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AssessmentHumanFactProposal" DROP CONSTRAINT "AssessmentHumanFactProposal_acceptedEvidenceId_assessmentId_fkey";
ALTER TABLE "AssessmentHumanFactProposal" ADD CONSTRAINT "AssessmentHumanFactProposal_acceptedEvidenceId_assessmentId_fkey"
  FOREIGN KEY ("acceptedEvidenceId", "assessmentId") REFERENCES "AssessmentEvidence"("evidenceId", "assessmentId") ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AssessmentHumanFactProposal" DROP CONSTRAINT "AssessmentHumanFactProposal_acceptedFactId_assessmentId_fkey";
ALTER TABLE "AssessmentHumanFactProposal" ADD CONSTRAINT "AssessmentHumanFactProposal_acceptedFactId_assessmentId_fkey"
  FOREIGN KEY ("acceptedFactId", "assessmentId") REFERENCES "AssessmentCaseFact"("factId", "assessmentId") ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
COMMIT;
