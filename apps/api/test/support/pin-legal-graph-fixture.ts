import type { ComplianceRuleSetPacket } from "@lcsp/contracts/compliance-rule-set";
import { ClaimInventoryHandler } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.handler.js";
import { ClaimInventoryCommand } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.command.js";
import { ValidateComplianceRuleSetHandler } from "../../src/modules/compliance-rule-set/application/commands/validate-compliance-rule-set/validate-compliance-rule-set.handler.js";
import { ValidateComplianceRuleSetCommand } from "../../src/modules/compliance-rule-set/application/commands/validate-compliance-rule-set/validate-compliance-rule-set.command.js";
import { LegalSourceSnapshotLoader } from "../../src/modules/compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";
import { canonicalInventoryFixture } from "./canonical-claim-inventory-fixture.js";
import {
  complianceRuleSetPacketSchema,
  CLAIM_INVENTORY_ACTIONS as A,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
} from "@lcsp/contracts/compliance-rule-set";
import { AgentExecutionState, ClaimPreparationPhase } from "@prisma/client";
import { fixtureLegalSource } from "./compliance-rule-set-fixtures.js";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service.js";
import type { PrismaClient } from "@prisma/client";
import { LegalDocumentGraphService } from "../../src/modules/legal-source/application/services/legal-document-graph.service.js";

/** Only translates the reusable synthetic fixture's node identities into its real DB source pin. */
export async function pinFixtureRequest<T>(
  prisma: PrismaClient,
  body: T,
): Promise<T> {
  if (!body || typeof body !== "object") return body;
  const request = body as {
    preparationRunId?: string;
    packet?: ComplianceRuleSetPacket;
  };
  const fixture = fixtureLegalSource();
  if (
    request.packet?.semanticGraph?.legalSourceVersionId !==
      fixture.legalSourceVersionId ||
    !request.preparationRunId
  )
    return body;
  const run = await prisma.ruleSetPreparationRun.findUnique({
    where: { id: request.preparationRunId },
  });
  if (!run) return body;
  const graph = await new LegalDocumentGraphService(
    prisma as PrismaService,
  ).export(run.legalSourceVersionId);
  if (!graph) return body;
  const paths = new Map(
    fixture.documentGraph!.nodes.map((n) => [n.nodeId, n.structuralPath]),
  );
  const targets = new Map(graph.nodes.map((n) => [n.structuralPath, n.nodeId]));
  const id = (nodeId: string) => targets.get(paths.get(nodeId) ?? "") ?? nodeId;
  const packet = structuredClone(request.packet);
  const semantic = packet.semanticGraph!;
  semantic.legalSourceVersionId = graph.legalSourceVersionId;
  semantic.materializationId = graph.materializationId;
  for (const claim of semantic.claims) {
    claim.legalSourceVersionId = graph.legalSourceVersionId;
    claim.sourceNodeIds = claim.sourceNodeIds.map(id);
  }
  for (const inspected of semantic.sourceAccounting)
    inspected.sourceNodeId = id(inspected.sourceNodeId);
  const { graph: inventory, identities } = canonicalInventoryFixture(
    packet,
    run.id,
    run.claimInventoryRevision,
  );
  const candidate = complianceRuleSetPacketSchema.safeParse(packet);
  if (!candidate.success) return { ...body, packet };
  if (run.executionState === AgentExecutionState.RUNNING) {
    // Historical submit fixtures now traverse the same discovery/freeze/readiness lifecycle as the worker.
    const service = prisma as PrismaService;
    const loader = new LegalSourceSnapshotLoader(
      service,
      new LegalDocumentGraphService(service),
    );
    const handler = new ClaimInventoryHandler(service, loader);
    const frozen = await prisma.ruleSetPreparationClaimInventory.findUnique({
      where: {
        preparationRunId_revision: {
          preparationRunId: run.id,
          revision: run.claimInventoryRevision,
        },
      },
    });
    if (!frozen) {
      const result = await handler.execute(
        new ClaimInventoryCommand(
          {
            preparationRunId: run.id,
            action: A.FINALIZE,
            revision: run.claimInventoryRevision,
            graph: inventory,
            identities,
          },
          "fixture-finalize",
        ),
      );
      if (result.outcome === O.PASSED)
        await handler.execute(
          new ClaimInventoryCommand(
            {
              preparationRunId: run.id,
              action: A.AUTHOR_RULES,
              revision: run.claimInventoryRevision,
            },
            "fixture-author",
          ),
        );
    } else if (run.claimPhase === ClaimPreparationPhase.CLAIM_INVENTORY_READY) {
      await handler.execute(
        new ClaimInventoryCommand(
          {
            preparationRunId: run.id,
            action: A.AUTHOR_RULES,
            revision: run.claimInventoryRevision,
          },
          "fixture-author",
        ),
      );
    }
    await new ValidateComplianceRuleSetHandler(service, loader).execute(
      new ValidateComplianceRuleSetCommand(
        { preparationRunId: run.id, packet: candidate.data },
        "fixture-validate",
      ),
    );
  }
  return { ...body, packet };
}
