DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'VerifiedProfileStatus'
  ) THEN
    CREATE TYPE "VerifiedProfileStatus" AS ENUM (
      'PENDING_APPROVAL',
      'APPROVED',
      'AUTO_APPROVED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ClassificationGuardrailStatus'
  ) THEN
    CREATE TYPE "ClassificationGuardrailStatus" AS ENUM (
      'PASSED',
      'DEGRADED',
      'BLOCKED'
    );
  END IF;
END $$;

ALTER TABLE "VerifiedProfile"
ADD COLUMN IF NOT EXISTS "wizardProfileId" TEXT,
ADD COLUMN IF NOT EXISTS "technicalEvidenceReportId" TEXT,
ADD COLUMN IF NOT EXISTS "reconciliationDecisionRefs" JSONB,
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'VerifiedProfile'
      AND column_name = 'status'
      AND udt_name <> 'VerifiedProfileStatus'
  ) THEN
    ALTER TABLE "VerifiedProfile"
    ALTER COLUMN "status" DROP DEFAULT;

    ALTER TABLE "VerifiedProfile"
    ALTER COLUMN "status" TYPE "VerifiedProfileStatus"
    USING (
      CASE UPPER("status"::text)
        WHEN 'PENDING_APPROVAL' THEN 'PENDING_APPROVAL'::"VerifiedProfileStatus"
        WHEN 'APPROVED' THEN 'APPROVED'::"VerifiedProfileStatus"
        WHEN 'AUTO_APPROVED' THEN 'AUTO_APPROVED'::"VerifiedProfileStatus"
        ELSE 'PENDING_APPROVAL'::"VerifiedProfileStatus"
      END
    );

    ALTER TABLE "VerifiedProfile"
    ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';
  END IF;
END $$;

ALTER TABLE "ClassificationResult"
ADD COLUMN IF NOT EXISTS "legalRuleMatchId" TEXT,
ADD COLUMN IF NOT EXISTS "verifiedProfileId" TEXT,
ADD COLUMN IF NOT EXISTS "schemaVersion" TEXT,
ADD COLUMN IF NOT EXISTS "classificationData" JSONB,
ADD COLUMN IF NOT EXISTS "blockedReason" TEXT,
ADD COLUMN IF NOT EXISTS "status" "EvidenceAcceptanceStatus" NOT NULL DEFAULT 'ACCEPTED';

ALTER TABLE "ClassificationResult"
ALTER COLUMN "technicalEvidenceReportId" DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ClassificationResult'
      AND column_name = 'guardrailStatus'
      AND udt_name <> 'ClassificationGuardrailStatus'
  ) THEN
    ALTER TABLE "ClassificationResult"
    ALTER COLUMN "guardrailStatus" DROP DEFAULT;

    ALTER TABLE "ClassificationResult"
    ALTER COLUMN "guardrailStatus" TYPE "ClassificationGuardrailStatus"
    USING (
      CASE UPPER("guardrailStatus"::text)
        WHEN 'PASSED' THEN 'PASSED'::"ClassificationGuardrailStatus"
        WHEN 'DEGRADED' THEN 'DEGRADED'::"ClassificationGuardrailStatus"
        WHEN 'BLOCKED' THEN 'BLOCKED'::"ClassificationGuardrailStatus"
        ELSE 'PASSED'::"ClassificationGuardrailStatus"
      END
    );

    ALTER TABLE "ClassificationResult"
    ALTER COLUMN "guardrailStatus" SET DEFAULT 'PASSED';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ClassificationResult_legalRuleMatchId_key"
ON "ClassificationResult"("legalRuleMatchId");

CREATE UNIQUE INDEX IF NOT EXISTS "VerifiedProfile_organizationId_idempotencyKey_key"
ON "VerifiedProfile"("organizationId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "VerifiedProfile_assessmentId_version_idx"
ON "VerifiedProfile"("assessmentId", "version");
