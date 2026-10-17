import {
  sourceReviewPayloadSchema,
  type LegalSemanticClaim,
  type SourceReviewPayload,
} from "@lcsp/contracts/compliance-rule-set";
import {
  CLAIM_ENDPOINT_AVAILABILITY as E,
  REFERENCE_DEPENDENCY_STATES as D,
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  SOURCE_REVIEW_STATES as S,
  type LegalDocumentGraph,
} from "@lcsp/contracts/legal-source";
import { canonicalClaimId, inventoryHash } from "./claim-inventory.js";
import {
  completedReviewStates,
  normalizeReviewPayload,
} from "./source-review-frontier.js";
import { semanticReferenceBindings } from "./semantic-reference-binding.js";

export type DependencyReview = {
  preparationRunId: string;
  inventoryRevision: number;
  legalSourceVersionId: string;
  materializationId: string;
  sourceNodeId: string;
  state: string;
  completionFingerprint: string | null;
  claimIds: string[];
  blockedReferenceIds: string[];
  payload: unknown;
};

// Python also treats C0 separators as whitespace; BOM remains semantic content.
const endpointWhitespace = new RegExp(
  String.raw`[\p{White_Space}${String.fromCodePoint(0x1c, 0x1d, 0x1e, 0x1f)}]+`,
  "gu",
);
const text = (s: string) =>
  s
    .normalize("NFC")
    .replace(endpointWhitespace, " ")
    .replace(/^ +| +$/gu, "");
/** Claim meaning, never row timestamps, leases or completion state. */
export function claimEndpointFingerprint(c: LegalSemanticClaim) {
  return inventoryHash({
    claimId: c.claimId,
    legalSourceVersionId: c.legalSourceVersionId,
    claimType: c.claimType,
    statement: text(c.statement),
    operative: c.operative
      ? {
          actor: text(c.operative.actor),
          modality: c.operative.modality,
          action: text(c.operative.action),
        }
      : null,
    sourceNodeIds: [...c.sourceNodeIds].sort(),
    state: c.state,
    nonOperativeReason:
      c.nonOperativeReason === null ? null : text(c.nonOperativeReason),
  });
}

/** Reconstruct endpoint authority exclusively from committed, individually valid payload claims. */
export function referenceDependencyView(
  graph: LegalDocumentGraph,
  rows: DependencyReview[],
  runId: string,
  revision: number,
) {
  const binding = semanticReferenceBindings(graph);
  const nodes = new Set(graph.nodes.map((n) => n.nodeId));
  const scoped = rows.filter(
    (r) =>
      r.preparationRunId === runId &&
      r.inventoryRevision === revision &&
      r.legalSourceVersionId === graph.legalSourceVersionId &&
      r.materializationId === graph.materializationId,
  );
  const endpoints = new Map<
    string,
    {
      claim: LegalSemanticClaim;
      owner: string;
      fingerprint: string;
      identityKey: string;
    }
  >();
  const duplicates = new Set<string>();
  for (const row of scoped) {
    if (
      row.state === S.PENDING ||
      !row.completionFingerprint ||
      !/^[a-f0-9]{64}$/u.test(row.completionFingerprint)
    )
      continue;
    const parsed = sourceReviewPayloadSchema.safeParse(row.payload);
    if (!parsed.success) continue;
    for (const claim of parsed.data.claims) {
      const identity = parsed.data.identities[claim.claimId];
      if (
        !identity ||
        claim.legalSourceVersionId !== graph.legalSourceVersionId ||
        !row.claimIds.includes(claim.claimId) ||
        !claim.sourceNodeIds.includes(row.sourceNodeId) ||
        claim.sourceNodeIds.some((id) => !nodes.has(id)) ||
        canonicalClaimId(runId, revision, claim.sourceNodeIds, identity) !==
          claim.claimId
      )
        continue;
      if (endpoints.has(claim.claimId)) duplicates.add(claim.claimId);
      endpoints.set(claim.claimId, {
        claim,
        owner: row.sourceNodeId,
        fingerprint: claimEndpointFingerprint(claim),
        identityKey: identity,
      });
    }
  }
  for (const id of duplicates) endpoints.delete(id);
  const target = (referenceId: string) => {
    const ref = graph.references.find((r) => r.referenceId === referenceId);
    const items = ref?.toNodeId
      ? scoped.filter((r) => binding.within(r.sourceNodeId, ref.toNodeId!))
      : [];
    const claims =
      ref?.toNodeId && ref.resolutionState === R.RESOLVED
        ? [...endpoints.values()]
            .filter((e) =>
              e.claim.sourceNodeIds.some((id) =>
                binding.within(id, ref.toNodeId!),
              ),
            )
            .sort((a, b) => a.claim.claimId.localeCompare(b.claim.claimId))
        : [];
    const classification =
      ref?.resolutionState !== R.RESOLVED
        ? D.UNRESOLVED
        : !items.length
          ? D.OUTSIDE_SCOPE
          : claims.length
            ? D.AVAILABLE
            : D.UNAVAILABLE;
    return {
      referenceId,
      targetNodeId: ref?.toNodeId ?? null,
      inScope: items.length > 0,
      targetReviewState: items.length === 1 ? items[0].state : null,
      targetReviews: items.map((r) => ({
        sourceNodeId: r.sourceNodeId,
        state: r.state,
      })),
      targetReviewComplete:
        items.length > 0 &&
        items.every((r) => completedReviewStates.includes(r.state as never)),
      targetClaimAvailability: claims.length ? E.AVAILABLE : E.NOT_AVAILABLE,
      bindingCanProceed: classification === D.AVAILABLE,
      classification,
      claims,
      endpointFingerprint: inventoryHash(
        claims.map((e) => [e.claim.claimId, e.fingerprint]),
      ),
    };
  };
  return { endpoints, target, binding };
}

/** A monotone publication fixed point; no DAG assumption and no model retries. */
export function referenceDependencyWake(
  row: DependencyReview,
  view: ReturnType<typeof referenceDependencyView>,
) {
  const blockers = row.blockedReferenceIds.map(view.target);
  const payload = sourceReviewPayloadSchema.parse(row.payload);
  const changed = blockers.some(
    (b) =>
      b.bindingCanProceed &&
      payload.blockedEndpointFingerprints?.[b.referenceId] !==
        b.endpointFingerprint,
  );
  // Recover legacy or inconsistent idle states even when their snapshot was already available.
  const allAvailable =
    blockers.length > 0 && blockers.every((b) => b.bindingCanProceed);
  return { wake: changed || allAvailable, blockers };
}

/** Preserve the Agent's original decisions, but withdraw their authority until explicit repair. */
export function invalidateDependentPayload(
  payload: SourceReviewPayload,
  changedClaims: Set<string>,
) {
  const invalidated = payload.relations.filter(
    (r) => changedClaims.has(r.fromClaimId) || changedClaims.has(r.toClaimId),
  );
  if (!invalidated.length) return null;
  const invalidatedRelationIds = [
    ...new Set([
      ...(payload.invalidatedRelationIds ?? []),
      ...invalidated.map((r) => r.relationId),
    ]),
  ].sort();
  return normalizeReviewPayload({ ...payload, invalidatedRelationIds });
}

/** Diagnose the durable blocked graph, including SCCs, before reporting an idle wait. */
export function referenceDependencyWaits(
  rows: DependencyReview[],
  view: ReturnType<typeof referenceDependencyView>,
) {
  const blocked = rows.filter((r) => r.state === S.BLOCKED_REFERENCE);
  const ids = new Set(blocked.map((r) => r.sourceNodeId));
  const edges = new Map(
    blocked.map((r) => [
      r.sourceNodeId,
      r.blockedReferenceIds.flatMap((id) =>
        view
          .target(id)
          .targetReviews.map((target) => target.sourceNodeId)
          .filter((id) => ids.has(id)),
      ),
    ]),
  );
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    active = new Set<string>();
  const cycles: string[][] = [];
  let next = 0;
  const visit = (id: string) => {
    index.set(id, next);
    low.set(id, next++);
    stack.push(id);
    active.add(id);
    for (const target of edges.get(id) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (active.has(target))
        low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      component.push(member);
    } while (member !== id);
    if (component.length > 1 || edges.get(id)?.includes(id))
      cycles.push(component.sort());
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return {
    cycles,
    falseDeadlock:
      blocked.length > 0 &&
      !rows.some((r) =>
        [S.PENDING, S.REOPENED, S.IN_REVIEW].includes(r.state as never),
      ) &&
      blocked.some((r) => referenceDependencyWake(r, view).wake),
    units: blocked.map((r) => ({
      sourceNodeId: r.sourceNodeId,
      blockers: r.blockedReferenceIds.map((id) => {
        const target = view.target(id);
        return {
          referenceId: id,
          targetNodeId: target.targetNodeId,
          classification: target.classification,
          targetClaimAvailability: target.targetClaimAvailability,
          targetReviewComplete: target.targetReviewComplete,
          cyclicInternalWait: cycles.some(
            (c) =>
              c.includes(r.sourceNodeId) &&
              target.targetReviews.some((t) => c.includes(t.sourceNodeId)),
          ),
        };
      }),
    })),
  };
}
