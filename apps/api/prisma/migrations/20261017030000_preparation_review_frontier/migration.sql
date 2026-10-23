-- CreateEnum
CREATE TYPE "SourceReviewState" AS ENUM ('PENDING', 'IN_REVIEW', 'REVIEWED_WITH_CLAIMS', 'REVIEWED_NO_CLAIMS', 'BLOCKED_REFERENCE', 'REOPENED');

-- CreateEnum
CREATE TYPE "SourceReviewDisposition" AS ENUM ('CLAIMS_AUTHORED', 'NO_RELEVANT_SEMANTIC_CLAIMS', 'CONTEXT_ONLY', 'REQUIRES_REFERENCE_RESOLUTION');

-- AlterTable
ALTER TABLE "RuleSetPreparationRun" ADD COLUMN     "claimDiscoveryOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RuleSetPreparationClaimInventory" ADD COLUMN     "reviewedFrontierFingerprint" TEXT;

-- CreateTable
CREATE TABLE "RuleSetPreparationReviewFrontier" (
    "preparationRunId" TEXT NOT NULL,
    "inventoryRevision" INTEGER NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "materializationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" TEXT NOT NULL,
    "stateFingerprint" TEXT NOT NULL,
    "stateAccumulator" TEXT NOT NULL,
    "unitCount" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "inReviewCount" INTEGER NOT NULL DEFAULT 0,
    "reviewedWithClaimsCount" INTEGER NOT NULL DEFAULT 0,
    "reviewedNoClaimsCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "persistedClaimCount" INTEGER NOT NULL DEFAULT 0,
    "expansions" JSONB NOT NULL DEFAULT '[]',
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleSetPreparationReviewFrontier_pkey" PRIMARY KEY ("preparationRunId","inventoryRevision")
);

-- CreateTable
CREATE TABLE "RuleSetPreparationSourceReview" (
    "preparationRunId" TEXT NOT NULL,
    "inventoryRevision" INTEGER NOT NULL,
    "materializationId" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "structuralPath" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "state" "SourceReviewState" NOT NULL DEFAULT 'PENDING',
    "disposition" "SourceReviewDisposition",
    "reason" TEXT,
    "operationId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "claimIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownedClaimCount" INTEGER NOT NULL DEFAULT 0,
    "referenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedReferenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL DEFAULT '{"claims":[],"identities":{},"relations":[],"referenceAccounting":[]}',
    "stateFingerprint" TEXT NOT NULL,
    "completionFingerprint" TEXT,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleSetPreparationSourceReview_pkey" PRIMARY KEY ("preparationRunId","inventoryRevision","sourceNodeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "RuleSetPreparationReviewFrontier_preparationRunId_inventory_key" ON "RuleSetPreparationReviewFrontier"("preparationRunId", "inventoryRevision", "materializationId", "legalSourceVersionId");

-- CreateIndex
CREATE INDEX "SourceReview_pending_idx" ON "RuleSetPreparationSourceReview"("preparationRunId", "inventoryRevision", "state", "ordinal");

-- CreateIndex
CREATE INDEX "RuleSetPreparationSourceReview_claimIds_idx" ON "RuleSetPreparationSourceReview" USING GIN ("claimIds");

-- CreateIndex
CREATE INDEX "RuleSetPreparationSourceReview_blockedReferenceIds_idx" ON "RuleSetPreparationSourceReview" USING GIN ("blockedReferenceIds");

-- CreateIndex
CREATE INDEX "SourceReview_path_idx" ON "RuleSetPreparationSourceReview"("preparationRunId", "inventoryRevision", "structuralPath");

-- CreateIndex
CREATE UNIQUE INDEX "RuleSetPreparationRun_id_legalSourceVersionId_key" ON "RuleSetPreparationRun"("id", "legalSourceVersionId");

-- AddForeignKey
ALTER TABLE "RuleSetPreparationReviewFrontier" ADD CONSTRAINT "RuleSetPreparationReviewFrontier_preparationRunId_legalSou_fkey" FOREIGN KEY ("preparationRunId", "legalSourceVersionId") REFERENCES "RuleSetPreparationRun"("id", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RuleSetPreparationReviewFrontier" ADD CONSTRAINT "RuleSetPreparationReviewFrontier_materializationId_legalSo_fkey" FOREIGN KEY ("materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentMaterialization"("id", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RuleSetPreparationSourceReview" ADD CONSTRAINT "RuleSetPreparationSourceReview_preparationRunId_inventoryR_fkey" FOREIGN KEY ("preparationRunId", "inventoryRevision", "materializationId", "legalSourceVersionId") REFERENCES "RuleSetPreparationReviewFrontier"("preparationRunId", "inventoryRevision", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RuleSetPreparationSourceReview" ADD CONSTRAINT "RuleSetPreparationSourceReview_sourceNodeId_materializatio_fkey" FOREIGN KEY ("sourceNodeId", "materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentNode"("nodeId", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Enforce one leased unit and protect frozen review evidence independently of application code.
CREATE UNIQUE INDEX "SourceReview_one_in_review" ON "RuleSetPreparationSourceReview" ("preparationRunId","inventoryRevision") WHERE state='IN_REVIEW';
ALTER TABLE "RuleSetPreparationReviewFrontier" ADD CONSTRAINT "ReviewFrontier_shape_check" CHECK (
 revision>0 AND "inventoryRevision">0 AND fingerprint ~ '^[a-f0-9]{64}$' AND "stateFingerprint" ~ '^[a-f0-9]{64}$' AND "stateAccumulator" ~ '^[a-f0-9]{64}$'
 AND "unitCount"="pendingCount"+"inReviewCount"+"reviewedWithClaimsCount"+"reviewedNoClaimsCount"+"blockedCount"
 AND LEAST("pendingCount","inReviewCount","reviewedWithClaimsCount","reviewedNoClaimsCount","blockedCount","persistedClaimCount")>=0);
ALTER TABLE "RuleSetPreparationSourceReview" ALTER COLUMN "claimIds" SET NOT NULL, ALTER COLUMN "referenceIds" SET NOT NULL, ALTER COLUMN "blockedReferenceIds" SET NOT NULL;
ALTER TABLE "RuleSetPreparationSourceReview" ADD CONSTRAINT "SourceReview_shape_check" CHECK (
 "inventoryRevision">0 AND ordinal>=0 AND "ownedClaimCount"=jsonb_array_length(payload->'claims') AND "stateFingerprint" ~ '^[a-f0-9]{64}$'
 AND ((state='IN_REVIEW')=("operationId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL))
 AND (state<>'REVIEWED_WITH_CLAIMS' OR (cardinality("claimIds")>0 AND disposition IN ('CLAIMS_AUTHORED','CONTEXT_ONLY') AND "completedAt" IS NOT NULL))
 AND (state<>'REVIEWED_NO_CLAIMS' OR (cardinality("claimIds")=0 AND disposition='NO_RELEVANT_SEMANTIC_CLAIMS' AND length(trim(reason))>0 AND "completedAt" IS NOT NULL))
 AND (state<>'BLOCKED_REFERENCE' OR (disposition='REQUIRES_REFERENCE_RESOLUTION' AND cardinality("blockedReferenceIds")>0 AND length(trim(reason))>0)));
CREATE FUNCTION "lcsp_review_frontier_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='RuleSetPreparationReviewFrontier' THEN
  IF OLD."frozenAt" IS NOT NULL THEN RAISE EXCEPTION 'Frozen review frontier is immutable'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM "RuleSetPreparationReviewFrontier" f WHERE f."preparationRunId"=COALESCE(NEW."preparationRunId",OLD."preparationRunId") AND f."inventoryRevision"=COALESCE(NEW."inventoryRevision",OLD."inventoryRevision") AND f."frozenAt" IS NOT NULL) THEN RAISE EXCEPTION 'Frozen review dispositions are immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER "ReviewFrontier_frozen" BEFORE UPDATE OR DELETE ON "RuleSetPreparationReviewFrontier" FOR EACH ROW EXECUTE FUNCTION "lcsp_review_frontier_frozen"();
CREATE TRIGGER "SourceReview_frozen" BEFORE INSERT OR UPDATE OR DELETE ON "RuleSetPreparationSourceReview" FOR EACH ROW EXECUTE FUNCTION "lcsp_review_frontier_frozen"();
CREATE FUNCTION "lcsp_discovery_diagnostic_no_rule_set"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "RuleSetPreparationRun" WHERE id=NEW."preparationRunId" AND "claimDiscoveryOnly") THEN RAISE EXCEPTION 'Discovery-only diagnostics cannot persist a Rule Set'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "DiscoveryDiagnostic_no_rule_set" BEFORE INSERT ON "ComplianceRuleSetVersion" FOR EACH ROW EXECUTE FUNCTION "lcsp_discovery_diagnostic_no_rule_set"();
