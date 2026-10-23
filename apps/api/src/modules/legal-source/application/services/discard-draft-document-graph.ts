import { Prisma, LegalSourceLifecycleStatus } from "@prisma/client";

/** Derived draft indexes are disposable; any accepted semantic graph FK prevents their deletion. */
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
