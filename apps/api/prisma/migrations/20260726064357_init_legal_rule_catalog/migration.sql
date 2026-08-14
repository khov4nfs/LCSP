-- CreateTable
CREATE TABLE "TechnicalProfile" (
    "id" TEXT NOT NULL,
    "evidenceReportId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "providerVersion" TEXT NOT NULL,
    "profileData" JSONB NOT NULL,
    "privacyFlags" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsageFlow" (
    "id" TEXT NOT NULL,
    "technicalProfileId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "providerVersion" TEXT NOT NULL,
    "claims" JSONB NOT NULL,
    "unknownUsages" JSONB NOT NULL,
    "privacyFlags" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictRecord" (
    "id" TEXT NOT NULL,
    "aiUsageFlowId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conflictType" TEXT NOT NULL,
    "conflictScore" DOUBLE PRECISION NOT NULL,
    "scoreExplanation" TEXT NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalRuleCatalogVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "ruleRefs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "LegalRuleCatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalCorpusVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceManifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "LegalCorpusVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalSourceDocument" (
    "id" TEXT NOT NULL,
    "legalCorpusVersionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "sourceEffectStatus" TEXT NOT NULL,
    "snapshotPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalSourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocumentChunk" (
    "id" TEXT NOT NULL,
    "legalCorpusVersionId" TEXT NOT NULL,
    "legalSourceDocumentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "hierarchy" JSONB NOT NULL,
    "legalStatus" TEXT NOT NULL,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorpusApprovalRecord" (
    "id" TEXT NOT NULL,
    "legalCorpusVersionId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scopeDescription" TEXT NOT NULL,
    "comments" TEXT,
    "approvalDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorpusApprovalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalRule" (
    "id" TEXT NOT NULL,
    "legalRuleId" TEXT NOT NULL,
    "legalRuleCatalogVersionId" TEXT NOT NULL,
    "ruleFamily" TEXT NOT NULL,
    "requiredFacts" JSONB NOT NULL,
    "optionalFacts" JSONB,
    "blockingFacts" JSONB,
    "unknownFactPolicy" TEXT NOT NULL,
    "citationLocatorRefs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "authoredBy" TEXT NOT NULL,

    CONSTRAINT "LegalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleApprovalRecord" (
    "id" TEXT NOT NULL,
    "legalRuleCatalogVersionId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scopeDescription" TEXT NOT NULL,
    "comments" TEXT,
    "approvalDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleApprovalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalProfile_evidenceReportId_key" ON "TechnicalProfile"("evidenceReportId");

-- CreateIndex
CREATE INDEX "TechnicalProfile_assessmentId_idx" ON "TechnicalProfile"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AIUsageFlow_technicalProfileId_key" ON "AIUsageFlow"("technicalProfileId");

-- CreateIndex
CREATE INDEX "AIUsageFlow_assessmentId_idx" ON "AIUsageFlow"("assessmentId");

-- CreateIndex
CREATE INDEX "ConflictRecord_assessmentId_status_idx" ON "ConflictRecord"("assessmentId", "status");

-- CreateIndex
CREATE INDEX "LegalRuleCatalogVersion_status_idx" ON "LegalRuleCatalogVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LegalCorpusVersion_version_key" ON "LegalCorpusVersion"("version");

-- CreateIndex
CREATE INDEX "LegalCorpusVersion_status_createdAt_idx" ON "LegalCorpusVersion"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalSourceDocument_legalCorpusVersionId_documentId_key" ON "LegalSourceDocument"("legalCorpusVersionId", "documentId");

-- CreateIndex
CREATE INDEX "LegalSourceDocument_documentId_idx" ON "LegalSourceDocument"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocumentChunk_legalCorpusVersionId_documentId_locator_key" ON "LegalDocumentChunk"("legalCorpusVersionId", "documentId", "locator");

-- CreateIndex
CREATE INDEX "LegalDocumentChunk_legalCorpusVersionId_documentId_idx" ON "LegalDocumentChunk"("legalCorpusVersionId", "documentId");

-- CreateIndex
CREATE INDEX "LegalDocumentChunk_legalCorpusVersionId_legalStatus_idx" ON "LegalDocumentChunk"("legalCorpusVersionId", "legalStatus");

-- CreateIndex
CREATE INDEX "CorpusApprovalRecord_legalCorpusVersionId_idx" ON "CorpusApprovalRecord"("legalCorpusVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalRule_legalRuleId_key" ON "LegalRule"("legalRuleId");

-- CreateIndex
CREATE INDEX "LegalRule_legalRuleCatalogVersionId_idx" ON "LegalRule"("legalRuleCatalogVersionId");

-- CreateIndex
CREATE INDEX "RuleApprovalRecord_legalRuleCatalogVersionId_idx" ON "RuleApprovalRecord"("legalRuleCatalogVersionId");

-- AddForeignKey
ALTER TABLE "LegalSourceDocument" ADD CONSTRAINT "LegalSourceDocument_legalCorpusVersionId_fkey" FOREIGN KEY ("legalCorpusVersionId") REFERENCES "LegalCorpusVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocumentChunk" ADD CONSTRAINT "LegalDocumentChunk_legalCorpusVersionId_fkey" FOREIGN KEY ("legalCorpusVersionId") REFERENCES "LegalCorpusVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocumentChunk" ADD CONSTRAINT "LegalDocumentChunk_legalSourceDocumentId_fkey" FOREIGN KEY ("legalSourceDocumentId") REFERENCES "LegalSourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorpusApprovalRecord" ADD CONSTRAINT "CorpusApprovalRecord_legalCorpusVersionId_fkey" FOREIGN KEY ("legalCorpusVersionId") REFERENCES "LegalCorpusVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "DocumentRequest_assessmentId_organizationId_documentType_status" RENAME TO "DocumentRequest_assessmentId_organizationId_documentType_st_idx";
