CREATE TYPE "RuleCatalogGroupId" AS ENUM ('ARCHITECTURE_SAFETY_BY_DESIGN','DATA_MODEL_LIFECYCLE','CYBERSECURITY_TECHNICAL_CONTROLS','TESTING_CHANGE_ASSURANCE','USER_FACING_TRANSPARENCY','HUMAN_OVERSIGHT_INTERVENTION');
CREATE TYPE "RuleCatalogReviewState" AS ENUM ('DRAFT','APPROVED','REVIEW_REQUIRED');
CREATE TABLE "RuleCatalogGroupMembership" (
 "id" TEXT PRIMARY KEY, "ruleSetVersionId" TEXT NOT NULL, "assessmentRuleId" TEXT NOT NULL,
 "assessmentRuleVersion" TEXT NOT NULL, "groupId" "RuleCatalogGroupId" NOT NULL,
 "taxonomyVersion" TEXT NOT NULL, "nameEn" TEXT NOT NULL, "nameVi" TEXT NOT NULL,
 "descriptionEn" TEXT NOT NULL, "descriptionVi" TEXT NOT NULL, "rationaleEn" TEXT NOT NULL,
 "rationaleVi" TEXT NOT NULL, "actor" TEXT NOT NULL, "lifecycleStage" TEXT NOT NULL,
 "sourceReferences" JSONB NOT NULL, "ordinal" INTEGER NOT NULL CHECK ("ordinal">=0),
 "state" "RuleCatalogReviewState" NOT NULL DEFAULT 'DRAFT', "submittedBy" TEXT NOT NULL,
 "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("ruleSetVersionId","assessmentRuleId"),
 FOREIGN KEY ("ruleSetVersionId","assessmentRuleId") REFERENCES "AssessmentRule"("ruleSetVersionId","assessmentRuleId") ON DELETE RESTRICT,
 CHECK ("state" <> 'APPROVED' OR ("approvedBy" IS NOT NULL AND "approvedBy"<>"submittedBy" AND "approvedAt" IS NOT NULL))
);
CREATE INDEX ON "RuleCatalogGroupMembership" ("ruleSetVersionId","state","groupId","ordinal");
