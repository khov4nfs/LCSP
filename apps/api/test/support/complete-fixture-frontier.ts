import { randomUUID } from "node:crypto";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service.js";
import { SourceReviewHandler } from "../../src/modules/compliance-rule-set/application/commands/source-review/source-review.handler.js";
import { SourceReviewCommand } from "../../src/modules/compliance-rule-set/application/commands/source-review/source-review.command.js";
import { LegalDocumentGraphService } from "../../src/modules/legal-source/application/services/legal-document-graph.service.js";
import {
  sourceReviewUnits,
  reviewReferenceOwners,
} from "../../src/modules/compliance-rule-set/domain/source-review-frontier.js";
import {
  SOURCE_REVIEW_ACTIONS as A,
  SOURCE_REVIEW_DISPOSITIONS as D,
  type LegalDocumentGraph,
} from "@lcsp/contracts/legal-source";
import {
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
  type LegalSemanticGraph,
  type SourceReviewOperation,
  type SourceReviewPayload,
} from "@lcsp/contracts/compliance-rule-set";

/** Historical semantic fixtures traverse the real queue; no review or freeze database rows are patched. */
export async function completeFixtureFrontier(
  db: PrismaService,
  runId: string,
  revision: number,
  source: LegalDocumentGraph,
  graph: LegalSemanticGraph,
  identities: Record<string, string>,
) {
  const handler = new SourceReviewHandler(
    db,
    new LegalDocumentGraphService(db),
  );
  const operationId = randomUUID();
  const invoke = (
    fields: Omit<
      SourceReviewOperation,
      "preparationRunId" | "inventoryRevision" | "operationId"
    >,
  ) =>
    handler.execute(
      new SourceReviewCommand(
        {
          preparationRunId: runId,
          inventoryRevision: revision,
          operationId,
          ...fields,
        },
        "fixture-review",
      ),
    );
  const units = sourceReviewUnits(source);
  const positions = new Map(units.map((n, i) => [n.nodeId, i]));
  const owners = new Map(
    graph.claims.map((c) => [
      c.claimId,
      units.find((n) => c.sourceNodeIds.includes(n.nodeId))?.nodeId,
    ]),
  );
  const referenceOwners = reviewReferenceOwners(source);
  const relationOwner = (r: LegalSemanticGraph["relations"][number]) =>
    r.referenceId
      ? referenceOwners.get(r.referenceId)
      : [owners.get(r.fromClaimId), owners.get(r.toClaimId)]
          .filter((id): id is string => !!id)
          .sort((a, b) => positions.get(b)! - positions.get(a)!)[0];
  await invoke({ action: A.INIT });
  for (let index = 0; index < units.length; index++) {
    const work = await invoke({ action: A.NEXT });
    if (work.outcome !== O.PASSED) return work;
    const item = work.unit as { sourceNodeId: string };
    if (!item) break;
    const id = item.sourceNodeId;
    const claims = graph.claims.filter((c) => owners.get(c.claimId) === id);
    const payload: SourceReviewPayload = {
      claims,
      identities: Object.fromEntries(
        claims.map((c) => [c.claimId, identities[c.claimId]]),
      ),
      relations: graph.relations.filter((r) => relationOwner(r) === id),
      referenceAccounting: graph.referenceAccounting.filter(
        (r) => referenceOwners.get(r.referenceId) === id,
      ),
    };
    const claimIds = graph.claims
      .filter((c) => c.sourceNodeIds.includes(id))
      .map((c) => c.claimId);
    const original = graph.sourceAccounting.find((r) => r.sourceNodeId === id);
    const result = await invoke({
      action: A.COMPLETE,
      sourceNodeId: id,
      sourceRevision: source.materializationId,
      frontierRevision: work.frontierRevision as number,
      disposition: claimIds.length
        ? D.CLAIMS_AUTHORED
        : D.NO_RELEVANT_SEMANTIC_CLAIMS,
      claimIds,
      payload,
      ...(claimIds.length
        ? {}
        : {
            reason:
              original?.nonSemanticReason ??
              "Synthetic fixture has no independent semantic claim in this unit",
          }),
    });
    if (result.outcome !== O.PASSED) return result;
  }
  const progress = await invoke({ action: A.PROGRESS });
  if (progress.outcome === O.PASSED)
    graph.reviewFrontier = {
      revision: progress.frontierRevision as number,
      fingerprint: progress.frontierFingerprint as string,
      reviewedFingerprint: progress.reviewedFrontierFingerprint as string,
    };
  // Structural parents remain context, and claims are explicitly reviewed in body units.
  graph.sourceAccounting = graph.sourceAccounting.filter((r) =>
    positions.has(r.sourceNodeId),
  );
  return progress;
}
