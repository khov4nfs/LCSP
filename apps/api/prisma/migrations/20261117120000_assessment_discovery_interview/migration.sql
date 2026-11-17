CREATE TYPE "AssessmentDiscoveryInterviewProposalStatus" AS ENUM ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED');

CREATE TABLE "AssessmentDiscoveryInterviewProposal" (
  "proposalId" UUID NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "discoveryRunId" UUID NOT NULL,
  "factNeedId" UUID NOT NULL,
  "idempotencyKey" UUID NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "useCaseId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "status" "AssessmentDiscoveryInterviewProposalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "guardFailure" TEXT,
  "submittedBy" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "acceptedFactId" UUID,
  "acceptedEvidenceId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMPTZ(3),
  CONSTRAINT "AssessmentDiscoveryInterviewProposal_pkey" PRIMARY KEY ("proposalId")
);

CREATE UNIQUE INDEX "ADIP_assessment_idempotency_key"
ON "AssessmentDiscoveryInterviewProposal"("assessmentId", "idempotencyKey");

CREATE INDEX "ADIP_assessment_run_status_idx"
ON "AssessmentDiscoveryInterviewProposal"("assessmentId", "discoveryRunId", "status");

CREATE INDEX "ADIP_assessment_need_status_idx"
ON "AssessmentDiscoveryInterviewProposal"("assessmentId", "factNeedId", "status");

ALTER TABLE "AssessmentDiscoveryInterviewProposal"
ADD CONSTRAINT "ADIP_assessment_fkey"
FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId")
ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "AssessmentDiscoveryInterviewProposal"
ADD CONSTRAINT "ADIP_run_fkey"
FOREIGN KEY ("discoveryRunId") REFERENCES "AssessmentDiscoveryRun"("runId")
ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "AssessmentDiscoveryInterviewProposal"
ADD CONSTRAINT "ADIP_need_assessment_fkey"
FOREIGN KEY ("factNeedId", "assessmentId") REFERENCES "AssessmentFactNeed"("factNeedId", "assessmentId")
ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AssessmentDiscoveryInterviewProposal"
ADD CONSTRAINT "ADIP_evidence_assessment_fkey"
FOREIGN KEY ("acceptedEvidenceId", "assessmentId") REFERENCES "AssessmentEvidence"("evidenceId", "assessmentId")
ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "AssessmentDiscoveryInterviewProposal"
ADD CONSTRAINT "ADIP_fact_assessment_fkey"
FOREIGN KEY ("acceptedFactId", "assessmentId") REFERENCES "AssessmentCaseFact"("factId", "assessmentId")
ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "AssessmentDiscoveryInterviewProposal"
ADD CONSTRAINT "AssessmentDiscoveryInterviewProposal_content_shape_check"
CHECK (
  length(btrim("question")) BETWEEN 1 AND 1000
  AND length(btrim("answer")) BETWEEN 1 AND 2000
  AND "requestDigest" ~ '^[a-f0-9]{64}$'
  AND "useCaseId" ~ '^sha256:[a-f0-9]{64}$'
);

ALTER TABLE "AssessmentDiscoveryInterviewProposal"
ADD CONSTRAINT "AssessmentDiscoveryInterviewProposal_resolution_shape_check"
CHECK (
  (
    "status" = 'PENDING_REVIEW'
    AND "reviewedBy" IS NULL
    AND "reviewedAt" IS NULL
    AND "acceptedFactId" IS NULL
    AND "acceptedEvidenceId" IS NULL
  )
  OR (
    "status" = 'REJECTED'
    AND "reviewedBy" IS NOT NULL
    AND "reviewedAt" IS NOT NULL
    AND "acceptedFactId" IS NULL
    AND "acceptedEvidenceId" IS NULL
  )
  OR (
    "status" = 'ACCEPTED'
    AND "reviewedBy" IS NOT NULL
    AND "reviewedAt" IS NOT NULL
    AND "guardFailure" IS NULL
    AND "acceptedFactId" IS NOT NULL
    AND "acceptedEvidenceId" IS NOT NULL
  )
);

-- No change to proposal source, answer, actor, or provenance is allowed after insertion.
-- The only permissible mutation is one explicit pending -> accepted/rejected review.
CREATE FUNCTION lcsp_discovery_interview_proposal_review_only() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PENDING_REVIEW'
     OR NEW."status" NOT IN ('ACCEPTED', 'REJECTED')
     OR NEW."proposalId" IS DISTINCT FROM OLD."proposalId"
     OR NEW."assessmentId" IS DISTINCT FROM OLD."assessmentId"
     OR NEW."discoveryRunId" IS DISTINCT FROM OLD."discoveryRunId"
     OR NEW."factNeedId" IS DISTINCT FROM OLD."factNeedId"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."requestDigest" IS DISTINCT FROM OLD."requestDigest"
     OR NEW."useCaseId" IS DISTINCT FROM OLD."useCaseId"
     OR NEW."question" IS DISTINCT FROM OLD."question"
     OR NEW."answer" IS DISTINCT FROM OLD."answer"
     OR NEW."guardFailure" IS DISTINCT FROM OLD."guardFailure"
     OR NEW."submittedBy" IS DISTINCT FROM OLD."submittedBy"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'discovery interview proposal source or resolution is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AssessmentDiscoveryInterviewProposal_review_only_guard"
BEFORE UPDATE ON "AssessmentDiscoveryInterviewProposal"
FOR EACH ROW EXECUTE FUNCTION lcsp_discovery_interview_proposal_review_only();