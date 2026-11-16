CREATE TYPE "AssessmentHumanFactProposalStatus" AS ENUM (
  'PENDING_REVIEW',
  'ACCEPTED'
);

CREATE TYPE "AssessmentHumanFactProposalGuardFailure" AS ENUM (
  'UNKNOWN_ANSWER_MUST_USE_DOES_NOT_KNOW',
  'AMBIGUOUS_HUMAN_ANSWER',
  'CONTRADICTS_PRIOR_HUMAN_FACT'
);

CREATE TABLE "AssessmentHumanFactProposal" (
  "proposalId" UUID NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "requestId" UUID NOT NULL,
  "factNeedId" UUID,
  "caseRevision" INTEGER NOT NULL,
  "requestRevision" INTEGER NOT NULL,
  "checkpointId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "rawAnswer" JSONB NOT NULL,
  "normalizedAnswer" JSONB,
  "status" "AssessmentHumanFactProposalStatus" NOT NULL,
  "guardFailure" "AssessmentHumanFactProposalGuardFailure",
  "acceptedEvidenceId" UUID,
  "acceptedFactId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentHumanFactProposal_pkey" PRIMARY KEY ("proposalId"),
  CONSTRAINT "AssessmentHumanFactProposal_caseRevision_check"
    CHECK ("caseRevision" >= 0),
  CONSTRAINT "AssessmentHumanFactProposal_requestRevision_check"
    CHECK ("requestRevision" >= 1),
  CONSTRAINT "AssessmentHumanFactProposal_idempotencyKey_check"
    CHECK (length(btrim("idempotencyKey")) BETWEEN 8 AND 128),
  CONSTRAINT "AssessmentHumanFactProposal_requestDigest_check"
    CHECK ("requestDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AssessmentHumanFactProposal_actorId_check"
    CHECK (length(btrim("actorId")) >= 1),
  CONSTRAINT "AssessmentHumanFactProposal_rawAnswer_check"
    CHECK (jsonb_typeof("rawAnswer") = 'object'),
  CONSTRAINT "AssessmentHumanFactProposal_normalizedAnswer_check"
    CHECK ("normalizedAnswer" IS NULL OR jsonb_typeof("normalizedAnswer") = 'object'),
  CONSTRAINT "AssessmentHumanFactProposal_resolution_shape_check"
    CHECK (
      (
        "status" = 'PENDING_REVIEW'
        AND "guardFailure" IS NOT NULL
        AND "acceptedEvidenceId" IS NULL
        AND "acceptedFactId" IS NULL
      )
      OR
      (
        "status" = 'ACCEPTED'
        AND "guardFailure" IS NULL
        AND "acceptedEvidenceId" IS NOT NULL
        AND "acceptedFactId" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "AssessmentHumanFactProposal_proposalId_assessmentId_key"
  ON "AssessmentHumanFactProposal"("proposalId", "assessmentId");
CREATE UNIQUE INDEX "AssessmentHumanFactProposal_assessmentId_idempotencyKey_key"
  ON "AssessmentHumanFactProposal"("assessmentId", "idempotencyKey");
CREATE INDEX "AssessmentHumanFactProposal_assessmentId_requestId_createdAt_idx"
  ON "AssessmentHumanFactProposal"("assessmentId", "requestId", "createdAt" ASC);
CREATE INDEX "AssessmentHumanFactProposal_assessmentId_status_createdAt_idx"
  ON "AssessmentHumanFactProposal"("assessmentId", "status", "createdAt" ASC);

ALTER TABLE "AssessmentHumanFactProposal"
  ADD CONSTRAINT "AssessmentHumanFactProposal_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "AssessmentHumanFactProposal"
  ADD CONSTRAINT "AssessmentHumanFactProposal_requestId_assessmentId_fkey"
  FOREIGN KEY ("requestId", "assessmentId")
  REFERENCES "AssessmentHumanRequest"("requestId", "assessmentId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "AssessmentHumanFactProposal"
  ADD CONSTRAINT "AssessmentHumanFactProposal_factNeedId_assessmentId_fkey"
  FOREIGN KEY ("factNeedId", "assessmentId")
  REFERENCES "AssessmentFactNeed"("factNeedId", "assessmentId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "AssessmentHumanFactProposal"
  ADD CONSTRAINT "AssessmentHumanFactProposal_acceptedEvidenceId_assessmentId_fkey"
  FOREIGN KEY ("acceptedEvidenceId", "assessmentId")
  REFERENCES "AssessmentEvidence"("evidenceId", "assessmentId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "AssessmentHumanFactProposal"
  ADD CONSTRAINT "AssessmentHumanFactProposal_acceptedFactId_assessmentId_fkey"
  FOREIGN KEY ("acceptedFactId", "assessmentId")
  REFERENCES "AssessmentCaseFact"("factId", "assessmentId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION lcsp_assessment_human_fact_proposal_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'assessment human fact proposals are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AssessmentHumanFactProposal_immutable_guard"
  BEFORE UPDATE ON "AssessmentHumanFactProposal"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_human_fact_proposal_immutable();
