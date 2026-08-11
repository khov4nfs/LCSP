CREATE TABLE "LegalSourceSnapshot" (
  "id" TEXT NOT NULL,
  "snapshotRef" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "catalogSourceRef" TEXT NOT NULL,
  "adminCatalogVersion" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentNumber" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "contentType" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "snapshotObjectKey" TEXT NOT NULL,
  "provenanceRef" TEXT NOT NULL,
  "retrievedAt" TIMESTAMP(3) NOT NULL,
  "sourceEffectStatus" TEXT,
  "normalizationSource" TEXT,
  "identityVerified" BOOLEAN NOT NULL DEFAULT false,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LegalSourceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalSourceSnapshot_snapshotRef_key" ON "LegalSourceSnapshot"("snapshotRef");
CREATE UNIQUE INDEX "LegalSourceSnapshot_snapshotId_key" ON "LegalSourceSnapshot"("snapshotId");
CREATE INDEX "LegalSourceSnapshot_catalogSourceRef_createdAt_idx" ON "LegalSourceSnapshot"("catalogSourceRef", "createdAt");
CREATE INDEX "LegalSourceSnapshot_documentId_createdAt_idx" ON "LegalSourceSnapshot"("documentId", "createdAt");
CREATE INDEX "LegalSourceSnapshot_contentSha256_idx" ON "LegalSourceSnapshot"("contentSha256");
