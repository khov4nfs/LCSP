-- CreateEnum
CREATE TYPE "ModelPricingScope" AS ENUM ('EXACT_MODEL', 'PROVIDER_DEFAULT', 'GLOBAL_DEFAULT');

-- CreateEnum
CREATE TYPE "CustomerTariffDraftStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "TokenBucketPolicy" AS ENUM ('SEPARATE_RATE', 'USE_OUTPUT_RATE', 'INCLUDED_IN_OUTPUT', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "ModelUsageDebitMode" AS ENUM ('OFF', 'SHADOW', 'ON');

-- CreateEnum
CREATE TYPE "AdmissionFundingPrincipal" AS ENUM ('CUSTOMER_WALLET', 'PLATFORM_SPONSORED');

-- CreateEnum
CREATE TYPE "AdmissionState" AS ENUM ('REQUESTED', 'ADMITTED', 'REJECTED', 'IN_FLIGHT', 'EXPIRED', 'REVOKED', 'DISPATCH_UNKNOWN', 'OUTCOME_UNKNOWN', 'CONFIRMED_NO_USAGE', 'SETTLED', 'BILLING_INTEGRITY_REVIEW', 'COMPENSATED');

-- CreateEnum
CREATE TYPE "ProviderCompletionState" AS ENUM ('COMPLETED', 'MAX_TOKENS', 'TRUNCATED', 'FAILED', 'OUTCOME_UNKNOWN');

-- CreateEnum
CREATE TYPE "OutputEvaluationState" AS ENUM ('ACCEPTED', 'SCHEMA_INVALID', 'DOMAIN_REJECTED', 'NOT_EVALUATED');

-- CreateEnum
CREATE TYPE "CreditLedgerSource" AS ENUM ('BILLING_ORDER_CREDIT', 'MODEL_USAGE_DEBIT', 'COMPENSATION', 'GOODWILL_CREDIT');

-- AlterTable
ALTER TABLE "BillingWallet" ADD COLUMN     "accountingUnitVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "balanceMicrocredits" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CreditLedgerEntry" ADD COLUMN     "accountingUnitVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "admissionId" TEXT,
ADD COLUMN     "deltaMicrocredits" BIGINT,
ADD COLUMN     "ledgerSource" "CreditLedgerSource",
ADD COLUMN     "originalLedgerEntryId" TEXT,
ADD COLUMN     "requestFingerprint" TEXT;

-- AlterTable
ALTER TABLE "LlmUsageEvent" ADD COLUMN     "admissionId" TEXT,
ADD COLUMN     "appliedMaxOutputTokens" INTEGER,
ADD COLUMN     "attemptOrdinal" INTEGER,
ADD COLUMN     "chargedMicrocredits" BIGINT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "finishReason" TEXT,
ADD COLUMN     "logicalOperationId" TEXT,
ADD COLUMN     "modelStep" INTEGER,
ADD COLUMN     "operationType" TEXT,
ADD COLUMN     "pricingResolution" "ModelPricingScope",
ADD COLUMN     "protocol" TEXT,
ADD COLUMN     "providerCompletionState" "ProviderCompletionState";

-- CreateTable
CREATE TABLE "CustomerModelTariffDraft" (
    "id" TEXT NOT NULL,
    "scope" "ModelPricingScope" NOT NULL,
    "provider" TEXT,
    "resolvedModel" TEXT,
    "normalizedScopeKey" TEXT NOT NULL,
    "status" "CustomerTariffDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "inputMicrocreditsPerMillion" BIGINT NOT NULL,
    "outputMicrocreditsPerMillion" BIGINT NOT NULL,
    "reasoningPolicy" "TokenBucketPolicy" NOT NULL,
    "reasoningMicrocreditsPerMillion" BIGINT,
    "cachedInputPolicy" "TokenBucketPolicy" NOT NULL DEFAULT 'UNSUPPORTED',
    "cachedInputMicrocreditsPerMillion" BIGINT,
    "cacheWritePolicy" "TokenBucketPolicy" NOT NULL DEFAULT 'UNSUPPORTED',
    "cacheWriteMicrocreditsPerMillion" BIGINT,
    "cacheWrite5mMicrocreditsPerMillion" BIGINT,
    "cacheWrite1hMicrocreditsPerMillion" BIGINT,
    "operationalAssumptions" JSONB,
    "publishedSnapshotId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerModelTariffDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerModelTariffSnapshot" (
    "id" TEXT NOT NULL,
    "sourceDraftId" TEXT,
    "scope" "ModelPricingScope" NOT NULL,
    "provider" TEXT,
    "resolvedModel" TEXT,
    "normalizedScopeKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "accountingUnitVersion" INTEGER NOT NULL DEFAULT 1,
    "inputMicrocreditsPerMillion" BIGINT NOT NULL,
    "outputMicrocreditsPerMillion" BIGINT NOT NULL,
    "reasoningPolicy" "TokenBucketPolicy" NOT NULL,
    "reasoningMicrocreditsPerMillion" BIGINT,
    "cachedInputPolicy" "TokenBucketPolicy" NOT NULL,
    "cachedInputMicrocreditsPerMillion" BIGINT,
    "cacheWritePolicy" "TokenBucketPolicy" NOT NULL,
    "cacheWriteMicrocreditsPerMillion" BIGINT,
    "cacheWrite5mMicrocreditsPerMillion" BIGINT,
    "cacheWrite1hMicrocreditsPerMillion" BIGINT,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "auditReason" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerModelTariffSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerModelTariffAssignment" (
    "id" TEXT NOT NULL,
    "tariffSnapshotId" TEXT NOT NULL,
    "scope" "ModelPricingScope" NOT NULL,
    "normalizedScopeKey" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "supersededByAssignmentId" TEXT,
    "supersededBy" TEXT,
    "supersededAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "auditReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerModelTariffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillableInvocationAdmission" (
    "id" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "admissionRequestId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "logicalOperationId" TEXT NOT NULL,
    "attemptOrdinal" INTEGER NOT NULL DEFAULT 1,
    "fundingPrincipal" "AdmissionFundingPrincipal" NOT NULL,
    "userId" TEXT,
    "walletId" TEXT,
    "assessmentId" TEXT,
    "preparationRunId" TEXT,
    "runId" TEXT NOT NULL,
    "executionLeaseToken" TEXT,
    "agentRole" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "resolvedProvider" TEXT NOT NULL,
    "resolvedModel" TEXT NOT NULL,
    "tariffSnapshotId" TEXT,
    "tariffAssignmentId" TEXT,
    "pricingResolution" "ModelPricingScope",
    "runtimePolicyVersion" TEXT NOT NULL,
    "rolloutMode" "ModelUsageDebitMode" NOT NULL DEFAULT 'OFF',
    "appliedMaxOutputTokens" INTEGER NOT NULL,
    "maximumExposureMicrocredits" BIGINT NOT NULL,
    "capabilityDigest" TEXT NOT NULL,
    "state" "AdmissionState" NOT NULL DEFAULT 'ADMITTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "admittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "settledAt" TIMESTAMPTZ(3),
    "settlementFingerprint" TEXT,
    "chargedMicrocredits" BIGINT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillableInvocationAdmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelUsageReceipt" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "providerCompletionState" "ProviderCompletionState" NOT NULL,
    "finishReason" TEXT,
    "responseStatus" TEXT,
    "appliedMaxOutputTokens" INTEGER,
    "operationType" TEXT NOT NULL,
    "routeProtocol" TEXT,
    "runtimePolicyVersion" TEXT NOT NULL,
    "durationMs" INTEGER,
    "modelStep" INTEGER,
    "attemptOrdinal" INTEGER,
    "providerResponseId" TEXT,
    "inputTokens" BIGINT,
    "cachedInputTokens" BIGINT,
    "cacheWriteTokens" BIGINT,
    "cacheWrite5mTokens" BIGINT,
    "cacheWrite1hTokens" BIGINT,
    "outputTokens" BIGINT,
    "visibleOutputTokens" BIGINT,
    "reasoningTokens" BIGINT,
    "totalTokens" BIGINT,
    "chargedMicrocredits" BIGINT,
    "settlementIdempotencyKey" TEXT,
    "settledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelUsageReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelOutputEvaluation" (
    "id" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "admissionId" TEXT,
    "operationType" TEXT NOT NULL,
    "evaluationState" "OutputEvaluationState" NOT NULL DEFAULT 'NOT_EVALUATED',
    "providerCompletionState" "ProviderCompletionState",
    "evaluatorVersion" TEXT,
    "reasonCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelOutputEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerModelTariffDraft_publishedSnapshotId_key" ON "CustomerModelTariffDraft"("publishedSnapshotId");

-- CreateIndex
CREATE INDEX "CustomerModelTariffDraft_normalizedScopeKey_status_updatedA_idx" ON "CustomerModelTariffDraft"("normalizedScopeKey", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerModelTariffSnapshot_idempotencyKey_key" ON "CustomerModelTariffSnapshot"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerModelTariffSnapshot_normalizedScopeKey_publishedAt_idx" ON "CustomerModelTariffSnapshot"("normalizedScopeKey", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerModelTariffSnapshot_normalizedScopeKey_version_key" ON "CustomerModelTariffSnapshot"("normalizedScopeKey", "version");

-- CreateIndex
CREATE INDEX "CustomerModelTariffAssignment_normalizedScopeKey_effectiveF_idx" ON "CustomerModelTariffAssignment"("normalizedScopeKey", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "CustomerModelTariffAssignment_tariffSnapshotId_idx" ON "CustomerModelTariffAssignment"("tariffSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "BillableInvocationAdmission_invocationId_key" ON "BillableInvocationAdmission"("invocationId");

-- CreateIndex
CREATE UNIQUE INDEX "BillableInvocationAdmission_admissionRequestId_key" ON "BillableInvocationAdmission"("admissionRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "BillableInvocationAdmission_settlementFingerprint_key" ON "BillableInvocationAdmission"("settlementFingerprint");

-- CreateIndex
CREATE INDEX "BillableInvocationAdmission_walletId_state_idx" ON "BillableInvocationAdmission"("walletId", "state");

-- CreateIndex
CREATE INDEX "BillableInvocationAdmission_assessmentId_runId_idx" ON "BillableInvocationAdmission"("assessmentId", "runId");

-- CreateIndex
CREATE INDEX "BillableInvocationAdmission_logicalOperationId_idx" ON "BillableInvocationAdmission"("logicalOperationId");

-- CreateIndex
CREATE INDEX "BillableInvocationAdmission_state_admittedAt_idx" ON "BillableInvocationAdmission"("state", "admittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelUsageReceipt_admissionId_key" ON "ModelUsageReceipt"("admissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelUsageReceipt_invocationId_key" ON "ModelUsageReceipt"("invocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelUsageReceipt_settlementIdempotencyKey_key" ON "ModelUsageReceipt"("settlementIdempotencyKey");

-- CreateIndex
CREATE INDEX "ModelUsageReceipt_providerResponseId_idx" ON "ModelUsageReceipt"("providerResponseId");

-- CreateIndex
CREATE INDEX "ModelUsageReceipt_operationType_runtimePolicyVersion_create_idx" ON "ModelUsageReceipt"("operationType", "runtimePolicyVersion", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelOutputEvaluation_invocationId_key" ON "ModelOutputEvaluation"("invocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelOutputEvaluation_admissionId_key" ON "ModelOutputEvaluation"("admissionId");

-- CreateIndex
CREATE INDEX "ModelOutputEvaluation_evaluationState_evaluatedAt_idx" ON "ModelOutputEvaluation"("evaluationState", "evaluatedAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_admissionId_idx" ON "CreditLedgerEntry"("admissionId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_originalLedgerEntryId_idx" ON "CreditLedgerEntry"("originalLedgerEntryId");

-- AddForeignKey
ALTER TABLE "CustomerModelTariffAssignment" ADD CONSTRAINT "CustomerModelTariffAssignment_tariffSnapshotId_fkey" FOREIGN KEY ("tariffSnapshotId") REFERENCES "CustomerModelTariffSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillableInvocationAdmission" ADD CONSTRAINT "BillableInvocationAdmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillableInvocationAdmission" ADD CONSTRAINT "BillableInvocationAdmission_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "BillingWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillableInvocationAdmission" ADD CONSTRAINT "BillableInvocationAdmission_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillableInvocationAdmission" ADD CONSTRAINT "BillableInvocationAdmission_tariffSnapshotId_fkey" FOREIGN KEY ("tariffSnapshotId") REFERENCES "CustomerModelTariffSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillableInvocationAdmission" ADD CONSTRAINT "BillableInvocationAdmission_tariffAssignmentId_fkey" FOREIGN KEY ("tariffAssignmentId") REFERENCES "CustomerModelTariffAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelUsageReceipt" ADD CONSTRAINT "ModelUsageReceipt_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "BillableInvocationAdmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelOutputEvaluation" ADD CONSTRAINT "ModelOutputEvaluation_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "BillableInvocationAdmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- WP8 PostgreSQL Integrity Constraints, Exclusion Indexes & Append-Only Guards
-- Why: Prisma schema syntax cannot natively express GiST interval exclusion,
-- cross-column CHECK constraints, or BEFORE UPDATE OR DELETE immutability triggers.
-- How: Enable btree_gist idempotently, enforce non-overlapping [effectiveFrom, effectiveTo)
-- active tariff assignments per normalizedScopeKey, enforce non-negative rates and
-- scope/identity invariants, enforce funding-principal invariants on admissions,
-- and protect immutable snapshot/receipt tables via BEFORE UPDATE OR DELETE triggers.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    CREATE EXTENSION btree_gist;
  END IF;
END $$;

ALTER TABLE "CustomerModelTariffDraft"
  ADD CONSTRAINT "CustomerModelTariffDraft_rates_non_negative"
  CHECK (
    "inputMicrocreditsPerMillion" >= 0
    AND "outputMicrocreditsPerMillion" >= 0
    AND ("reasoningMicrocreditsPerMillion" IS NULL OR "reasoningMicrocreditsPerMillion" >= 0)
    AND ("cachedInputMicrocreditsPerMillion" IS NULL OR "cachedInputMicrocreditsPerMillion" >= 0)
    AND ("cacheWriteMicrocreditsPerMillion" IS NULL OR "cacheWriteMicrocreditsPerMillion" >= 0)
    AND ("cacheWrite5mMicrocreditsPerMillion" IS NULL OR "cacheWrite5mMicrocreditsPerMillion" >= 0)
    AND ("cacheWrite1hMicrocreditsPerMillion" IS NULL OR "cacheWrite1hMicrocreditsPerMillion" >= 0)
  );

ALTER TABLE "CustomerModelTariffDraft"
  ADD CONSTRAINT "CustomerModelTariffDraft_scope_identity_check"
  CHECK (
    ("scope" = 'EXACT_MODEL' AND "provider" IS NOT NULL AND "resolvedModel" IS NOT NULL)
    OR ("scope" = 'PROVIDER_DEFAULT' AND "provider" IS NOT NULL AND "resolvedModel" IS NULL)
    OR ("scope" = 'GLOBAL_DEFAULT' AND "provider" IS NULL AND "resolvedModel" IS NULL)
  );

ALTER TABLE "CustomerModelTariffSnapshot"
  ADD CONSTRAINT "CustomerModelTariffSnapshot_rates_non_negative"
  CHECK (
    "inputMicrocreditsPerMillion" >= 0
    AND "outputMicrocreditsPerMillion" >= 0
    AND ("reasoningMicrocreditsPerMillion" IS NULL OR "reasoningMicrocreditsPerMillion" >= 0)
    AND ("cachedInputMicrocreditsPerMillion" IS NULL OR "cachedInputMicrocreditsPerMillion" >= 0)
    AND ("cacheWriteMicrocreditsPerMillion" IS NULL OR "cacheWriteMicrocreditsPerMillion" >= 0)
    AND ("cacheWrite5mMicrocreditsPerMillion" IS NULL OR "cacheWrite5mMicrocreditsPerMillion" >= 0)
    AND ("cacheWrite1hMicrocreditsPerMillion" IS NULL OR "cacheWrite1hMicrocreditsPerMillion" >= 0)
  );

ALTER TABLE "CustomerModelTariffSnapshot"
  ADD CONSTRAINT "CustomerModelTariffSnapshot_scope_identity_check"
  CHECK (
    ("scope" = 'EXACT_MODEL' AND "provider" IS NOT NULL AND "resolvedModel" IS NOT NULL)
    OR ("scope" = 'PROVIDER_DEFAULT' AND "provider" IS NOT NULL AND "resolvedModel" IS NULL)
    OR ("scope" = 'GLOBAL_DEFAULT' AND "provider" IS NULL AND "resolvedModel" IS NULL)
  );

ALTER TABLE "CustomerModelTariffAssignment"
  ADD CONSTRAINT "CustomerModelTariffAssignment_interval_valid"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "CustomerModelTariffAssignment"
  ADD CONSTRAINT "CustomerModelTariffAssignment_no_overlap"
  EXCLUDE USING gist (
    "normalizedScopeKey" WITH =,
    tstzrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamptz), '[)') WITH &&
  )
  WHERE ("cancelledAt" IS NULL);

ALTER TABLE "BillableInvocationAdmission"
  ADD CONSTRAINT "BillableInvocationAdmission_funding_principal_check"
  CHECK (
    ("fundingPrincipal" = 'CUSTOMER_WALLET') = ("userId" IS NOT NULL AND "walletId" IS NOT NULL)
  );

ALTER TABLE "BillableInvocationAdmission"
  ADD CONSTRAINT "BillableInvocationAdmission_exposure_and_cap_check"
  CHECK (
    "maximumExposureMicrocredits" >= 0
    AND "appliedMaxOutputTokens" > 0
    AND "attemptOrdinal" > 0
  );

CREATE OR REPLACE FUNCTION "prevent_customer_model_tariff_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CustomerModelTariffSnapshot rows are append-only';
END;
$$;

CREATE TRIGGER "CustomerModelTariffSnapshot_immutable"
BEFORE UPDATE OR DELETE ON "CustomerModelTariffSnapshot"
FOR EACH ROW EXECUTE FUNCTION "prevent_customer_model_tariff_snapshot_mutation"();

CREATE OR REPLACE FUNCTION "prevent_model_usage_receipt_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ModelUsageReceipt rows are append-only';
END;
$$;

CREATE TRIGGER "ModelUsageReceipt_immutable"
BEFORE UPDATE OR DELETE ON "ModelUsageReceipt"
FOR EACH ROW EXECUTE FUNCTION "prevent_model_usage_receipt_mutation"();
