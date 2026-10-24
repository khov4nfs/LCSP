-- A generation is required even when MFA is disabled: a late session
-- writer must not restore sensitive-action proof from an older enrollment.
ALTER TABLE "User"
  ADD COLUMN "mfaGenerationId" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- Preserve proofs for the currently active generation on migration, including
-- existing recovery codes, while binding all future writes to this generation.
UPDATE "AuthRecord" AS record
SET "metadata" = COALESCE(record."metadata", '{}'::jsonb)
    || jsonb_build_object('mfaGenerationId', owner."mfaGenerationId")
FROM "User" AS owner
WHERE record."userId" = owner."id"
  AND record."type" IN ('SESSION'::"AuthRecordType", 'MFA_RECOVERY_CODE'::"AuthRecordType");
