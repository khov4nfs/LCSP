import {
  legalSemanticGraphSchema,
  complianceRuleSetPacketSchema,
  ruleSetPreparationAuthoringDraftSchema,
  type ComplianceRuleSetPacket,
} from "@lcsp/contracts/compliance-rule-set";
import { PreparationExecutionContract } from "@prisma/client";
import { inventoryHash } from "../../domain/claim-inventory.js";
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

/** A valid older draft must not replace a newer accepted candidate snapshot. */
export async function matchesPersistedDirectDraft(
  prisma: PrismaService | Prisma.TransactionClient,
  run: {
    id: string;
    claimInventoryRevision: number;
    executionContract?: PreparationExecutionContract;
  },
  packet: ComplianceRuleSetPacket,
) {
  if (run.executionContract !== PreparationExecutionContract.DIRECT_DRAFT_V1)
    return true;
  const saved = await prisma.ruleSetPreparationAuthoringDraft.findUnique({
    where: {
      preparationRunId_revision: {
        preparationRunId: run.id,
        revision: run.claimInventoryRevision,
      },
    },
  });
  const draft = ruleSetPreparationAuthoringDraftSchema.safeParse(saved?.draft);
  if (!draft.success) return false;
  const expected = complianceRuleSetPacketSchema.safeParse({
    ...packet,
    legalRequirements: Object.values(draft.data.legalRequirements),
    assessmentRules: Object.values(draft.data.assessmentRules),
    contextRelations: Object.values(draft.data.contextRelations),
  });
  if (!expected.success) return false;
  const candidates = (p: ComplianceRuleSetPacket) => ({
    legalRequirements: [...p.legalRequirements].sort((a, b) =>
      a.legalRequirementId.localeCompare(b.legalRequirementId),
    ),
    assessmentRules: [...p.assessmentRules].sort((a, b) =>
      a.assessmentRuleId.localeCompare(b.assessmentRuleId),
    ),
    contextRelations: [...p.contextRelations].sort((a, b) =>
      a.relationId.localeCompare(b.relationId),
    ),
  });
  return (
    inventoryHash(candidates(expected.data)) ===
    inventoryHash(candidates(packet))
  );
}
