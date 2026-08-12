-- CreateEnum
CREATE TYPE "ClassificationReviewRequestStatus" AS ENUM ('PENDING_INDEPENDENT_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'CLASSIFICATION_REVIEW_REQUEST';

-- AlterEnum
ALTER TYPE "OutboxAggregateType" ADD VALUE IF NOT EXISTS 'CLASSIFICATION_REVIEW_REQUEST';

-- CreateTable
CREATE TABLE "ClassificationReviewRequest" (
    "id" TEXT NOT NULL,
    "legalRuleMatchId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proposalGateRef" TEXT NOT NULL,
    "baselineRef" TEXT NOT NULL,
    "candidateLabel" TEXT NOT NULL,
    "citationRefs" JSONB NOT NULL,
    "requestedById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ClassificationReviewRequestStatus" NOT NULL DEFAULT 'PENDING_INDEPENDENT_REVIEW',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassificationReviewRequest_assessmentId_status_idx" ON "ClassificationReviewRequest"("assessmentId", "status");

-- CreateIndex
CREATE INDEX "ClassificationReviewRequest_legalRuleMatchId_idx" ON "ClassificationReviewRequest"("legalRuleMatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassificationReviewRequest_organizationId_idempotencyKey_key" ON "ClassificationReviewRequest"("organizationId", "idempotencyKey");
