import { Prisma, LegalSourceLifecycleStatus } from "@prisma/client";

/**
 * Business purpose: Remove derived graph rows when an unused draft legal-source version is discarded.
 *
 * Business rules:
 * - Only a DRAFT source version may have its derived document graph discarded.
 * - Accepted semantic records that reference graph rows remain protected by database foreign keys.
 * - The caller supplies the transaction so graph deletion participates in the version-discard transaction.
 *
 * Execution flow:
 * 1. Return without writes when the version has no graph materialization.
 * 2. Load the version lifecycle and reject any non-DRAFT source.
 * 3. Delete references, chunk mappings, retrieval units, nodes, and finally the materialization.
 *
 * Failure cases:
 * - With an existing materialization, a missing version or non-DRAFT status fails the enclosing transaction; without a materialization this helper returns before checking the version. Foreign-key violations prevent unsafe deletion.
 *
 * Side effects:
 * - Deletes derived graph rows through the supplied transaction; it does not delete accepted semantic records.
 */
export async function discardDraftDocumentGraphs(
  tx: Prisma.TransactionClient,
  legalSourceVersionId: string,
) {
  const existing = await tx.legalDocumentMaterialization.findFirst({
    where: { legalSourceVersionId },
    select: { id: true },
  });
  if (!existing) return;
  const source = await tx.legalSourceVersion.findUniqueOrThrow({
    where: { id: legalSourceVersionId },
    select: { status: true },
  });
  if (source.status !== LegalSourceLifecycleStatus.DRAFT)
    throw new Error("Only a DRAFT source may discard derived document graphs");
  const scope = { legalSourceVersionId };
  await tx.legalDocumentReference.deleteMany({ where: scope });
  await tx.legalDocumentChunkNode.deleteMany({ where: scope });
  await tx.legalDocumentRetrievalUnit.deleteMany({ where: scope });
  await tx.$executeRaw(
    Prisma.sql`SET CONSTRAINTS "LegalNode_parent_fkey" DEFERRED`,
  );
  await tx.legalDocumentNode.deleteMany({ where: scope });
  await tx.legalDocumentMaterialization.deleteMany({ where: scope });
}
