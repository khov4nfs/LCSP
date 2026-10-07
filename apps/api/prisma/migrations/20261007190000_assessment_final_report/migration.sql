ALTER TABLE "AssessmentArtifact"
ADD COLUMN "reportRequestDigest" TEXT;

-- Keep the Root request identity immutable with the rest of a published artifact.
CREATE OR REPLACE FUNCTION lcsp_assessment_artifact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."lifecycleState" <> 'BUILDING' THEN
      RAISE EXCEPTION 'artifacts start BUILDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."lifecycleState" <> NEW."lifecycleState" AND NOT (
       (OLD."lifecycleState" = 'BUILDING' AND NEW."lifecycleState" IN ('ACTIVE', 'INVALID'))
    OR (OLD."lifecycleState" = 'ACTIVE' AND NEW."lifecycleState" IN ('SUPERSEDED', 'INVALID'))
    OR (OLD."lifecycleState" = 'SUPERSEDED' AND NEW."lifecycleState" IN ('ACTIVE', 'INVALID'))
  ) THEN
    RAISE EXCEPTION 'illegal artifact lifecycle transition % -> %', OLD."lifecycleState", NEW."lifecycleState" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."lifecycleState" <> 'BUILDING' AND
     (OLD."legalPortfolioVersionId", OLD."repositorySnapshotId", OLD."repositoryCommit", OLD."caseRevision", OLD."schemaVersion",
      OLD."contentSha256", OLD."sizeBytes", OLD."storageRef", OLD."kind", OLD."reportRequestDigest")
     IS DISTINCT FROM
     (NEW."legalPortfolioVersionId", NEW."repositorySnapshotId", NEW."repositoryCommit", NEW."caseRevision", NEW."schemaVersion",
      NEW."contentSha256", NEW."sizeBytes", NEW."storageRef", NEW."kind", NEW."reportRequestDigest") THEN
    RAISE EXCEPTION 'a published artifact is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE UNIQUE INDEX "AssessmentArtifact_assessmentId_kind_key"
ON "AssessmentArtifact"("assessmentId", "kind");
