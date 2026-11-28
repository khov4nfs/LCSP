-- CreateEnum
CREATE TYPE "BillingReconciliationState" AS ENUM (
  'OPEN',
  'EVIDENCE_PENDING',
  'INTEGRITY_REVIEW',
  'SETTLED_WITH_USAGE',
  'CONFIRMED_NO_USAGE',
  'ESCALATED',
  'CLOSED'
);

-- CreateTable
CREATE TABLE "BillingReconciliationCase" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "invocationId" TEXT NOT NULL,
  "admissionId" TEXT NOT NULL,
  "state" "BillingReconciliationState" NOT NULL DEFAULT 'OPEN',
  "provider" TEXT NOT NULL,
  "providerCorrelationId" TEXT NOT NULL,
  "providerLogArtifactId" TEXT,
  "providerLogArchiveSha256" TEXT,
  "coverageStart" TIMESTAMPTZ(3),
  "coverageEnd" TIMESTAMPTZ(3),
  "resolvedAt" TIMESTAMPTZ(3),
  "resolvedBy" TEXT,
  "auditRationale" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "BillingReconciliationCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingReconciliationCase_caseId_key" ON "BillingReconciliationCase"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingReconciliationCase_invocationId_key" ON "BillingReconciliationCase"("invocationId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingReconciliationCase_admissionId_key" ON "BillingReconciliationCase"("admissionId");

-- CreateIndex
CREATE INDEX "BillingReconciliationCase_state_idx" ON "BillingReconciliationCase"("state");

-- CreateIndex
CREATE INDEX "BillingReconciliationCase_admissionId_idx" ON "BillingReconciliationCase"("admissionId");

-- AddForeignKey
ALTER TABLE "BillingReconciliationCase" ADD CONSTRAINT "BillingReconciliationCase_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "BillableInvocationAdmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
