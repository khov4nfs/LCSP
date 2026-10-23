-- CreateEnum
CREATE TYPE "LegalSemanticAuthority" AS ENUM ('LEGAL_NORMATIVE', 'DEFINITION', 'CONTEXT', 'ASSESSMENT_GUIDANCE', 'EVIDENCE_GUIDANCE');

-- CreateEnum
CREATE TYPE "LegalAssessability" AS ENUM ('REPOSITORY_VERIFIABLE', 'EXTERNAL_FULFILLMENT', 'MIXED', 'NON_ASSESSABLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LegalSemanticRelationKind" ADD VALUE 'CONDITION_OF';
ALTER TYPE "LegalSemanticRelationKind" ADD VALUE 'QUALIFIES';
ALTER TYPE "LegalSemanticRelationKind" ADD VALUE 'EXCEPTION_TO';
ALTER TYPE "LegalSemanticRelationKind" ADD VALUE 'TEMPORALLY_APPLIES_TO';
ALTER TYPE "LegalSemanticRelationKind" ADD VALUE 'DEFINED_BY';
ALTER TYPE "LegalSemanticRelationKind" ADD VALUE 'PRESERVES';
ALTER TYPE "LegalSemanticRelationKind" ADD VALUE 'EVIDENCE_SLICE_OF';

-- AlterTable
ALTER TABLE "LegalSemanticGraph" ADD COLUMN     "semanticAudits" JSONB;

-- AlterTable
ALTER TABLE "LegalSemanticClaim" ADD COLUMN     "assessability" "LegalAssessability",
ADD COLUMN     "semanticAuthority" "LegalSemanticAuthority",
ADD COLUMN     "semanticFrame" JSONB,
ADD COLUMN     "sourceSupport" JSONB;

-- CreateTable
CREATE TABLE "RuleSetPreparationSemanticAudit" (
    "preparationRunId" TEXT NOT NULL,
    "inventoryRevision" INTEGER NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreparationSemanticAudit_pkey" PRIMARY KEY ("preparationRunId","inventoryRevision","sourceNodeId")
);

-- AddForeignKey
ALTER TABLE "RuleSetPreparationSemanticAudit" ADD CONSTRAINT "RuleSetPreparationSemanticAudit_preparationRunId_fkey" FOREIGN KEY ("preparationRunId") REFERENCES "RuleSetPreparationRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
