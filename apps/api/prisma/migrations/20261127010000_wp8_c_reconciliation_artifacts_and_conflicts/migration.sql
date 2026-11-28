-- AlterTable
ALTER TABLE "BillingReconciliationCase"
  ADD COLUMN "conflictingPayload" JSONB,
  ADD COLUMN "conflictDetectedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "ProviderLogArtifact" (
  "id" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'PROVIDER_EXPORT_VERIFIED',
  "providerSignature" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "coverageStart" TIMESTAMPTZ(3) NOT NULL,
  "coverageEnd" TIMESTAMPTZ(3) NOT NULL,
  "rawContent" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "ingestedBy" TEXT NOT NULL DEFAULT 'system',
  "ingestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderLogArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderLogArtifact_artifactId_key" ON "ProviderLogArtifact"("artifactId");

-- CreateIndex
CREATE INDEX "ProviderLogArtifact_provider_coverageStart_coverageEnd_idx" ON "ProviderLogArtifact"("provider", "coverageStart", "coverageEnd");

-- CreateIndex
CREATE INDEX "ProviderLogArtifact_sha256_idx" ON "ProviderLogArtifact"("sha256");
