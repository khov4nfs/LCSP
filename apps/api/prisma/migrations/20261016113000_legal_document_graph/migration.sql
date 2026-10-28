-- CreateEnum
CREATE TYPE "LegalDocumentNodeType" AS ENUM ('DOCUMENT', 'PART', 'TITLE', 'CHAPTER', 'SUBCHAPTER', 'SECTION', 'SUBSECTION', 'ARTICLE', 'CLAUSE', 'PARAGRAPH', 'SUBPARAGRAPH', 'POINT', 'ITEM', 'ANNEX', 'SCHEDULE', 'TABLE', 'DEFINITION_BLOCK', 'UNSTRUCTURED_BLOCK');

-- CreateEnum
CREATE TYPE "LegalReferenceResolutionState" AS ENUM ('RESOLVED', 'AMBIGUOUS', 'UNRESOLVED');

-- CreateTable
CREATE TABLE "LegalDocumentMaterialization" (
    "id" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "parserRevision" TEXT NOT NULL,
    "materializationRevision" TEXT NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "graphDigest" TEXT NOT NULL,
    "inputModes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocumentMaterialization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocumentNode" (
    "nodeId" TEXT NOT NULL,
    "materializationId" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "nodeType" "LegalDocumentNodeType" NOT NULL,
    "parentNodeId" TEXT,
    "ordinal" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "structuralPath" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "legalEffectStatus" "LegalEffectStatus" NOT NULL,
    "legalStatusSourceRefs" JSONB NOT NULL,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "charStart" INTEGER,
    "charEnd" INTEGER,

    CONSTRAINT "LegalDocumentNode_pkey" PRIMARY KEY ("nodeId","materializationId")
);

-- CreateTable
CREATE TABLE "LegalDocumentReference" (
    "referenceId" TEXT NOT NULL,
    "materializationId" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT,
    "text" TEXT NOT NULL,
    "charStart" INTEGER NOT NULL,
    "charEnd" INTEGER NOT NULL,
    "resolutionState" "LegalReferenceResolutionState" NOT NULL,
    "candidateNodeIds" JSONB NOT NULL,

    CONSTRAINT "LegalDocumentReference_pkey" PRIMARY KEY ("referenceId","materializationId")
);

-- CreateTable
CREATE TABLE "LegalDocumentChunkNode" (
    "materializationId" TEXT NOT NULL,
    "legalSourceVersionId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "legalDocumentNodeId" TEXT NOT NULL,

    CONSTRAINT "LegalDocumentChunkNode_pkey" PRIMARY KEY ("materializationId","chunkId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocumentMaterialization_id_legalSourceVersionId_key" ON "LegalDocumentMaterialization"("id", "legalSourceVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalMaterialization_revision_key" ON "LegalDocumentMaterialization"("legalSourceVersionId", "parserRevision", "materializationRevision", "sourceDigest");

-- CreateIndex
CREATE INDEX "LegalNode_children_idx" ON "LegalDocumentNode"("materializationId", "parentNodeId", "ordinal");

-- CreateIndex
CREATE INDEX "LegalNode_locator_idx" ON "LegalDocumentNode"("materializationId", "documentId", "nodeType", "label");

-- CreateIndex
CREATE UNIQUE INDEX "LegalNode_source_key" ON "LegalDocumentNode"("nodeId", "materializationId", "legalSourceVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalNode_path_key" ON "LegalDocumentNode"("materializationId", "documentId", "structuralPath");

-- CreateIndex
CREATE INDEX "LegalReference_outbound_idx" ON "LegalDocumentReference"("materializationId", "fromNodeId");

-- CreateIndex
CREATE INDEX "LegalReference_inbound_idx" ON "LegalDocumentReference"("materializationId", "toNodeId");

-- CreateIndex
CREATE INDEX "LegalReference_resolution_idx" ON "LegalDocumentReference"("materializationId", "resolutionState");

-- CreateIndex
CREATE INDEX "LegalChunkNode_node_idx" ON "LegalDocumentChunkNode"("materializationId", "legalDocumentNodeId");

-- CreateIndex
CREATE INDEX "LegalChunkNode_source_idx" ON "LegalDocumentChunkNode"("chunkId", "legalSourceVersionId");

-- AddForeignKey
ALTER TABLE "LegalDocumentMaterialization" ADD CONSTRAINT "LegalDocumentMaterialization_legalSourceVersionId_fkey" FOREIGN KEY ("legalSourceVersionId") REFERENCES "LegalSourceVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalDocumentNode" ADD CONSTRAINT "LegalDocumentNode_materializationId_legalSourceVersionId_fkey" FOREIGN KEY ("materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentMaterialization"("id", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalDocumentNode" ADD CONSTRAINT "LegalNode_parent_fkey" FOREIGN KEY ("parentNodeId", "materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentNode"("nodeId", "materializationId", "legalSourceVersionId") ON DELETE NO ACTION ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalDocumentReference" ADD CONSTRAINT "LegalDocumentReference_materializationId_legalSourceVersio_fkey" FOREIGN KEY ("materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentMaterialization"("id", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalDocumentReference" ADD CONSTRAINT "LegalDocumentReference_fromNodeId_materializationId_legalS_fkey" FOREIGN KEY ("fromNodeId", "materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentNode"("nodeId", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalDocumentReference" ADD CONSTRAINT "LegalDocumentReference_toNodeId_materializationId_legalSou_fkey" FOREIGN KEY ("toNodeId", "materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentNode"("nodeId", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalDocumentChunkNode" ADD CONSTRAINT "LegalDocumentChunkNode_materializationId_legalSourceVersio_fkey" FOREIGN KEY ("materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentMaterialization"("id", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalDocumentChunkNode" ADD CONSTRAINT "LegalDocumentChunkNode_chunkId_legalSourceVersionId_fkey" FOREIGN KEY ("chunkId", "legalSourceVersionId") REFERENCES "LegalDocumentChunk"("id", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegalDocumentChunkNode" ADD CONSTRAINT "LegalDocumentChunkNode_legalDocumentNodeId_materialization_fkey" FOREIGN KEY ("legalDocumentNodeId", "materializationId", "legalSourceVersionId") REFERENCES "LegalDocumentNode"("nodeId", "materializationId", "legalSourceVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Derived graph integrity; existing source, authority and pins are untouched.
ALTER TABLE "LegalDocumentNode" ALTER CONSTRAINT "LegalNode_parent_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "LegalDocumentNode" ADD CONSTRAINT "LegalNode_document_fkey" FOREIGN KEY ("legalSourceVersionId", "documentId") REFERENCES "LegalSourceDocument"("legalSourceVersionId","documentId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegalDocumentNode" ADD CONSTRAINT "LegalNode_spans_check" CHECK ("ordinal">=0 AND ("pageStart" IS NULL)=("pageEnd" IS NULL) AND ("pageStart" IS NULL OR ("pageStart">0 AND "pageEnd">="pageStart")) AND ("charStart" IS NULL)=("charEnd" IS NULL) AND ("charStart" IS NULL OR ("charStart">=0 AND "charEnd">="charStart")) AND "parentNodeId" IS DISTINCT FROM "nodeId");
ALTER TABLE "LegalDocumentReference" ADD CONSTRAINT "LegalReference_resolution_check" CHECK ((("resolutionState"='RESOLVED')=("toNodeId" IS NOT NULL)) AND "charStart">=0 AND "charEnd">"charStart" AND jsonb_typeof("candidateNodeIds")='array');

ALTER TABLE "LegalDocumentNode" ADD CONSTRAINT "LegalNode_effect_provenance_check" CHECK (jsonb_typeof("legalStatusSourceRefs")='array');
