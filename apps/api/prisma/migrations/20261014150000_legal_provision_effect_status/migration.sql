CREATE TYPE "LegalEffectStatus" AS ENUM ('EFFECTIVE', 'REPEALED', 'FUTURE', 'UNKNOWN');

ALTER TABLE "LegalDocumentChunk"
  ADD COLUMN "legalEffectStatus" "LegalEffectStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "legalStatusSourceRef" TEXT;

ALTER TABLE "LegalRequirementProvenance"
  ADD COLUMN "legalEffectStatus" "LegalEffectStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "legalStatusSourceRef" TEXT;
