/*
  Warnings:

  - You are about to drop the column `technicalEvidenceReportId` on the `ClassificationResult` table. All the data in the column will be lost.
  - The `status` column on the `DocumentRequest` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `documentType` on the `DocumentRequest` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `status` on the `ReadinessExport` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "ReadinessExportStatus" AS ENUM ('GENERATED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AuditExportStatus" AS ENUM ('QUEUED', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentRequestStatus" AS ENUM ('QUEUED', 'GENERATING', 'READY', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('FINAL_REPORT', 'GAP_ANALYSIS', 'READINESS_EXPORT');

-- DropIndex
DROP INDEX "ClassificationResult_assessmentId_organizationId_createdAt_idx";

-- DropIndex
DROP INDEX "ClassificationResult_technicalEvidenceReportId_key";

-- AlterTable
ALTER TABLE "ClassificationResult" DROP COLUMN "technicalEvidenceReportId";

-- AlterTable
ALTER TABLE "DocumentRequest" DROP COLUMN "documentType",
ADD COLUMN     "documentType" "DocumentType" NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "DocumentRequestStatus" NOT NULL DEFAULT 'QUEUED';

-- AlterTable
ALTER TABLE "ReadinessExport" DROP COLUMN "status",
ADD COLUMN     "status" "ReadinessExportStatus" NOT NULL;

-- CreateTable
CREATE TABLE "AuditExportRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "status" "AuditExportStatus" NOT NULL DEFAULT 'READY',
    "version" INTEGER NOT NULL DEFAULT 1,
    "checksumSha256" TEXT NOT NULL,
    "contentJson" JSONB,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AuditExportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditExportRequest_organizationId_createdAt_idx" ON "AuditExportRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditExportRequest_organizationId_version_idx" ON "AuditExportRequest"("organizationId", "version");

-- CreateIndex
CREATE INDEX "ClassificationResult_assessmentId_idx" ON "ClassificationResult"("assessmentId");

-- CreateIndex
CREATE INDEX "DocumentRequest_assessmentId_organizationId_documentType_st_idx" ON "DocumentRequest"("assessmentId", "organizationId", "documentType", "status", "createdAt");
