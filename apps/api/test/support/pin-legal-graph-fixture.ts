import type { ComplianceRuleSetPacket } from "@lcsp/contracts/compliance-rule-set";
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
  return { ...body, packet };
}
