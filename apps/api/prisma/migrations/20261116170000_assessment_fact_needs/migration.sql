CREATE TYPE "AssessmentFactNeedSubjectKind" AS ENUM (
  'ORGANIZATION', 'DEPLOYMENT', 'AI_SYSTEM', 'USE_CASE', 'MODEL', 'DATASET', 'CONTROL', 'OTHER'
);
CREATE TYPE "AssessmentFactNeedEnvironment" AS ENUM (
  'PRODUCTION', 'STAGING', 'DEVELOPMENT', 'TEST', 'ALL', 'UNKNOWN'
);
CREATE TYPE "AssessmentFactNeedTimeframeKind" AS ENUM (
  'CURRENT', 'AT_TIME', 'RANGE', 'ALL_TIME'
);
CREATE TYPE "AssessmentFactNeedValueKind" AS ENUM (
  'TEXT', 'BOOLEAN', 'INTEGER', 'NUMBER', 'DATE', 'DATE_TIME', 'ENUM', 'JSON'
);
CREATE TYPE "AssessmentFactNeedStatus" AS ENUM ('OPEN', 'RESOLVED', 'SUPERSEDED');

CREATE TABLE "AssessmentFactNeed" (
  "factNeedId" UUID NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "tenantOwnerId" TEXT NOT NULL,
  "identityDigest" TEXT NOT NULL,
  "subjectKind" "AssessmentFactNeedSubjectKind" NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "predicate" TEXT NOT NULL,
  "operationalScope" TEXT NOT NULL,
  "environment" "AssessmentFactNeedEnvironment" NOT NULL,
  "deploymentKey" TEXT,
  "timeframeKind" "AssessmentFactNeedTimeframeKind" NOT NULL,
  "timeframeFrom" TIMESTAMPTZ(3),
  "timeframeTo" TIMESTAMPTZ(3),
  "valueKind" "AssessmentFactNeedValueKind" NOT NULL,
  "valueSchemaVersion" TEXT NOT NULL,
  "allowedValues" JSONB NOT NULL,
  "sourceInvestigationAttempts" JSONB NOT NULL,
  "acceptedEvidenceIds" JSONB NOT NULL,
  "investigatedRangeIds" JSONB NOT NULL,
  "status" "AssessmentFactNeedStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedFactId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  "supersededAt" TIMESTAMPTZ(3),
  CONSTRAINT "AssessmentFactNeed_pkey" PRIMARY KEY ("factNeedId"),
  CONSTRAINT "AssessmentFactNeed_identityDigest_check"
    CHECK ("identityDigest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "AssessmentFactNeed_subjectKey_nonblank_check"
    CHECK (length(btrim("subjectKey")) > 0),
  CONSTRAINT "AssessmentFactNeed_predicate_nonblank_check"
    CHECK (length(btrim("predicate")) > 0),
  CONSTRAINT "AssessmentFactNeed_scope_nonblank_check"
    CHECK (length(btrim("operationalScope")) > 0),
  CONSTRAINT "AssessmentFactNeed_json_arrays_check"
    CHECK (
      jsonb_typeof("allowedValues") = 'array' AND
      jsonb_typeof("sourceInvestigationAttempts") = 'array' AND
      jsonb_typeof("acceptedEvidenceIds") = 'array' AND
      jsonb_typeof("investigatedRangeIds") = 'array'
    ),
  CONSTRAINT "AssessmentFactNeed_timeframe_shape_check"
    CHECK (
      ("timeframeKind" IN ('CURRENT', 'ALL_TIME') AND "timeframeFrom" IS NULL AND "timeframeTo" IS NULL) OR
      ("timeframeKind" = 'AT_TIME' AND "timeframeFrom" IS NOT NULL AND "timeframeTo" IS NULL) OR
      ("timeframeKind" = 'RANGE' AND "timeframeFrom" IS NOT NULL AND "timeframeTo" IS NOT NULL AND "timeframeFrom" <= "timeframeTo")
    ),
  CONSTRAINT "AssessmentFactNeed_value_shape_check"
    CHECK (
      ("valueKind" = 'ENUM' AND jsonb_array_length("allowedValues") > 0) OR
      ("valueKind" <> 'ENUM' AND jsonb_array_length("allowedValues") = 0)
    ),
  CONSTRAINT "AssessmentFactNeed_resolution_shape_check"
    CHECK (
      ("status" = 'OPEN' AND "resolvedFactId" IS NULL AND "resolvedAt" IS NULL AND "supersededAt" IS NULL) OR
      ("status" = 'RESOLVED' AND "resolvedFactId" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "supersededAt" IS NULL) OR
      ("status" = 'SUPERSEDED' AND "resolvedFactId" IS NULL AND "resolvedAt" IS NULL AND "supersededAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "AssessmentFactNeed_factNeedId_assessmentId_key"
  ON "AssessmentFactNeed"("factNeedId", "assessmentId");
CREATE UNIQUE INDEX "AssessmentFactNeed_assessmentId_identityDigest_key"
  ON "AssessmentFactNeed"("assessmentId", "identityDigest");
CREATE INDEX "AssessmentFactNeed_assessmentId_status_idx"
  ON "AssessmentFactNeed"("assessmentId", "status");
CREATE INDEX "AssessmentFactNeed_tenantOwnerId_assessmentId_idx"
  ON "AssessmentFactNeed"("tenantOwnerId", "assessmentId");

ALTER TABLE "AssessmentFactNeed"
  ADD CONSTRAINT "AssessmentFactNeed_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId")
  ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "AssessmentFactNeed"
  ADD CONSTRAINT "AssessmentFactNeed_tenantOwnerId_fkey"
  FOREIGN KEY ("tenantOwnerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AssessmentFactNeed"
  ADD CONSTRAINT "AssessmentFactNeed_resolvedFactId_assessmentId_fkey"
  FOREIGN KEY ("resolvedFactId", "assessmentId") REFERENCES "AssessmentCaseFact"("factId", "assessmentId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "AssessmentHumanRequest" ADD COLUMN "factNeedId" UUID;
CREATE UNIQUE INDEX "AssessmentHumanRequest_factNeedId_assessmentId_key"
  ON "AssessmentHumanRequest"("factNeedId", "assessmentId");
ALTER TABLE "AssessmentHumanRequest"
  ADD CONSTRAINT "AssessmentHumanRequest_factNeedId_assessmentId_fkey"
  FOREIGN KEY ("factNeedId", "assessmentId") REFERENCES "AssessmentFactNeed"("factNeedId", "assessmentId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "guard_assessment_fact_need_identity"()
RETURNS trigger AS $$
BEGIN
  IF NEW."assessmentId" IS DISTINCT FROM OLD."assessmentId"
     OR NEW."tenantOwnerId" IS DISTINCT FROM OLD."tenantOwnerId"
     OR NEW."identityDigest" IS DISTINCT FROM OLD."identityDigest"
     OR NEW."subjectKind" IS DISTINCT FROM OLD."subjectKind"
     OR NEW."subjectKey" IS DISTINCT FROM OLD."subjectKey"
     OR NEW."predicate" IS DISTINCT FROM OLD."predicate"
     OR NEW."operationalScope" IS DISTINCT FROM OLD."operationalScope"
     OR NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."deploymentKey" IS DISTINCT FROM OLD."deploymentKey"
     OR NEW."timeframeKind" IS DISTINCT FROM OLD."timeframeKind"
     OR NEW."timeframeFrom" IS DISTINCT FROM OLD."timeframeFrom"
     OR NEW."timeframeTo" IS DISTINCT FROM OLD."timeframeTo"
     OR NEW."valueKind" IS DISTINCT FROM OLD."valueKind"
     OR NEW."valueSchemaVersion" IS DISTINCT FROM OLD."valueSchemaVersion"
     OR NEW."allowedValues" IS DISTINCT FROM OLD."allowedValues"
  THEN
    RAISE EXCEPTION 'AssessmentFactNeed semantic identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AssessmentFactNeed_identity_guard"
  BEFORE UPDATE ON "AssessmentFactNeed"
  FOR EACH ROW EXECUTE FUNCTION "guard_assessment_fact_need_identity"();
