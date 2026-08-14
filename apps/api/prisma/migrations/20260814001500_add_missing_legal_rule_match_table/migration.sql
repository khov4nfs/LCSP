DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'LegalRuleMatchGuardrailStatus'
  ) THEN
    CREATE TYPE "LegalRuleMatchGuardrailStatus" AS ENUM (
      'PASSED',
      'BLOCKED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'OverallCoverageStatus'
  ) THEN
    CREATE TYPE "OverallCoverageStatus" AS ENUM (
      'NO_CITATION',
      'PARTIAL_CITATION',
      'COMPLETE_CITATION'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "LegalRuleMatch" (
  "id" TEXT NOT NULL,
  "verifiedProfileId" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "corpusVersionId" TEXT NOT NULL,
  "legalRuleCatalogVersionId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "matches" JSONB NOT NULL,
  "citationAllowlist" JSONB NOT NULL,
  "overallCoverageStatus" "OverallCoverageStatus" NOT NULL DEFAULT 'NO_CITATION',
  "guardrailStatus" "LegalRuleMatchGuardrailStatus" NOT NULL DEFAULT 'PASSED',
  "blockedReason" TEXT,
  "status" "EvidenceAcceptanceStatus" NOT NULL DEFAULT 'ACCEPTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LegalRuleMatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LegalRuleMatch_assessmentId_idx"
ON "LegalRuleMatch"("assessmentId");
