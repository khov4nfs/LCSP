-- CreateEnum
CREATE TYPE "LegalSemanticClaimType" AS ENUM ('DUTY', 'PROHIBITION', 'PERMISSION', 'DEFINITION', 'SCOPE', 'QUALIFIER', 'EXCEPTION', 'CROSS_REFERENCE', 'CONDITION', 'TEMPORAL_RULE', 'TRANSITION_RULE', 'CONTEXT');

-- CreateEnum
CREATE TYPE "LegalSemanticClaimState" AS ENUM ('RELEVANT', 'INTENTIONALLY_NON_OPERATIVE');

-- CreateEnum
CREATE TYPE "LegalClaimAccountingRole" AS ENUM ('OPERATIVE_PROPOSITION', 'APPLICABILITY_CONDITION', 'QUALIFIER', 'EXCEPTION', 'CONTEXT', 'DEFINITION');

-- CreateEnum
CREATE TYPE "LegalSemanticRelationKind" AS ENUM ('DEFINITION', 'SCOPE', 'QUALIFIER', 'EXCEPTION', 'CROSS_REFERENCE', 'CONDITION', 'INCORPORATES', 'TEMPORALLY_LIMITS');

-- AlterTable
ALTER TABLE "LegalRequirement" ADD COLUMN     "semanticContext" JSONB;

-- CreateTable
CREATE TABLE "LegalDocumentRetrievalUnit" (
    "unitId" TEXT NOT NULL,
    "materializationId" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "legalDocumentNodeId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "contentStart" INTEGER NOT NULL,
    "contentEnd" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,

    CONSTRAINT "LegalDocumentRetrievalUnit_pkey" PRIMARY KEY ("unitId","materializationId")
);

-- CreateTable
CREATE TABLE "LegalSemanticGraph" (
    "ruleSetVersionId" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "materializationId" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "sourceAccounting" JSONB NOT NULL,
    "referenceAccounting" JSONB NOT NULL,
    "graphDigest" TEXT NOT NULL,

    CONSTRAINT "LegalSemanticGraph_pkey" PRIMARY KEY ("ruleSetVersionId")
);

-- CreateTable
CREATE TABLE "LegalSemanticClaim" (
    "claimId" TEXT NOT NULL,
    "ruleSetVersionId" TEXT NOT NULL,
    "materializationId" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "claimType" "LegalSemanticClaimType" NOT NULL,
    "statement" TEXT NOT NULL,
    "operative" JSONB,
    "state" "LegalSemanticClaimState" NOT NULL,
    "nonOperativeReason" TEXT,
    "candidateFingerprint" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "LegalSemanticClaim_pkey" PRIMARY KEY ("claimId","ruleSetVersionId")
);

-- CreateTable
CREATE TABLE "LegalSemanticClaimSource" (
    "claimId" TEXT NOT NULL,
    "ruleSetVersionId" TEXT NOT NULL,
    "materializationId" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "LegalSemanticClaimSource_pkey" PRIMARY KEY ("claimId","ruleSetVersionId","sourceNodeId")
);

-- CreateTable
CREATE TABLE "LegalSemanticClaimRelation" (
    "relationId" TEXT NOT NULL,
    "ruleSetVersionId" TEXT NOT NULL,
    "kind" "LegalSemanticRelationKind" NOT NULL,
    "fromClaimId" TEXT NOT NULL,
    "toClaimId" TEXT NOT NULL,
    "referenceId" TEXT,
    "ordinal" INTEGER NOT NULL,
    "materializationId" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,

    CONSTRAINT "LegalSemanticClaimRelation_pkey" PRIMARY KEY ("relationId","ruleSetVersionId")
);

-- CreateTable
CREATE TABLE "LegalRequirementClaimBinding" (
    "ruleSetVersionId" TEXT NOT NULL,
    "legalRequirementRowId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "role" "LegalClaimAccountingRole" NOT NULL,
    "index" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "LegalRequirementClaimBinding_pkey" PRIMARY KEY ("legalRequirementRowId","claimId","role","index")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalRetrievalUnit_node_key" ON "LegalDocumentRetrievalUnit"("materializationId", "legalDocumentNodeId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "LegalClaimGraph_source_key" ON "LegalSemanticGraph"("ruleSetVersionId", "materializationId", "legalSourceVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalClaimGraph_version_key" ON "LegalSemanticGraph"("ruleSetVersionId", "legalSourceVersionId");

-- CreateIndex
CREATE INDEX "LegalClaim_accounting_idx" ON "LegalSemanticClaim"("ruleSetVersionId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "LegalClaim_source_key" ON "LegalSemanticClaim"("claimId", "ruleSetVersionId", "materializationId", "legalSourceVersionId");

-- CreateIndex
CREATE INDEX "LegalClaimSource_node_idx" ON "LegalSemanticClaimSource"("materializationId", "sourceNodeId");

-- CreateIndex
CREATE INDEX "LegalClaimRelation_out_idx" ON "LegalSemanticClaimRelation"("ruleSetVersionId", "fromClaimId");

-- CreateIndex
CREATE INDEX "LegalClaimRelation_in_idx" ON "LegalSemanticClaimRelation"("ruleSetVersionId", "toClaimId");

-- CreateIndex
CREATE INDEX "LegalRequirementClaim_claim_idx" ON "LegalRequirementClaimBinding"("ruleSetVersionId", "claimId");

-- AddForeignKey
ALTER TABLE "LegalDocumentRetrievalUnit" ADD CONSTRAINT "LegalDocumentRetrievalUnit_materializationId_legalSourceVe_fkey" FOREIGN KEY ("materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentMaterialization"("id", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalDocumentRetrievalUnit" ADD CONSTRAINT "LegalDocumentRetrievalUnit_legalDocumentNodeId_materializa_fkey" FOREIGN KEY ("legalDocumentNodeId", "materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentNode"("nodeId", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalSemanticGraph" ADD CONSTRAINT "LegalSemanticGraph_ruleSetVersionId_legalSourceVersionId_fkey" FOREIGN KEY ("ruleSetVersionId", "legalSourceVersionId") REFERENCES "ComplianceRuleSetVersion"("id", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalSemanticGraph" ADD CONSTRAINT "LegalSemanticGraph_materializationId_legalSourceVersionId_fkey" FOREIGN KEY ("materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentMaterialization"("id", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalSemanticClaim" ADD CONSTRAINT "LegalSemanticClaim_ruleSetVersionId_materializationId_lega_fkey" FOREIGN KEY ("ruleSetVersionId", "materializationId", "legalSourceVersionId") REFERENCES "LegalSemanticGraph"("ruleSetVersionId", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalSemanticClaimSource" ADD CONSTRAINT "LegalSemanticClaimSource_claimId_ruleSetVersionId_material_fkey" FOREIGN KEY ("claimId", "ruleSetVersionId", "materializationId", "legalSourceVersionId") REFERENCES "LegalSemanticClaim"("claimId", "ruleSetVersionId", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalSemanticClaimSource" ADD CONSTRAINT "LegalSemanticClaimSource_sourceNodeId_materializationId_le_fkey" FOREIGN KEY ("sourceNodeId", "materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentNode"("nodeId", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalSemanticClaimRelation" ADD CONSTRAINT "LegalSemanticClaimRelation_ruleSetVersionId_materializatio_fkey" FOREIGN KEY ("ruleSetVersionId", "materializationId", "legalSourceVersionId") REFERENCES "LegalSemanticGraph"("ruleSetVersionId", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalSemanticClaimRelation" ADD CONSTRAINT "LegalSemanticClaimRelation_referenceId_materializationId_fkey" FOREIGN KEY ("referenceId", "materializationId") REFERENCES "LegalDocumentReference"("referenceId", "materializationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalSemanticClaimRelation" ADD CONSTRAINT "LegalSemanticClaimRelation_fromClaimId_ruleSetVersionId_fkey" FOREIGN KEY ("fromClaimId", "ruleSetVersionId") REFERENCES "LegalSemanticClaim"("claimId", "ruleSetVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalSemanticClaimRelation" ADD CONSTRAINT "LegalSemanticClaimRelation_toClaimId_ruleSetVersionId_fkey" FOREIGN KEY ("toClaimId", "ruleSetVersionId") REFERENCES "LegalSemanticClaim"("claimId", "ruleSetVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalRequirementClaimBinding" ADD CONSTRAINT "LegalRequirementClaimBinding_legalRequirementRowId_ruleSet_fkey" FOREIGN KEY ("legalRequirementRowId", "ruleSetVersionId") REFERENCES "LegalRequirement"("id", "ruleSetVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalRequirementClaimBinding" ADD CONSTRAINT "LegalRequirementClaimBinding_claimId_ruleSetVersionId_fkey" FOREIGN KEY ("claimId", "ruleSetVersionId") REFERENCES "LegalSemanticClaim"("claimId", "ruleSetVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Guard new semantic history exactly like existing immutable Rule Set children.
ALTER TABLE "LegalSemanticClaim" ADD CONSTRAINT "LegalClaim_state_check" CHECK (
  "ordinal">=0 AND (("state"='RELEVANT' AND "nonOperativeReason" IS NULL) OR
  ("state"='INTENTIONALLY_NON_OPERATIVE' AND "nonOperativeReason" IS NOT NULL AND length(btrim("nonOperativeReason"))>0)));
ALTER TABLE "LegalRequirementClaimBinding" ADD CONSTRAINT "LegalClaimBinding_index_check" CHECK ("index">=0 AND "ordinal">=0);
ALTER TABLE "LegalSemanticClaimRelation" ADD CONSTRAINT "LegalClaimRelation_direction_check" CHECK ("fromClaimId"<>"toClaimId" AND "ordinal">=0);
ALTER TABLE "LegalSemanticClaimSource" ADD CONSTRAINT "LegalClaimSource_ordinal_check" CHECK ("ordinal">=0);
ALTER TABLE "LegalDocumentRetrievalUnit" ADD CONSTRAINT "LegalRetrievalUnit_span_check" CHECK (
  "ordinal">=0 AND "contentStart">=0 AND "contentEnd">"contentStart" AND length("content") BETWEEN 1 AND 6000);
CREATE TRIGGER "LegalSemanticGraph_immutable" BEFORE UPDATE OR DELETE ON "LegalSemanticGraph" FOR EACH ROW EXECUTE FUNCTION "lcsp_compliance_rule_set_immutable"();
CREATE TRIGGER "LegalSemanticClaim_immutable" BEFORE UPDATE OR DELETE ON "LegalSemanticClaim" FOR EACH ROW EXECUTE FUNCTION "lcsp_compliance_rule_set_immutable"();
CREATE TRIGGER "LegalSemanticClaimSource_immutable" BEFORE UPDATE OR DELETE ON "LegalSemanticClaimSource" FOR EACH ROW EXECUTE FUNCTION "lcsp_compliance_rule_set_immutable"();
CREATE TRIGGER "LegalSemanticClaimRelation_immutable" BEFORE UPDATE OR DELETE ON "LegalSemanticClaimRelation" FOR EACH ROW EXECUTE FUNCTION "lcsp_compliance_rule_set_immutable"();
CREATE TRIGGER "LegalRequirementClaimBinding_immutable" BEFORE UPDATE OR DELETE ON "LegalRequirementClaimBinding" FOR EACH ROW EXECUTE FUNCTION "lcsp_compliance_rule_set_immutable"();
