-- CreateTable
CREATE TABLE "PlatformSponsorshipPolicySnapshot" (
    "id" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "description" TEXT,
    "provider" TEXT NOT NULL,
    "resolvedModel" TEXT NOT NULL,
    "inputMicrocreditsPerMillion" BIGINT NOT NULL,
    "outputMicrocreditsPerMillion" BIGINT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSponsorshipPolicySnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformSponsorshipPolicySnapshot_rates_positive_check" CHECK (
        "inputMicrocreditsPerMillion" >= 0
        AND "outputMicrocreditsPerMillion" >= 0
    ),
    CONSTRAINT "PlatformSponsorshipPolicySnapshot_interval_check" CHECK (
        "effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"
    )
);

-- AlterTable
ALTER TABLE "BillableInvocationAdmission" ADD COLUMN IF NOT EXISTS "sponsorshipPolicySnapshotId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSponsorshipPolicySnapshot_policyName_policyVersion_provider_resolvedModel_key" ON "PlatformSponsorshipPolicySnapshot"("policyName", "policyVersion", "provider", "resolvedModel");

-- CreateIndex
CREATE INDEX "PlatformSponsorshipPolicySnapshot_policyName_provider_resolvedModel_effectiveFrom_effectiveTo_idx" ON "PlatformSponsorshipPolicySnapshot"("policyName", "provider", "resolvedModel", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BillableInvocationAdmission_sponsorshipPolicySnapshotId_idx" ON "BillableInvocationAdmission"("sponsorshipPolicySnapshotId");

-- AddForeignKey
ALTER TABLE "BillableInvocationAdmission" ADD CONSTRAINT "BillableInvocationAdmission_sponsorshipPolicySnapshotId_fkey" FOREIGN KEY ("sponsorshipPolicySnapshotId") REFERENCES "PlatformSponsorshipPolicySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable trigger to prevent any UPDATE or DELETE on PlatformSponsorshipPolicySnapshot
CREATE OR REPLACE FUNCTION "prevent_platform_sponsorship_policy_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PlatformSponsorshipPolicySnapshot rows are append-only';
END;
$$;

CREATE TRIGGER "PlatformSponsorshipPolicySnapshot_immutable"
BEFORE UPDATE OR DELETE ON "PlatformSponsorshipPolicySnapshot"
FOR EACH ROW EXECUTE FUNCTION "prevent_platform_sponsorship_policy_snapshot_mutation"();
