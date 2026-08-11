ALTER TABLE "TargetedReanalysisRequest"
ADD COLUMN "scanJobId" TEXT;

UPDATE "TargetedReanalysisRequest"
SET "scanJobId" = "id"
WHERE "scanJobId" IS NULL;

ALTER TABLE "TargetedReanalysisRequest"
ALTER COLUMN "scanJobId" SET NOT NULL;

CREATE UNIQUE INDEX "TargetedReanalysisRequest_scanJobId_key"
ON "TargetedReanalysisRequest"("scanJobId");
