CREATE TYPE "AssessmentAuditMode" AS ENUM ('LEGACY_FULL', 'CUSTOMER_SELECTED');
CREATE TYPE "AssessmentRuleAuditScopeMode" AS ENUM ('SELECTED_RULES', 'FULL_RULE_SET');
CREATE TYPE "AssessmentRuleAuditStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_FOR_CUSTOMER', 'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED');

ALTER TABLE "AssessmentCase"
  ADD COLUMN "auditRequestRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "auditMode" "AssessmentAuditMode" NOT NULL DEFAULT 'LEGACY_FULL';

ALTER TABLE "AssessmentRuntime" ADD COLUMN "currentAuditRequestId" UUID;
ALTER TABLE "AssessmentRuleDecision" ADD COLUMN "auditRequestId" UUID;

CREATE TABLE "AssessmentRuleAuditRequest" (
  "requestId" UUID NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "requestRevision" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "scopeMode" "AssessmentRuleAuditScopeMode" NOT NULL,
  "status" "AssessmentRuleAuditStatus" NOT NULL DEFAULT 'QUEUED',
  "lastRetryKey" TEXT,
  "retryAttempt" INTEGER NOT NULL DEFAULT 0,
  "ruleSetVersionId" TEXT NOT NULL,
  "ruleSetDigest" TEXT NOT NULL,
  "repositorySnapshotId" TEXT NOT NULL,
  "repositoryCommit" TEXT NOT NULL,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "AssessmentRuleAuditRequest_pkey" PRIMARY KEY ("requestId")
);

CREATE TABLE "AssessmentRuleAuditItem" (
  "requestId" UUID NOT NULL,
  "assessmentRuleId" TEXT NOT NULL,
  "assessmentRuleVersion" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "reusedDecisionId" UUID,
  CONSTRAINT "AssessmentRuleAuditItem_pkey" PRIMARY KEY ("requestId", "assessmentRuleId")
);

CREATE TABLE "AssessmentRuleAuditExport" (
  "exportId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentRuleAuditExport_pkey" PRIMARY KEY ("exportId")
);

CREATE UNIQUE INDEX "AssessmentRuleAuditRequest_assessmentId_requestRevision_key" ON "AssessmentRuleAuditRequest"("assessmentId", "requestRevision");
CREATE UNIQUE INDEX "AssessmentRuleAuditRequest_assessmentId_idempotencyKey_key" ON "AssessmentRuleAuditRequest"("assessmentId", "idempotencyKey");
CREATE INDEX "AssessmentRuleAuditRequest_assessmentId_status_idx" ON "AssessmentRuleAuditRequest"("assessmentId", "status");
CREATE UNIQUE INDEX "AssessmentRuleAuditItem_requestId_ordinal_key" ON "AssessmentRuleAuditItem"("requestId", "ordinal");
CREATE UNIQUE INDEX "AssessmentRuleAuditExport_requestId_idempotencyKey_key" ON "AssessmentRuleAuditExport"("requestId", "idempotencyKey");
CREATE INDEX "AssessmentRuleAuditExport_assessmentId_requestId_idx" ON "AssessmentRuleAuditExport"("assessmentId", "requestId");
ALTER TABLE "AssessmentRuleAuditRequest" ADD CONSTRAINT "AssessmentRuleAuditRequest_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "AssessmentRuleAuditItem" ADD CONSTRAINT "AssessmentRuleAuditItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AssessmentRuleAuditRequest"("requestId") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "AssessmentRuleDecision" ADD CONSTRAINT "AssessmentRuleDecision_auditRequestId_fkey" FOREIGN KEY ("auditRequestId") REFERENCES "AssessmentRuleAuditRequest"("requestId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AssessmentRuleAuditExport" ADD CONSTRAINT "AssessmentRuleAuditExport_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AssessmentRuleAuditRequest"("requestId") ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE FUNCTION lcsp_guard_rule_audit_request_identity() RETURNS trigger AS $$
BEGIN
  IF (OLD."assessmentId", OLD."requestRevision", OLD."idempotencyKey", OLD."requestDigest", OLD."scopeMode", OLD."ruleSetVersionId", OLD."ruleSetDigest", OLD."repositorySnapshotId", OLD."repositoryCommit", OLD."requestedAt")
     IS DISTINCT FROM
     (NEW."assessmentId", NEW."requestRevision", NEW."idempotencyKey", NEW."requestDigest", NEW."scopeMode", NEW."ruleSetVersionId", NEW."ruleSetDigest", NEW."repositorySnapshotId", NEW."repositoryCommit", NEW."requestedAt") THEN
    RAISE EXCEPTION 'audit request identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AssessmentRuleAuditRequest_identity_guard" BEFORE UPDATE ON "AssessmentRuleAuditRequest"
  FOR EACH ROW EXECUTE FUNCTION lcsp_guard_rule_audit_request_identity();

CREATE FUNCTION lcsp_guard_rule_audit_item() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit request members are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AssessmentRuleAuditItem_identity_guard" BEFORE UPDATE ON "AssessmentRuleAuditItem"
  FOR EACH ROW EXECUTE FUNCTION lcsp_guard_rule_audit_item();

CREATE TRIGGER "AssessmentRuleAuditExport_identity_guard" BEFORE UPDATE ON "AssessmentRuleAuditExport"
  FOR EACH ROW EXECUTE FUNCTION lcsp_guard_rule_audit_item();
