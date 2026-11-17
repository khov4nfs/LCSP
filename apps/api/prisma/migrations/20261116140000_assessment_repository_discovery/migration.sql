CREATE TYPE "RepositoryScannerVersion" AS ENUM ('LCSP_PRE_SCAN_V1');
CREATE TYPE "RepositoryDiscoveryVersion" AS ENUM ('LCSP_DISCOVERY_V1');

CREATE TABLE "AssessmentRepositoryDiscovery" (
  "recordId" UUID NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "repositorySnapshotId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "repositoryCommit" TEXT NOT NULL,
  "sourcePathPrefix" TEXT,
  "scannerVersion" "RepositoryScannerVersion" NOT NULL,
  "discoveryVersion" "RepositoryDiscoveryVersion" NOT NULL,
  "scannerSignature" TEXT NOT NULL,
  "graphIndexVersion" TEXT NOT NULL,
  "cacheIdentity" TEXT NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentRepositoryDiscovery_pkey" PRIMARY KEY ("recordId"),
  CONSTRAINT "AssessmentRepositoryDiscovery_repositoryCommit_check"
    CHECK ("repositoryCommit" ~ '^[a-f0-9]{40}$|^[a-f0-9]{64}$'),
  CONSTRAINT "AssessmentRepositoryDiscovery_scannerSignature_check"
    CHECK ("scannerSignature" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "AssessmentRepositoryDiscovery_cacheIdentity_check"
    CHECK ("cacheIdentity" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "AssessmentRepositoryDiscovery_contentDigest_check"
    CHECK ("contentDigest" ~ '^sha256:[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "AssessmentRepositoryDiscovery_assessmentId_cacheIdentity_contentDigest_key"
  ON "AssessmentRepositoryDiscovery"("assessmentId", "cacheIdentity", "contentDigest");
CREATE INDEX "AssessmentRepositoryDiscovery_assessmentId_repositorySnapshotId_createdAt_idx"
  ON "AssessmentRepositoryDiscovery"("assessmentId", "repositorySnapshotId", "createdAt" DESC);

ALTER TABLE "AssessmentRepositoryDiscovery"
  ADD CONSTRAINT "AssessmentRepositoryDiscovery_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE FUNCTION lcsp_assessment_repository_discovery_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'assessment repository discovery records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AssessmentRepositoryDiscovery_immutable_guard"
  BEFORE UPDATE ON "AssessmentRepositoryDiscovery"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_repository_discovery_immutable();
