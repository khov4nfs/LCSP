-- Legal effect belongs to each immutable, version-pinned provision. Keep the legacy chunk
-- lifecycle label unchanged; old provisions default to UNKNOWN rather than being promoted.
CREATE TYPE "LegalEffectStatus" AS ENUM ('EFFECTIVE', 'REPEALED', 'FUTURE', 'UNKNOWN');

ALTER TABLE "LegalDocumentChunk"
  ADD COLUMN "legalEffectStatus" "LegalEffectStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "legalStatusSourceRef" TEXT;

ALTER TABLE "LegalRequirementProvenance"
  ADD COLUMN "legalEffectStatus" "LegalEffectStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "legalStatusSourceRef" TEXT;
