CREATE TYPE "RepositoryDiscoveryExpansionReason" AS ENUM (
  'MISSING_SUPPORT',
  'INCOMPLETE_CALL_CHAIN',
  'COUNTER_EVIDENCE_SEARCH',
  'UNKNOWN_RUNTIME_CONFIGURATION',
  'BOUNDED_NEGATIVE_CLAIM',
  'SCANNER_COVERAGE_GAP'
);

CREATE UNIQUE INDEX "AssessmentRepositoryDiscovery_recordId_assessmentId_key"
  ON "AssessmentRepositoryDiscovery"("recordId", "assessmentId");

CREATE TABLE "AssessmentRepositoryDiscoveryExpansion" (
  "expansionId" UUID NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "repositoryDiscoveryId" UUID NOT NULL,
  "discoveryContentDigest" TEXT NOT NULL,
  "reasonCode" "RepositoryDiscoveryExpansionReason" NOT NULL,
  "reason" TEXT NOT NULL,
  "assessmentRuleIds" JSONB NOT NULL,
  "priorityRangeIds" JSONB NOT NULL,
  "trace" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentRepositoryDiscoveryExpansion_pkey" PRIMARY KEY ("expansionId"),
  CONSTRAINT "AssessmentRepositoryDiscoveryExpansion_discoveryContentDigest_check"
    CHECK ("discoveryContentDigest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "AssessmentRepositoryDiscoveryExpansion_reason_check"
    CHECK (length(btrim("reason")) BETWEEN 1 AND 1000),
  CONSTRAINT "AssessmentRepositoryDiscoveryExpansion_assessmentRuleIds_check"
    CHECK (jsonb_typeof("assessmentRuleIds") = 'array'),
  CONSTRAINT "AssessmentRepositoryDiscoveryExpansion_priorityRangeIds_check"
    CHECK (jsonb_typeof("priorityRangeIds") = 'array'),
  CONSTRAINT "AssessmentRepositoryDiscoveryExpansion_trace_check"
    CHECK (jsonb_typeof("trace") = 'object'),
  CONSTRAINT "AssessmentRepositoryDiscoveryExpansion_idempotencyKey_check"
    CHECK ("idempotencyKey" ~ '^discovery-expansion:[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "AssessmentRepositoryDiscoveryExpansion_assessmentId_idempotencyKey_key"
  ON "AssessmentRepositoryDiscoveryExpansion"("assessmentId", "idempotencyKey");
CREATE INDEX "AssessmentRepositoryDiscoveryExpansion_assessmentId_repositoryDiscoveryId_createdAt_idx"
  ON "AssessmentRepositoryDiscoveryExpansion"("assessmentId", "repositoryDiscoveryId", "createdAt" ASC);

ALTER TABLE "AssessmentRepositoryDiscoveryExpansion"
  ADD CONSTRAINT "AssessmentRepositoryDiscoveryExpansion_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "AssessmentRepositoryDiscoveryExpansion"
  ADD CONSTRAINT "AssessmentRepositoryDiscoveryExpansion_repositoryDiscoveryId_assessmentId_fkey"
  FOREIGN KEY ("repositoryDiscoveryId", "assessmentId")
  REFERENCES "AssessmentRepositoryDiscovery"("recordId", "assessmentId")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE FUNCTION lcsp_assessment_repository_discovery_expansion_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'assessment repository discovery expansion records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AssessmentRepositoryDiscoveryExpansion_immutable_guard"
  BEFORE UPDATE ON "AssessmentRepositoryDiscoveryExpansion"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_repository_discovery_expansion_immutable();
