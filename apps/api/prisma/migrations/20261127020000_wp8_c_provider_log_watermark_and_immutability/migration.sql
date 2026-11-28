-- AlterTable
ALTER TABLE "ProviderLogArtifact"
  ALTER COLUMN "verified" SET DEFAULT false,
  ADD COLUMN "signingKeyId" TEXT,
  ADD COLUMN "finalizedWatermark" TIMESTAMPTZ(3);
