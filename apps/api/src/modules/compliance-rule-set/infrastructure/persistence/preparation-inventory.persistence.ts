import { legalSemanticGraphSchema } from "@lcsp/contracts/compliance-rule-set";
import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

export async function frozenInventoryForRun(
  prisma: PrismaService | Prisma.TransactionClient,
  runId: string,
  revision: number,
) {
  const row = await prisma.ruleSetPreparationClaimInventory.findUnique({
    where: { preparationRunId_revision: { preparationRunId: runId, revision } },
  });
  return row
    ? {
        revision: row.revision,
        fingerprint: row.fingerprint,
        graph: legalSemanticGraphSchema.parse(row.graph),
      }
    : null;
}

/** The structural materialization a run's first review frontier pinned; reopened inventory revisions keep it. */
export async function pinnedMaterializationId(
  prisma: PrismaService | Prisma.TransactionClient,
  runId: string,
) {
  const frontier = await prisma.ruleSetPreparationReviewFrontier.findFirst({
    where: { preparationRunId: runId },
    orderBy: { inventoryRevision: "asc" },
    select: { materializationId: true },
  });
  return frontier?.materializationId;
}
