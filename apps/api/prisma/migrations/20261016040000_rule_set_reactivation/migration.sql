-- Additive: retain original acceptance rows, their uniqueness and all existing authority guards.
CREATE TYPE "RuleSetReactivationReason" AS ENUM ('SEMANTIC_AUTHORITY_CONTAINMENT');
CREATE TABLE "ComplianceRuleSetReactivationRecord" (
    "id" TEXT NOT NULL,
    "targetRuleSetVersionId" TEXT NOT NULL,
    "previousRuleSetVersionId" TEXT NOT NULL,
    "targetRuleSetDigest" TEXT NOT NULL,
    "previousRuleSetDigest" TEXT NOT NULL,
    "targetPreviousActivatedAt" TIMESTAMP(3) NOT NULL,
    "targetPreviousSupersededAt" TIMESTAMP(3) NOT NULL,
    "previousActiveActivatedAt" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" "RuleSetReactivationReason" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "outboxEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplianceRuleSetReactivationRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ComplianceRuleSetReactivationRecord_distinct_versions" CHECK ("targetRuleSetVersionId" <> "previousRuleSetVersionId"),
    CONSTRAINT "ComplianceRuleSetReactivationRecord_digests" CHECK ("targetRuleSetDigest" ~ '^[a-f0-9]{64}$' AND "previousRuleSetDigest" ~ '^[a-f0-9]{64}$' AND "requestDigest" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ComplianceRuleSetReactivationRecord_identity" CHECK (length(btrim("actorId")) > 0 AND length(btrim("correlationId")) > 0 AND length(btrim("idempotencyKey")) BETWEEN 1 AND 200),
    CONSTRAINT "CRSReactivation_target_fkey" FOREIGN KEY ("targetRuleSetVersionId") REFERENCES "ComplianceRuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CRSReactivation_previous_fkey" FOREIGN KEY ("previousRuleSetVersionId") REFERENCES "ComplianceRuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ComplianceRuleSetReactivationRecord_idempotencyKey_key" ON "ComplianceRuleSetReactivationRecord"("idempotencyKey");
CREATE UNIQUE INDEX "ComplianceRuleSetReactivationRecord_auditEventId_key" ON "ComplianceRuleSetReactivationRecord"("auditEventId");
CREATE UNIQUE INDEX "ComplianceRuleSetReactivationRecord_outboxEventId_key" ON "ComplianceRuleSetReactivationRecord"("outboxEventId");
CREATE INDEX "CRSReactivation_target_created_idx" ON "ComplianceRuleSetReactivationRecord"("targetRuleSetVersionId", "createdAt");
CREATE INDEX "CRSReactivation_previous_idx" ON "ComplianceRuleSetReactivationRecord"("previousRuleSetVersionId");
CREATE TRIGGER "ComplianceRuleSetReactivationRecord_immutable"
BEFORE UPDATE OR DELETE ON "ComplianceRuleSetReactivationRecord"
FOR EACH ROW EXECUTE FUNCTION public.lcsp_compliance_rule_set_immutable();
