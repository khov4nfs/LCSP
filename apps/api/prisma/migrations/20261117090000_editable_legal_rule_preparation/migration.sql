-- AlterEnum
ALTER TYPE "PreparationExecutionContract" ADD VALUE 'SELECTED_RULE_V1';

-- CreateTable
CREATE TABLE "LegalRuleCatalogVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "legalSourceVersionId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalRuleCatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalRule" (
    "id" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "legalRuleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "citationLocatorRefs" JSONB NOT NULL,
    "authoredBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparationRuleSelection" (
    "id" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "catalogRevision" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationRuleSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparationRuleBatch" (
    "id" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationRuleBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparationRule" (
    "id" TEXT NOT NULL,
    "legalRuleId" TEXT NOT NULL,

    CONSTRAINT "PreparationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparationRuleResult" (
    "id" TEXT NOT NULL,
    "preparationRuleId" TEXT NOT NULL,
    "preparationRunId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "instructionReceipt" JSONB,
    "output" JSONB,
    "failureCode" TEXT,
    "retryOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationRuleResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalRuleCatalogVersion_version_key" ON "LegalRuleCatalogVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "LegalRule_catalogVersionId_legalRuleId_key" ON "LegalRule"("catalogVersionId", "legalRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationRuleBatch_requestedBy_idempotencyKey_key" ON "PreparationRuleBatch"("requestedBy", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationRule_legalRuleId_key" ON "PreparationRule"("legalRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationRuleResult_preparationRunId_key" ON "PreparationRuleResult"("preparationRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationRuleResult_retryOfId_key" ON "PreparationRuleResult"("retryOfId");

-- CreateIndex
CREATE INDEX "PreparationRuleResult_batchId_createdAt_idx" ON "PreparationRuleResult"("batchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationRuleResult_preparationRuleId_revision_key" ON "PreparationRuleResult"("preparationRuleId", "revision");

-- AddForeignKey
ALTER TABLE "LegalRuleCatalogVersion" ADD CONSTRAINT "LegalRuleCatalogVersion_legalSourceVersionId_fkey" FOREIGN KEY ("legalSourceVersionId") REFERENCES "LegalSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRule" ADD CONSTRAINT "LegalRule_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "LegalRuleCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationRuleSelection" ADD CONSTRAINT "PreparationRuleSelection_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "LegalRuleCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationRuleBatch" ADD CONSTRAINT "PreparationRuleBatch_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "PreparationRuleSelection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationRule" ADD CONSTRAINT "PreparationRule_legalRuleId_fkey" FOREIGN KEY ("legalRuleId") REFERENCES "LegalRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationRuleResult" ADD CONSTRAINT "PreparationRuleResult_preparationRuleId_fkey" FOREIGN KEY ("preparationRuleId") REFERENCES "PreparationRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationRuleResult" ADD CONSTRAINT "PreparationRuleResult_preparationRunId_fkey" FOREIGN KEY ("preparationRunId") REFERENCES "RuleSetPreparationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationRuleResult" ADD CONSTRAINT "PreparationRuleResult_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PreparationRuleBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationRuleResult" ADD CONSTRAINT "PreparationRuleResult_retryOfId_fkey" FOREIGN KEY ("retryOfId") REFERENCES "PreparationRuleResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Catalogs stay editable for development. Execution inputs, receipts and completed
-- result revisions remain durable so re-analysis can be compared truthfully.
CREATE FUNCTION protect_preparation_rule_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Preparation rule history cannot be deleted';
  END IF;
  IF ROW(NEW."id", NEW."preparationRuleId", NEW."preparationRunId", NEW."batchId", NEW."revision", NEW."inputSnapshot", NEW."inputFingerprint", NEW."retryOfId", NEW."createdAt")
     IS DISTINCT FROM ROW(OLD."id", OLD."preparationRuleId", OLD."preparationRunId", OLD."batchId", OLD."revision", OLD."inputSnapshot", OLD."inputFingerprint", OLD."retryOfId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Preparation rule input identity is immutable';
  END IF;
  IF OLD."instructionReceipt" IS NOT NULL AND NEW."instructionReceipt" IS DISTINCT FROM OLD."instructionReceipt" THEN
    RAISE EXCEPTION 'Preparation instruction receipt is immutable';
  END IF;
  IF EXISTS (SELECT 1 FROM "RuleSetPreparationRun" WHERE "id" = OLD."preparationRunId" AND "executionState" <> 'RUNNING') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Preparation results can only settle a running attempt';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_rule_result_immutable BEFORE UPDATE OR DELETE ON "PreparationRuleResult"
FOR EACH ROW EXECUTE FUNCTION protect_preparation_rule_result();

CREATE FUNCTION protect_preparation_rule_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Confirmed selection snapshots cannot be edited or deleted';
END $$;
CREATE TRIGGER preparation_rule_selection_immutable BEFORE UPDATE OR DELETE ON "PreparationRuleSelection"
FOR EACH ROW EXECUTE FUNCTION protect_preparation_rule_selection();
