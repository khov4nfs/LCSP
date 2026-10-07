-- W2 legal portfolio: expand-only. Adds portfolio-bound storage next to the V1
-- LegalRuleCatalogVersion/LegalRule/approval tables, which are left untouched
-- (no FK drop/repoint, no semantic backfill). Archive is W6, removal is W7.
-- CreateEnum
CREATE TYPE "ArtifactLifecycleState" AS ENUM ('BUILDING', 'ACTIVE', 'SUPERSEDED', 'INVALID');

-- CreateEnum
CREATE TYPE "LegalPortfolioCoverageState" AS ENUM ('COVERED_BY_ENGINEERING_RULES', 'NON_ASSESSABLE');

-- CreateEnum
CREATE TYPE "LegalContextRelationKind" AS ENUM ('DEFINITION', 'SCOPE', 'QUALIFIER', 'EXCEPTION', 'CROSS_REFERENCE');

-- CreateEnum
CREATE TYPE "LegalPortfolioValidationOutcome" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "LegalPreparationFailureReason" AS ENUM ('MODEL_ERROR', 'NO_SUBMISSION', 'PORTFOLIO_VALIDATION_FAILED', 'CORPUS_UNAVAILABLE', 'RUNTIME_ERROR');

-- AlterEnum
ALTER TYPE "AuditResourceType" ADD VALUE 'LEGAL_PORTFOLIO_VERSION';

-- AlterEnum
ALTER TYPE "OutboxAggregateType" ADD VALUE 'LEGAL_PORTFOLIO_VERSION';

-- CreateTable
CREATE TABLE "LegalPreparationRun" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "legalCorpusVersionId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "executionState" "AgentExecutionState" NOT NULL DEFAULT 'QUEUED',
    "failureReason" "LegalPreparationFailureReason",
    "outboxEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LegalPreparationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalPortfolioVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "legalCorpusVersionId" TEXT NOT NULL,
    "preparationRunId" TEXT NOT NULL,
    "lifecycleState" "ArtifactLifecycleState" NOT NULL DEFAULT 'BUILDING',
    "portfolioDigest" TEXT NOT NULL,
    "validationOutcome" "LegalPortfolioValidationOutcome",
    "validationFailures" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "LegalPortfolioVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalPortfolioRule" (
    "id" TEXT NOT NULL,
    "portfolioVersionId" TEXT NOT NULL,
    "legalRuleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "proposition" TEXT NOT NULL,
    "applicabilityConditions" JSONB NOT NULL,
    "qualifiers" JSONB NOT NULL,
    "exceptions" JSONB NOT NULL,
    "nonRepositoryDuty" BOOLEAN NOT NULL,
    "coverageState" "LegalPortfolioCoverageState" NOT NULL,
    "nonAssessableReason" TEXT,
    "contentDigest" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "LegalPortfolioRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineeringRule" (
    "id" TEXT NOT NULL,
    "portfolioVersionId" TEXT NOT NULL,
    "engineeringRuleId" TEXT NOT NULL,
    "engineeringRuleVersion" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "legalIntent" TEXT NOT NULL,
    "applicabilityGuidance" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "contract" JSONB NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "contentDigest" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineeringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineeringRuleLegalRule" (
    "portfolioVersionId" TEXT NOT NULL,
    "engineeringRuleRowId" TEXT NOT NULL,
    "portfolioRuleId" TEXT NOT NULL,

    CONSTRAINT "EngineeringRuleLegalRule_pkey" PRIMARY KEY ("engineeringRuleRowId","portfolioRuleId")
);

-- CreateTable
CREATE TABLE "LegalRuleProvenance" (
    "id" TEXT NOT NULL,
    "portfolioVersionId" TEXT NOT NULL,
    "portfolioRuleId" TEXT NOT NULL,
    "legalCorpusVersionId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "sourceEffectStatus" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "LegalRuleProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalRuleContextRelation" (
    "id" TEXT NOT NULL,
    "portfolioVersionId" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "kind" "LegalContextRelationKind" NOT NULL,
    "fromRuleId" TEXT NOT NULL,
    "toRuleId" TEXT,
    "toChunkId" TEXT,
    "legalCorpusVersionId" TEXT NOT NULL,
    "relationDigest" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "LegalRuleContextRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalPortfolioActivationRecord" (
    "id" TEXT NOT NULL,
    "portfolioVersionId" TEXT NOT NULL,
    "preparationRunId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "validationOutcome" "LegalPortfolioValidationOutcome" NOT NULL,
    "validationFailures" JSONB NOT NULL DEFAULT '[]',
    "previousActivePortfolioVersionId" TEXT,
    "outboxEventId" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalPortfolioActivationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalPreparationRun_idempotencyKey_key" ON "LegalPreparationRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LegalPreparationRun_legalCorpusVersionId_idx" ON "LegalPreparationRun"("legalCorpusVersionId");

-- CreateIndex
CREATE INDEX "LegalPreparationRun_executionState_createdAt_idx" ON "LegalPreparationRun"("executionState", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPortfolioVersion_version_key" ON "LegalPortfolioVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPortfolioVersion_preparationRunId_key" ON "LegalPortfolioVersion"("preparationRunId");

-- CreateIndex
CREATE INDEX "LegalPortfolioVersion_lifecycleState_idx" ON "LegalPortfolioVersion"("lifecycleState");

-- CreateIndex
CREATE INDEX "LegalPortfolioVersion_legalCorpusVersionId_idx" ON "LegalPortfolioVersion"("legalCorpusVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPortfolioVersion_id_legalCorpusVersionId_key" ON "LegalPortfolioVersion"("id", "legalCorpusVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPortfolioRule_portfolioVersionId_legalRuleId_key" ON "LegalPortfolioRule"("portfolioVersionId", "legalRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPortfolioRule_id_portfolioVersionId_key" ON "LegalPortfolioRule"("id", "portfolioVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "EngineeringRule_portfolioVersionId_engineeringRuleId_key" ON "EngineeringRule"("portfolioVersionId", "engineeringRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "EngineeringRule_id_portfolioVersionId_key" ON "EngineeringRule"("id", "portfolioVersionId");

-- CreateIndex
CREATE INDEX "EngineeringRuleLegalRule_portfolioRuleId_idx" ON "EngineeringRuleLegalRule"("portfolioRuleId");

-- CreateIndex
CREATE INDEX "LegalRuleProvenance_portfolioVersionId_idx" ON "LegalRuleProvenance"("portfolioVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalRuleProvenance_portfolioRuleId_chunkId_key" ON "LegalRuleProvenance"("portfolioRuleId", "chunkId");

-- CreateIndex
CREATE INDEX "LegalRuleContextRelation_fromRuleId_idx" ON "LegalRuleContextRelation"("fromRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalRuleContextRelation_portfolioVersionId_relationId_key" ON "LegalRuleContextRelation"("portfolioVersionId", "relationId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPortfolioActivationRecord_portfolioVersionId_key" ON "LegalPortfolioActivationRecord"("portfolioVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPortfolioActivationRecord_preparationRunId_key" ON "LegalPortfolioActivationRecord"("preparationRunId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalPortfolioActivationRecord_idempotencyKey_key" ON "LegalPortfolioActivationRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LegalPortfolioActivationRecord_previousActivePortfolioVersi_idx" ON "LegalPortfolioActivationRecord"("previousActivePortfolioVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocumentChunk_id_legalCorpusVersionId_key" ON "LegalDocumentChunk"("id", "legalCorpusVersionId");

-- AddForeignKey
ALTER TABLE "LegalPreparationRun" ADD CONSTRAINT "LegalPreparationRun_legalCorpusVersionId_fkey" FOREIGN KEY ("legalCorpusVersionId") REFERENCES "LegalCorpusVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalPortfolioVersion" ADD CONSTRAINT "LegalPortfolioVersion_legalCorpusVersionId_fkey" FOREIGN KEY ("legalCorpusVersionId") REFERENCES "LegalCorpusVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalPortfolioVersion" ADD CONSTRAINT "LegalPortfolioVersion_preparationRunId_fkey" FOREIGN KEY ("preparationRunId") REFERENCES "LegalPreparationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalPortfolioRule" ADD CONSTRAINT "LegalPortfolioRule_portfolioVersionId_fkey" FOREIGN KEY ("portfolioVersionId") REFERENCES "LegalPortfolioVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringRule" ADD CONSTRAINT "EngineeringRule_portfolioVersionId_fkey" FOREIGN KEY ("portfolioVersionId") REFERENCES "LegalPortfolioVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringRuleLegalRule" ADD CONSTRAINT "EngineeringRuleLegalRule_engineeringRuleRowId_portfolioVer_fkey" FOREIGN KEY ("engineeringRuleRowId", "portfolioVersionId") REFERENCES "EngineeringRule"("id", "portfolioVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineeringRuleLegalRule" ADD CONSTRAINT "EngineeringRuleLegalRule_portfolioRuleId_portfolioVersionI_fkey" FOREIGN KEY ("portfolioRuleId", "portfolioVersionId") REFERENCES "LegalPortfolioRule"("id", "portfolioVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleProvenance" ADD CONSTRAINT "LegalRuleProvenance_portfolioVersionId_legalCorpusVersionI_fkey" FOREIGN KEY ("portfolioVersionId", "legalCorpusVersionId") REFERENCES "LegalPortfolioVersion"("id", "legalCorpusVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleProvenance" ADD CONSTRAINT "LegalRuleProvenance_portfolioRuleId_portfolioVersionId_fkey" FOREIGN KEY ("portfolioRuleId", "portfolioVersionId") REFERENCES "LegalPortfolioRule"("id", "portfolioVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleProvenance" ADD CONSTRAINT "LegalRuleProvenance_chunkId_legalCorpusVersionId_fkey" FOREIGN KEY ("chunkId", "legalCorpusVersionId") REFERENCES "LegalDocumentChunk"("id", "legalCorpusVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleContextRelation" ADD CONSTRAINT "LegalRuleContextRelation_portfolioVersionId_legalCorpusVer_fkey" FOREIGN KEY ("portfolioVersionId", "legalCorpusVersionId") REFERENCES "LegalPortfolioVersion"("id", "legalCorpusVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleContextRelation" ADD CONSTRAINT "LegalRuleContextRelation_fromRuleId_portfolioVersionId_fkey" FOREIGN KEY ("fromRuleId", "portfolioVersionId") REFERENCES "LegalPortfolioRule"("id", "portfolioVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRuleContextRelation" ADD CONSTRAINT "LegalRuleContextRelation_toChunkId_legalCorpusVersionId_fkey" FOREIGN KEY ("toChunkId", "legalCorpusVersionId") REFERENCES "LegalDocumentChunk"("id", "legalCorpusVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalPortfolioActivationRecord" ADD CONSTRAINT "LegalPortfolioActivationRecord_portfolioVersionId_fkey" FOREIGN KEY ("portfolioVersionId") REFERENCES "LegalPortfolioVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalPortfolioActivationRecord" ADD CONSTRAINT "LegalPortfolioActivationRecord_previousActivePortfolioVers_fkey" FOREIGN KEY ("previousActivePortfolioVersionId") REFERENCES "LegalPortfolioVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalPortfolioActivationRecord" ADD CONSTRAINT "LegalPortfolioActivationRecord_preparationRunId_fkey" FOREIGN KEY ("preparationRunId") REFERENCES "LegalPreparationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Guarantees Prisma cannot express.
-- ---------------------------------------------------------------------------

-- At most one ACTIVE portfolio. Readers use this row, never "latest by date".
CREATE UNIQUE INDEX "LegalPortfolioVersion_single_active_idx"
  ON "LegalPortfolioVersion" ((TRUE))
  WHERE "lifecycleState" = 'ACTIVE';

-- Lifecycle / validation consistency (ALCS only; no approval states).
ALTER TABLE "LegalPortfolioVersion"
  ADD CONSTRAINT "LegalPortfolioVersion_state_consistency_check" CHECK (
    ("lifecycleState" = 'BUILDING' AND "validationOutcome" IS NULL AND "activatedAt" IS NULL)
    OR ("lifecycleState" = 'ACTIVE' AND "validationOutcome" = 'PASSED' AND "activatedAt" IS NOT NULL AND "supersededAt" IS NULL)
    OR ("lifecycleState" = 'SUPERSEDED' AND "validationOutcome" = 'PASSED' AND "activatedAt" IS NOT NULL AND "supersededAt" IS NOT NULL)
    OR ("lifecycleState" = 'INVALID')
  );

ALTER TABLE "LegalPortfolioActivationRecord"
  ADD CONSTRAINT "LegalPortfolioActivationRecord_failures_check" CHECK (
    ("validationOutcome" = 'PASSED' AND "validationFailures" = '[]'::jsonb)
    OR ("validationOutcome" = 'FAILED' AND jsonb_array_length("validationFailures") > 0)
  );

-- A rule is either covered by EngineeringRules or carries an agent-declared reason.
ALTER TABLE "LegalPortfolioRule"
  ADD CONSTRAINT "LegalPortfolioRule_coverage_reason_check" CHECK (
    ("coverageState" = 'COVERED_BY_ENGINEERING_RULES' AND "nonAssessableReason" IS NULL)
    OR ("coverageState" = 'NON_ASSESSABLE' AND "nonAssessableReason" IS NOT NULL AND length(btrim("nonAssessableReason")) > 0)
  );

-- A context relation points at exactly one target: another rule or a source chunk.
ALTER TABLE "LegalRuleContextRelation"
  ADD CONSTRAINT "LegalRuleContextRelation_exactly_one_target_check" CHECK (
    ("toRuleId" IS NULL) <> ("toChunkId" IS NULL)
  );

-- The target rule must belong to the same portfolio (nullable composite FK; MATCH SIMPLE).
ALTER TABLE "LegalRuleContextRelation"
  ADD CONSTRAINT "LegalRuleContextRelation_toRule_same_portfolio_fkey"
  FOREIGN KEY ("toRuleId", "portfolioVersionId")
  REFERENCES "LegalPortfolioRule"("id", "portfolioVersionId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Portfolio identity is immutable and lifecycle follows the frozen ALCS table:
-- BUILDING -> ACTIVE | INVALID; ACTIVE -> SUPERSEDED | INVALID;
-- SUPERSEDED -> ACTIVE | INVALID (audited pointer rollback); INVALID terminal.
CREATE FUNCTION "lcsp_legal_portfolio_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legal portfolio versions are immutable history and cannot be deleted';
  END IF;
  IF NEW."version" <> OLD."version"
     OR NEW."legalCorpusVersionId" <> OLD."legalCorpusVersionId"
     OR NEW."preparationRunId" <> OLD."preparationRunId"
     OR NEW."portfolioDigest" <> OLD."portfolioDigest" THEN
    RAISE EXCEPTION 'legal portfolio identity is immutable';
  END IF;
  IF OLD."validationOutcome" IS NOT NULL AND (
       NEW."validationOutcome" IS DISTINCT FROM OLD."validationOutcome"
       OR NEW."validationFailures" IS DISTINCT FROM OLD."validationFailures") THEN
    RAISE EXCEPTION 'legal portfolio validation result is immutable once recorded';
  END IF;
  IF NEW."lifecycleState" <> OLD."lifecycleState" AND NOT (
       (OLD."lifecycleState" = 'BUILDING' AND NEW."lifecycleState" IN ('ACTIVE', 'INVALID'))
    OR (OLD."lifecycleState" = 'ACTIVE' AND NEW."lifecycleState" IN ('SUPERSEDED', 'INVALID'))
    OR (OLD."lifecycleState" = 'SUPERSEDED' AND NEW."lifecycleState" IN ('ACTIVE', 'INVALID'))
  ) THEN
    RAISE EXCEPTION 'illegal legal portfolio lifecycle transition % -> %', OLD."lifecycleState", NEW."lifecycleState";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegalPortfolioVersion_guard"
  BEFORE UPDATE OR DELETE ON "LegalPortfolioVersion"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legal_portfolio_guard"();

-- Child rows and the activation record are written once and never changed.
CREATE FUNCTION "lcsp_legal_portfolio_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable once written', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegalPortfolioRule_immutable" BEFORE UPDATE OR DELETE ON "LegalPortfolioRule"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legal_portfolio_immutable"();
CREATE TRIGGER "EngineeringRule_immutable" BEFORE UPDATE OR DELETE ON "EngineeringRule"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legal_portfolio_immutable"();
CREATE TRIGGER "EngineeringRuleLegalRule_immutable" BEFORE UPDATE OR DELETE ON "EngineeringRuleLegalRule"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legal_portfolio_immutable"();
CREATE TRIGGER "LegalRuleProvenance_immutable" BEFORE UPDATE OR DELETE ON "LegalRuleProvenance"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legal_portfolio_immutable"();
CREATE TRIGGER "LegalRuleContextRelation_immutable" BEFORE UPDATE OR DELETE ON "LegalRuleContextRelation"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legal_portfolio_immutable"();
CREATE TRIGGER "LegalPortfolioActivationRecord_immutable" BEFORE UPDATE OR DELETE ON "LegalPortfolioActivationRecord"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legal_portfolio_immutable"();

-- A failure reason is recorded exactly when the execution FAILED.
ALTER TABLE "LegalPreparationRun"
  ADD CONSTRAINT "LegalPreparationRun_failure_reason_check" CHECK (
    ("executionState" = 'FAILED') = ("failureReason" IS NOT NULL)
  );
