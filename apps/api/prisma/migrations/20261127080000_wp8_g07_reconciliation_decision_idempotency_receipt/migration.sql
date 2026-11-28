-- CreateTable
CREATE TABLE "BillingReconciliationDecisionReceipt" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "auditRationale" TEXT NOT NULL,
    "providerLogArtifactId" TEXT,
    "decidedBy" TEXT NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingReconciliationDecisionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingReconciliationDecisionReceipt_idempotencyKey_key" ON "BillingReconciliationDecisionReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingReconciliationDecisionReceipt_caseId_idx" ON "BillingReconciliationDecisionReceipt"("caseId");
