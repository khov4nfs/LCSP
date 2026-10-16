import type { ComplianceRuleSetPacket } from "@lcsp/contracts/compliance-rule-set";
import {
  canonicalClaimId,
  inventoryFingerprint,
  normalizeInventory,
} from "../../src/modules/compliance-rule-set/domain/claim-inventory.js";

/** Test authoring only: preserve declared fixture meanings while assigning the new canonical identity. */
export function canonicalInventoryFixture(
  packet: ComplianceRuleSetPacket,
  runId: string,
  revision = 1,
) {
  const graph = packet.semanticGraph!;
  const identities: Record<string, string> = {};
  const remap = new Map(
    graph.claims.map((c) => [
      c.claimId,
      canonicalClaimId(runId, revision, c.sourceNodeIds, c.claimId),
    ]),
  );
  graph.claims = graph.claims.map((c) => {
    const id = remap.get(c.claimId)!;
    identities[id] = c.claimId;
    return { ...c, claimId: id };
  });
  graph.relations = graph.relations.map((r) => ({
    ...r,
    fromClaimId: remap.get(r.fromClaimId)!,
    toClaimId: remap.get(r.toClaimId)!,
  }));
  graph.sourceAccounting = graph.sourceAccounting.map((r) => ({
    ...r,
    claimIds: r.claimIds.map((id) => remap.get(id)!),
  }));
  for (const requirement of packet.legalRequirements) {
    requirement.claimInventoryRevision = revision;
    requirement.claimBindings = requirement.claimBindings!.map((b) => ({
      ...b,
      claimId: remap.get(b.claimId)!,
    }));
  }
  packet.semanticGraph = normalizeInventory(graph);
  packet.claimInventory = {
    revision,
    fingerprint: inventoryFingerprint(revision, packet.semanticGraph),
  };
  return {
    graph: packet.semanticGraph,
    identities,
    binding: packet.claimInventory,
  };
}
