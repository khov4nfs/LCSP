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
  type LegalSemanticClaim,
  CLAIM_INVENTORY_ACTIONS,
} from "@lcsp/contracts/compliance-rule-set";
import { semanticAuditInput } from "../../src/modules/compliance-rule-set/domain/semantic-audit.js";
import { signSemanticAuditFixture } from "../../src/modules/compliance-rule-set/domain/semantic-audit-attestation.js";
import {
  structuralReceipt,
  refreshStructuralAudits,
} from "./structural-semantic-fixture.js";
import { ClaimInventoryHandler } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.handler.js";
import { ClaimInventoryCommand } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.command.js";
import { LegalSourceSnapshotLoader } from "../../src/modules/compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";

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
  const seen = new Set<string>();
  while (true) {
    const work = await invoke({ action: A.NEXT });
    if (work.outcome !== O.PASSED) return work;
    const item = work.unit as { sourceNodeId: string };
    if (!item) break;
    const state = `${String(work.frontierStateFingerprint)}:${item.sourceNodeId}`;
    if (seen.has(state))
      throw new Error("Fixture dependency review made no durable progress");
    seen.add(state);
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
    const foreign = [
      ...new Set(
        payload.relations
          .flatMap((r) => [r.fromClaimId, r.toClaimId])
          .filter((cid) => owners.get(cid) !== id),
      ),
    ];
    const endpoints = new Map<string, string>();
    for (let offset = 0; offset < foreign.length; offset += 128) {
      const authority = await invoke({
        action: A.PROGRESS,
        claimIds: foreign.slice(offset, offset + 128),
      });
      if (authority.outcome !== O.PASSED) return authority;
      for (const endpoint of authority.endpoints as {
        claim: LegalSemanticClaim;
        fingerprint: string;
      }[])
        endpoints.set(endpoint.claim.claimId, endpoint.fingerprint);
    }
    payload.dependencyFingerprints = Object.fromEntries(endpoints);
    const waiting = new Set<string>();
    payload.relations = payload.relations.filter((r) => {
      const ready = [r.fromClaimId, r.toClaimId].every(
        (cid) => owners.get(cid) === id || endpoints.has(cid),
      );
      if (!ready && r.referenceId) waiting.add(r.referenceId);
      if (!ready && !r.referenceId)
        throw new Error(
          "Unbound fixture relation must be authored after its durable endpoints",
        );
      return ready;
    });
    payload.referenceAccounting = payload.referenceAccounting.filter(
      (r) => !waiting.has(r.referenceId),
    );
    const claimIds = graph.claims
      .filter((c) => c.sourceNodeIds.includes(id))
      .map((c) => c.claimId);
    const original = graph.sourceAccounting.find((r) => r.sourceNodeId === id);
    if (!waiting.size) {
      const rows = await db.ruleSetPreparationSourceReview.findMany({
        where: { preparationRunId: runId, inventoryRevision: revision },
      });
      const payloads = rows
        .filter((r) => r.sourceNodeId !== id)
        .map((r) => r.payload as unknown as SourceReviewPayload)
        .concat(payload);
      const stage = {
        ...graph,
        claims: payloads.flatMap((p) => p.claims),
        relations: [
          ...new Map(
            payloads
              .flatMap((p) =>
                p.relations.filter(
                  (r) => !p.invalidatedRelationIds?.includes(r.relationId),
                ),
              )
              .map((r) => [r.relationId, r]),
          ).values(),
        ],
        sourceAccounting: [
          {
            sourceNodeId: id,
            claimIds,
            nonSemanticReason: original?.nonSemanticReason ?? null,
          },
        ],
      };
      payload.semanticAudit = signSemanticAuditFixture(
        structuralReceipt(semanticAuditInput(source, stage, id, revision)),
        runId,
      );
    }
    const result = await invoke({
      action: A.COMPLETE,
      sourceNodeId: id,
      sourceRevision: source.materializationId,
      frontierRevision: work.frontierRevision as number,
      disposition: waiting.size
        ? D.REQUIRES_REFERENCE_RESOLUTION
        : claimIds.length
          ? D.CLAIMS_AUTHORED
          : D.NO_RELEVANT_SEMANTIC_CLAIMS,
      claimIds,
      payload,
      ...(waiting.size
        ? {
            referenceIds: [...waiting],
            reason:
              "Publish fixture claims while waiting for durable reference endpoints",
          }
        : {}),
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
  if (progress.outcome !== O.PASSED) return progress;
  refreshStructuralAudits(graph, source, revision);
  graph.semanticAudits = graph.semanticAudits?.map((receipt) =>
    signSemanticAuditFixture(receipt, runId),
  );
  return new ClaimInventoryHandler(
    db,
    new LegalSourceSnapshotLoader(db, new LegalDocumentGraphService(db)),
  ).execute(
    new ClaimInventoryCommand(
      {
        preparationRunId: runId,
        revision,
        action: CLAIM_INVENTORY_ACTIONS.RECORD_SEMANTIC_AUDITS,
        graph,
        identities,
      },
      "scripted-fixture-audits",
    ),
  );
}
