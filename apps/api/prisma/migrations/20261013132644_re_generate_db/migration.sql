/*
  Warnings:

  - You are about to drop the `WizardProfile` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AssessmentHumanRequest" DROP CONSTRAINT "AssessmentHumanRequest_resolved_fact_fkey";

-- Preserve this database-only composite FK: it prevents a context relation from
-- targeting a rule in a different ComplianceRuleSetVersion.

-- DropForeignKey
ALTER TABLE "WizardProfile" DROP CONSTRAINT "WizardProfile_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "WizardProfile" DROP CONSTRAINT "WizardProfile_ownerId_fkey";

-- DropIndex
DROP INDEX "SePayWebhookEvent_integrityHash_idx";

-- AlterTable
ALTER TABLE "AuditEvent" RENAME CONSTRAINT "AuthAuditEvent_pkey" TO "AuditEvent_pkey";

-- AlterTable
ALTER TABLE "AuthRecord" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" RENAME CONSTRAINT "AuthUser_pkey" TO "User_pkey";

-- DropTable
DROP TABLE "WizardProfile";

-- DropEnum
DROP TYPE "WizardProfileStatus";

-- CreateIndex
CREATE INDEX "AuditEvent_resourceId_eventType_createdAt_idx" ON "AuditEvent"("resourceId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "RepositoryConnection_userId_provider_status_idx" ON "RepositoryConnection"("userId", "provider", "status");

-- RenameIndex
ALTER INDEX "AuthAuditEvent_actorId_createdAt_idx" RENAME TO "AuditEvent_actorId_createdAt_idx";

-- RenameIndex
ALTER INDEX "AuthAuditEvent_correlationId_idx" RENAME TO "AuditEvent_correlationId_idx";

-- RenameIndex
ALTER INDEX "AuthAuditEvent_eventType_createdAt_idx" RENAME TO "AuditEvent_eventType_createdAt_idx";

-- RenameIndex
ALTER INDEX "BillingReservationInvocationClaim_reservationId_invocationId_ke" RENAME TO "BillingReservationInvocationClaim_reservationId_invocationI_key";

-- RenameIndex
ALTER INDEX "AuthUser_email_key" RENAME TO "User_email_key";
